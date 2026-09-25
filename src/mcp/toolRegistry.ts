import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { executeReadOnlySql } from "./sqlSafety.js";
import { NEWS_SCHEMA_DOC } from "./schemaDoc.js";
import { db } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { desc, eq, or, gte, ilike, and, sql, lt } from "drizzle-orm";
import { embeddingBatcher } from "../services/embeddingBatcher.js";
import { cacheService } from "../services/cache.js";
import { reindexMissingEmbeddings } from "../poller/index.js";

/**
 * Creates and registers tools on a new or existing MCP Server instance.
 * Shared between Stdio transport and remote SSE transports for multi-user sessions.
 */
export function createConfiguredMcpServer(defaultSource: "stdio" | "sse" | "web" = "sse"): Server {
  const server = new Server(
    {
      name: "mini-news",
      version: "2.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );


  // 1. Define Tool Catalog
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "describe_news_schema",
          description:
            "Returns PostgreSQL table schema, column descriptions, and sample SQL patterns to help write accurate financial queries.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "query_financial_news_sql",
          description:
            "Executes a validated read-only SQL query (SELECT / WITH only) with a 3000ms statement timeout. Max 300 rows returned.",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "PostgreSQL read-only SELECT query. Example: SELECT time_hkt, raw_content FROM flash_news WHERE raw_content ILIKE '%美聯儲%' ORDER BY created_at DESC LIMIT 10",
              },
            },
            required: ["sql"],
          },
        },
        {
          name: "get_latest_alerts",
          description:
            "Quickly fetches breaking news flashes with high importance (importance >= 2 or is_alert = true).",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of alerts to fetch (default: 10, max: 300)",
              },
            },
          },
        },
        {
          name: "search_news_hybrid",
          description:
            "Searches financial news by keyword, optional ticker, and time window.",
          inputSchema: {
            type: "object",
            properties: {
              keyword: {
                type: "string",
                description: "Search keyword in news content (e.g. 'CPI', '降息', '英偉達')",
              },
              ticker: {
                type: "string",
                description: "Optional ticker filter (e.g. 'AAPL', 'NVDA', 'BTC')",
              },
              limit: {
                type: "number",
                description: "Max results (default: 15, max: 300)",
              },
            },
          },
        },
        {
          name: "get_latest_financial_flash",
          description:
            "Fetch real-time financial flash news (7x24 live stream) with timestamps, categories, and optional cursor pagination.",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Number of records to return (default 20, max 100)",
              },
              cursor: {
                type: "string",
                description: "Optional cursor (created_at ISO string) for continuous streaming pagination",
              },
            },
          },
        },
        {
          name: "search_flash_by_time_window",
          description:
            "Search financial flash news items within a specific time window or pagination cursor to analyze news surrounding market events.",
          inputSchema: {
            type: "object",
            properties: {
              keyword: {
                type: "string",
                description: "Keyword to filter news content",
              },
              limit: {
                type: "number",
                description: "Max results (default: 20, max: 100)",
              },
              cursor: {
                type: "string",
                description: "Optional cursor (created_at ISO string) to fetch next batch in timeline",
              },
            },
          },
        },
        {
          name: "search_news_semantic",
          description:
            "Perform AI semantic vector search over financial flash news using continuous micro-batching and pgvector HNSW cosine similarity.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Natural language financial question or concept (e.g., '中東地緣政治對原油價格影響', '美聯儲降息及國債走勢')",
              },
              limit: {
                type: "number",
                description: "Max results to return (default: 5, max: 50)",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "reindex_news_embeddings",
          description:
            "Scans the financial database and computes MiniMax vector embeddings for news items that currently have NULL embeddings.",
          inputSchema: {
            type: "object",
            properties: {
              batch_size: {
                type: "number",
                description: "Number of news items to process in this batch (default: 20, max: 100)",
              },
            },
          },
        },
      ],
    };
  });

  // 2. Handle Tool Invocations
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startTime = performance.now();
    let detectedDataSource: "CACHE" | "DB" | "VECTOR" | "SCHEMA" = "DB";

    const executeTool = async () => {
      if (name === "describe_news_schema") {
        detectedDataSource = "SCHEMA";
        return {
          content: [
            {
              type: "text",
              text: NEWS_SCHEMA_DOC,
            },
          ],
        };
      }

      if (name === "query_financial_news_sql") {
        detectedDataSource = "DB";
        const rawSql = String(args?.sql || "").trim();
        if (!rawSql) {
          throw new Error("Missing required argument 'sql'");
        }
        const rows = await executeReadOnlySql(rawSql, 3000);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      }

      if (name === "get_latest_alerts") {
        const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 300);
        const cacheKey = `alerts:latest:${limit}`;
        const cached = cacheService.get<any[]>(cacheKey);
        if (cached) {
          detectedDataSource = "CACHE";
          return {
            content: [{ type: "text", text: JSON.stringify(cached, null, 2) }],
          };
        }

        detectedDataSource = "DB";
        const alerts = await db
          .select({
            id: flashNews.id,
            timeHkt: flashNews.timeHkt,
            dateHkt: flashNews.dateHkt,
            importance: flashNews.importance,
            category: flashNews.category,
            rawContent: flashNews.rawContent,
            direction: flashNews.direction,
            tickers: flashNews.tickers,
          })
          .from(flashNews)
          .where(or(eq(flashNews.isAlert, true), gte(flashNews.importance, 2)))
          .orderBy(desc(flashNews.createdAt))
          .limit(limit);

        cacheService.set(cacheKey, alerts, 5); // 5s hot cache

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(alerts, null, 2),
            },
          ],
        };
      }

      if (name === "search_news_hybrid") {
        detectedDataSource = "DB";
        const keyword = args?.keyword ? String(args.keyword) : undefined;
        const ticker = args?.ticker ? String(args.ticker).toUpperCase() : undefined;
        const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 300);

        const conditions = [];
        if (keyword) {
          conditions.push(ilike(flashNews.rawContent, `%${keyword}%`));
        }
        if (ticker) {
          conditions.push(sql`${flashNews.tickers} @> ${JSON.stringify([ticker])}::jsonb`);
        }

        const query = db
          .select({
            id: flashNews.id,
            timeHkt: flashNews.timeHkt,
            dateHkt: flashNews.dateHkt,
            importance: flashNews.importance,
            category: flashNews.category,
            rawContent: flashNews.rawContent,
            direction: flashNews.direction,
            tickers: flashNews.tickers,
          })
          .from(flashNews);

        const rows = conditions.length > 0
          ? await query.where(and(...conditions)).orderBy(desc(flashNews.createdAt)).limit(limit)
          : await query.orderBy(desc(flashNews.createdAt)).limit(limit);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      }

      if (name === "get_latest_financial_flash") {
        const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
        const cursor = args?.cursor ? new Date(String(args.cursor)) : null;

        // Hot cache non-cursor requests for 5 seconds to reduce DB load
        const cacheKey = !cursor ? `flash:latest:${limit}` : null;
        if (cacheKey) {
          const cached = cacheService.get<{ items: any[]; count: number; nextCursor: string | null; hasMore: boolean }>(cacheKey);
          if (cached) {
            detectedDataSource = "CACHE";
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(cached, null, 2),
                },
              ],
            };
          }
        }

        detectedDataSource = "DB";
        const conditions = [];
        if (cursor && !isNaN(cursor.getTime())) {
          conditions.push(lt(flashNews.createdAt, cursor));
        }

        const query = db
          .select({
            id: flashNews.id,
            createdAt: flashNews.createdAt,
            timeHkt: flashNews.timeHkt,
            dateHkt: flashNews.dateHkt,
            importance: flashNews.importance,
            category: flashNews.category,
            rawContent: flashNews.rawContent,
            direction: flashNews.direction,
            tickers: flashNews.tickers,
          })
          .from(flashNews);

        const rows = conditions.length > 0
          ? await query.where(and(...conditions)).orderBy(desc(flashNews.createdAt)).limit(limit)
          : await query.orderBy(desc(flashNews.createdAt)).limit(limit);

        const nextCursor = rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null;
        const resultPayload = {
          items: rows,
          count: rows.length,
          nextCursor,
          hasMore: rows.length === limit,
        };

        if (cacheKey) {
          cacheService.set(cacheKey, resultPayload, 5); // 5s hot cache
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(resultPayload, null, 2),
            },
          ],
        };
      }

      if (name === "search_flash_by_time_window") {
        detectedDataSource = "DB";
        const keyword = args?.keyword ? String(args.keyword) : undefined;
        const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
        const cursor = args?.cursor ? new Date(String(args.cursor)) : null;

        const conditions = [];
        if (keyword) {
          conditions.push(ilike(flashNews.rawContent, `%${keyword}%`));
        }
        if (cursor && !isNaN(cursor.getTime())) {
          conditions.push(lt(flashNews.createdAt, cursor));
        }

        const query = db
          .select({
            id: flashNews.id,
            createdAt: flashNews.createdAt,
            timeHkt: flashNews.timeHkt,
            dateHkt: flashNews.dateHkt,
            importance: flashNews.importance,
            category: flashNews.category,
            rawContent: flashNews.rawContent,
            direction: flashNews.direction,
            tickers: flashNews.tickers,
          })
          .from(flashNews);

        const rows = conditions.length > 0
          ? await query.where(and(...conditions)).orderBy(desc(flashNews.createdAt)).limit(limit)
          : await query.orderBy(desc(flashNews.createdAt)).limit(limit);

        const nextCursor = rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  items: rows,
                  count: rows.length,
                  nextCursor,
                  hasMore: rows.length === limit,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "search_news_semantic") {
        detectedDataSource = "VECTOR";
        const queryText = String(args?.query || "").trim();
        if (!queryText) {
          throw new Error("Missing required argument 'query'");
        }
        const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 50);

        // Dispatches through continuous micro-batcher queue
        const queryVec = await embeddingBatcher.embed(queryText, "query");
        const vectorStr = `[${queryVec.join(",")}]`;

        // Perform cosine distance vector search via pgvector HNSW
        const results = await db.execute(sql`
          SELECT 
            id, 
            date_hkt, 
            time_hkt, 
            importance,
            is_alert,
            category,
            direction, 
            tickers,
            raw_content,
            ROUND((1 - (embedding <=> ${vectorStr}::vector))::numeric, 4) AS similarity_score
          FROM flash_news
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${vectorStr}::vector ASC
          LIMIT ${limit};
        `);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results.rows, null, 2),
            },
          ],
        };
      }

      if (name === "reindex_news_embeddings") {
        detectedDataSource = "DB";
        const batchSize = Math.min(Math.max(Number(args?.batch_size) || 20, 1), 100);
        const stats = await reindexMissingEmbeddings(batchSize);
        return {
          content: [
            {
              type: "text",
              text: `Reindexing completed: scanned ${stats.processed} items without embeddings, successfully computed & updated ${stats.updated} vectors.`,
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    };

    try {
      const result = await executeTool();
      const durationMs = Math.round(performance.now() - startTime);
      let resultSummary = "";
      try {
        const textContent = result?.content?.[0]?.text;
        if (textContent) {
          resultSummary = textContent.length > 150 ? `${textContent.slice(0, 150)}...` : textContent;
        }
      } catch (_) {}

      cacheService.logMcpInteraction({
        tool: name,
        args: args as Record<string, unknown>,
        durationMs,
        isError: false,
        resultSummary,
        source: defaultSource,
        dataSource: detectedDataSource,
      });

      return result;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      const detail = err.cause ? ` (Cause: ${err.cause.message || err.cause})` : "";
      const errorMsg = `Error executing ${name}: ${err.message || String(err)}${detail}`;

      cacheService.logMcpInteraction({
        tool: name,
        args: args as Record<string, unknown>,
        durationMs,
        isError: true,
        errorDetail: errorMsg,
        resultSummary: errorMsg,
        source: defaultSource,
        dataSource: detectedDataSource,
      });

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: errorMsg,
          },
        ],
      };
    }
  });

  return server;
}
