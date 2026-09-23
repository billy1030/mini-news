import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { pollOnce } from "../poller/index.js";
import { executeReadOnlySql } from "../mcp/sqlSafety.js";
import { desc, count } from "drizzle-orm";

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
      // 1. API: Get System Status & Config
      if (url.pathname === "/api/status" && req.method === "GET") {
        const [totalCount] = await db.select({ value: count() }).from(flashNews);
        const config = {
          port,
          dbUrl: (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@"),
          pollInterval: Number(process.env.POLL_INTERVAL_SECONDS) || 60,
          sourceUrl: process.env.SOURCE_API_URL || "https://mutemute.com/mutenews/ajax/app-news.php",
          totalRecords: totalCount?.value || 0,
          nodeEnv: process.env.NODE_ENV || "development",
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(config));
        return;
      }

      // 2. API: Get Latest Live News
      if (url.pathname === "/api/news" && req.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 50);
        const news = await db
          .select()
          .from(flashNews)
          .orderBy(desc(flashNews.createdAt))
          .limit(limit);

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
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { sql } = JSON.parse(body || "{}");
            if (!sql) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing SQL query" }));
              return;
            }
            const rows = await executeReadOnlySql(sql);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ rows, count: rows.length }));
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
        });
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
