import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { pollOnce, setPollInterval } from "../poller/index.js";
import { executeReadOnlySql } from "../mcp/sqlSafety.js";
import { desc, count, eq } from "drizzle-orm";
import { mcpSessionManager } from "../mcp/sessionManager.js";
import { embeddingBatcher } from "../services/embeddingBatcher.js";
import { cacheService } from "../services/cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer(port: number = Number(process.env.PORT) || 5200) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // CORS Headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 0. Remote MCP SSE Endpoints (Multi-User & Multi-Session)
      if (url.pathname === "/sse" && req.method === "GET") {
        await mcpSessionManager.handleSseConnection(req, res);
        return;
      }

      if (url.pathname === "/message" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing sessionId query parameter" }));
          return;
        }
        await mcpSessionManager.handleIncomingMessage(req, res, sessionId);
        return;
      }

      if (url.pathname === "/api/mcp/metrics" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          sessions: mcpSessionManager.getMetrics(),
          batcher: embeddingBatcher.getStatus(),
          cache: cacheService.getStats(),
        }));
        return;
      }

      // 0.1 API: 15-minute Rolling MCP Request/Response Audit Logs
      if (url.pathname === "/api/mcp/audit-logs" && req.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
        const logs = await cacheService.getAuditLogsAsync(limit);
        const stats = cacheService.getStats();
        stats.auditLogsCount15m = logs.length;
        stats.auditLogsCount5m = logs.length;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          logs,
          count: logs.length,
          stats,
        }));
        return;
      }

      // 1. API: Get System Status & Config
      if (url.pathname === "/api/status" && req.method === "GET") {
        const todayHkt = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });
        const [[totalCount], [dailyCount]] = await Promise.all([
          db.select({ value: count() }).from(flashNews),
          db.select({ value: count() }).from(flashNews).where(eq(flashNews.dateHkt, todayHkt)),
        ]);
        const config = {
          port,
          dbUrl: (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@"),
          pollInterval: Number(process.env.POLL_INTERVAL_SECONDS) || 60,
          sourceUrl: process.env.SOURCE_API_URL || "https://mutemute.com/mutenews/ajax/app-news.php",
          totalRecords: totalCount?.value || 0,
          dailyRecords: dailyCount?.value || 0,
          todayHkt,
          nodeEnv: process.env.NODE_ENV || "development",
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(config));
        return;
      }

      // 1.1 API: Update System Configuration (Poll Frequency)
      if (url.pathname === "/api/config" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { pollInterval } = JSON.parse(body || "{}");
            const seconds = Number(pollInterval);
            if (!seconds || seconds < 15 || seconds > 300) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Poll frequency must be between 15 and 300 seconds." }));
              return;
            }
            setPollInterval(seconds);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, pollInterval: seconds }));
          } catch (err: any) {
            console.error("[Web Server] /api/config error:", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
        });
        return;
      }

      // 2. API: Get Latest Live News
      if (url.pathname === "/api/news" && req.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 300);
        const cacheKey = `flash:latest:${limit}`;
        const cached = cacheService.get<any[]>(cacheKey);
        if (cached) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(cached));
          return;
        }

        const news = await db
          .select()
          .from(flashNews)
          .orderBy(desc(flashNews.createdAt))
          .limit(limit);

        cacheService.set(cacheKey, news, 5); // 5s hot cache

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(news));
        return;
      }

      // 3. API: Trigger Ingestion Now
      if (url.pathname === "/api/poll" && req.method === "POST") {
        const result = await pollOnce();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
        return;
      }

      // 4. API: Run Safe SQL Query Playground
      if (url.pathname === "/api/sql" && req.method === "POST") {
        let body = "";
        const startTime = performance.now();
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          let sqlQuery = "";
          try {
            const parsed = JSON.parse(body || "{}");
            sqlQuery = parsed.sql;
            if (!sqlQuery) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing SQL query" }));
              return;
            }
            const rows = await executeReadOnlySql(sqlQuery);
            const durationMs = Math.round(performance.now() - startTime);

            cacheService.logMcpInteraction({
              tool: "query_financial_news_sql",
              args: { sql: sqlQuery },
              durationMs,
              isError: false,
              resultSummary: `Executed query, returned ${rows.length} row(s)`,
              source: "web",
              dataSource: "DB",
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ rows, count: rows.length }));
          } catch (err: any) {
            const durationMs = Math.round(performance.now() - startTime);
            cacheService.logMcpInteraction({
              tool: "query_financial_news_sql",
              args: { sql: sqlQuery },
              durationMs,
              isError: true,
              errorDetail: err.message || String(err),
              resultSummary: `SQL failed: ${err.message || String(err)}`,
              source: "web",
              dataSource: "DB",
            });

            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
        });
        return;
      }

      // 5. API: Semantic Vector Search
      if (url.pathname === "/api/semantic-search" && req.method === "POST") {
        let body = "";
        const startTime = performance.now();
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          let searchInput = "";
          try {
            const { query, limit = 10 } = JSON.parse(body || "{}");
            searchInput = query;
            if (!query) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing query" }));
              return;
            }
            const queryVec = await embeddingBatcher.embed(String(query), "query");
            const vectorStr = `[${queryVec.join(",")}]`;

            const results = await db.execute(
              `SELECT id, 
                      date_hkt AS "dateHkt", 
                      time_hkt AS "timeHkt", 
                      importance, 
                      is_alert AS "isAlert", 
                      category, 
                      direction, 
                      tickers, 
                      raw_content AS "rawContent",
                      ROUND((1 - (embedding <=> '${vectorStr}'::vector))::numeric, 4) AS similarity_score
               FROM flash_news
               WHERE embedding IS NOT NULL
               ORDER BY embedding <=> '${vectorStr}'::vector ASC
               LIMIT ${Math.min(Number(limit) || 10, 50)};`
            );

            const durationMs = Math.round(performance.now() - startTime);
            cacheService.logMcpInteraction({
              tool: "semantic_search_news",
              args: { query, limit },
              durationMs,
              isError: false,
              resultSummary: `Found ${results.rows.length} vector matches`,
              source: "web",
              dataSource: "VECTOR",
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(results.rows));
          } catch (err: any) {
            const durationMs = Math.round(performance.now() - startTime);
            cacheService.logMcpInteraction({
              tool: "semantic_search_news",
              args: { query: searchInput },
              durationMs,
              isError: true,
              errorDetail: err.message || String(err),
              resultSummary: `Semantic search failed: ${err.message || String(err)}`,
              source: "web",
              dataSource: "VECTOR",
            });

            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
        });
        return;
      }

      // 6. API: Reindex Missing Embeddings
      if (url.pathname === "/api/reindex" && req.method === "POST") {
        try {
          const { reindexMissingEmbeddings } = await import("../poller/index.js");
          const stats = await reindexMissingEmbeddings(50);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, ...stats }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || String(err) }));
        }
        return;
      }

      // 5. Serve HTML Dashboard
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const htmlPath = path.join(__dirname, "index.html");
        if (fs.existsSync(htmlPath)) {
          const htmlContent = fs.readFileSync(htmlPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlContent);
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Internal Server Error" }));
    }
  });

  server.listen(port, () => {
    console.log(`[Web Dashboard] Control Panel running at http://localhost:${port}`);
  });

  return server;
}
