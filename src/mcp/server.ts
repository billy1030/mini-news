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

/**
 * Initialize and start the MCP Server
 */
export async function startMcpServer() {
  const server = new Server(
    {
      name: "mini-news-flash",
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
            "Executes a validated read-only SQL query (SELECT / WITH only) against the financial flash news database. Max 50 rows returned.",
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
                description: "Maximum number of alerts to fetch (default: 10, max: 50)",
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
                description: "Max results (default: 15, max: 50)",
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
        const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 50);
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
        const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 50);

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
        const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 50);
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
        const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 50);
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

      throw new Error(`Unknown tool: ${name}`);
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${err.message || String(err)}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] mini-news MCP server running on stdio transport.");
}
