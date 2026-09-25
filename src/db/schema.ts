import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";

/**
 * Custom vector type for pgvector extension
 */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
});

/**
 * flash_news table:
 * Stores real-time financial flash news ingested from 7x24 feeds.
 *
 * Design considerations:
 * 1. created_at (timestamptz): UTC epoch timestamp, preventing time drift.
 * 2. date_hkt & time_hkt: Pre-computed Hong Kong Time (Asia/Hong_Kong) strings for direct querying.
 * 3. raw_content: UTF-8 encoded text supporting traditional/simplified Chinese, English, financial symbols.
 * 4. tickers: JSONB array containing recognized stock/crypto/commodity tickers (e.g. ["AAPL", "BTC"]).
 * 5. embedding: 1536-dimensional vector for semantic similarity retrieval via pgvector.
 */
export const flashNews = pgTable(
  "flash_news",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    dateHkt: date("date_hkt").notNull(), // Format: YYYY-MM-DD
    timeHkt: varchar("time_hkt", { length: 8 }).notNull(), // Format: HH:mm or HH:mm:ss
    importance: integer("importance").notNull().default(0), // 0: Normal, 1-2: Notable, 3: Flash / High Alert
    isAlert: boolean("is_alert").notNull().default(false), // Flag for red-alert/breaking news
    category: varchar("category", { length: 64 }).notNull().default("general"),
    rawContent: text("raw_content").notNull(),
    tickers: jsonb("tickers").$type<string[]>().notNull().default([]),
    direction: varchar("direction", { length: 16 }).default("FLAT"), // 'UP', 'DOWN', 'FLAT'
    embedding: vector("embedding"), // 1536-dim embedding vector
  },
  (table) => [
    index("idx_flash_news_created_at").on(table.createdAt),
    index("idx_flash_news_date_hkt").on(table.dateHkt),
    index("idx_flash_news_importance").on(table.importance),
    index("idx_flash_news_category").on(table.category),
  ]
);

export type FlashNews = typeof flashNews.$inferSelect;
export type NewFlashNews = typeof flashNews.$inferInsert;

/**
 * mcp_audit_logs table:
 * Stores rolling MCP tool call interactions across all processes (stdio, sse, web).
 * Automatically pruned to keep only recent activity.
 */
export const mcpAuditLogs = pgTable(
  "mcp_audit_logs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    tool: varchar("tool", { length: 128 }).notNull(),
    args: jsonb("args").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms").notNull().default(0),
    isError: boolean("is_error").notNull().default(false),
    errorDetail: text("error_detail"),
    resultSummary: text("result_summary"),
    source: varchar("source", { length: 32 }).notNull().default("stdio"),
    dataSource: varchar("data_source", { length: 32 }).notNull().default("DB"),
  },
  (table) => [
    index("idx_mcp_audit_created_at").on(table.createdAt),
    index("idx_mcp_audit_tool").on(table.tool),
    index("idx_mcp_audit_source").on(table.source),
  ]
);

export type McpAuditLog = typeof mcpAuditLogs.$inferSelect;
export type NewMcpAuditLog = typeof mcpAuditLogs.$inferInsert;

