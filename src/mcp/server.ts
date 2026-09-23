import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { executeReadOnlySql } from "./sqlSafety.js";
import { NEWS_SCHEMA_DOC } from "./schemaDoc.js";
import { db } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { desc, eq, or, gte, ilike, and, sql } from "drizzle-orm";
import { getMinimaxEmbeddings } from "../services/embedding.js";
import { reindexMissingEmbeddings } from "../poller/index.js";

/**
 * Initialize and start the MCP Server
 */
export async function startMcpServer() {
  const server = new Server(
    {
      name: "mini-news",
      version: "1.0.0",
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
            "Executes a validated read-only SQL query (SELECT / WITH only) against the financial flash news database. Max 300 rows returned.",
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
            "Fetch real-time financial flash news (7x24 live stream) with timestamps, categories, and importance alerts (e.g. Hong Kong stocks, A-shares, US premarket, FX fixes, commodities).",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Number of records to return (default 20, max 50)",
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
                description: "Max results (default: 20)",
              },
            },
          },
        },
        {
          name: "search_news_semantic",
          description:
            "Perform AI semantic vector search (via MiniMax embo-01 and pgvector HNSW cosine similarity) over financial flash news. Retrieves conceptual matches even when keywords do not strictly match.",
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

  // 2. Handle Tool Calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "describe_news_schema") {
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
        const sqlQuery = String(args?.sql || "");
        if (!sqlQuery) {
          throw new Error("Missing required argument 'sql'");
        }

        const rows = await executeReadOnlySql(sqlQuery);
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

        const results = conditions.length > 0
          ? await query.where(and(...conditions)).orderBy(desc(flashNews.createdAt)).limit(limit)
          : await query.orderBy(desc(flashNews.createdAt)).limit(limit);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      if (name === "get_latest_financial_flash") {
        const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 300);
        const rows = await db
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
          .orderBy(desc(flashNews.createdAt))
          .limit(limit);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      }

      if (name === "search_flash_by_time_window") {
        const keyword = args?.keyword ? String(args.keyword) : undefined;
        const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 300);
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

        const rows = keyword
          ? await query.where(ilike(flashNews.rawContent, `%${keyword}%`)).orderBy(desc(flashNews.createdAt)).limit(limit)
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

      if (name === "search_news_semantic") {
        const queryText = String(args?.query || "").trim();
        if (!queryText) {
          throw new Error("Missing required argument 'query'");
        }
        const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 50);

        // 1. Generate query embedding via MiniMax embo-01 (type: query)
        const [queryVec] = await getMinimaxEmbeddings([queryText], "query");
        const vectorStr = `[${queryVec.join(",")}]`;

        // 2. Perform cosine distance vector search via pgvector HNSW
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
    } catch (err: any) {
      const detail = err.cause ? ` (Cause: ${err.cause.message || err.cause})` : "";
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${err.message || String(err)}${detail}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] mini-news MCP server running on stdio transport.");
}
