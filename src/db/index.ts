import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as dotenv from "dotenv";
import * as schema from "./schema.js";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgrespassword@localhost:5232/mini_news";

/**
 * PostgreSQL Connection Pool configuration
 * UTF-8 client encoding and connection resilience.
 */
export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });

/**
 * Ensures the pgvector extension is enabled on database startup
 */
export async function initDatabase() {
  const client = await pool.connect();
  try {
    // Enable pgvector and pg_trgm extensions
    await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    // Ensure UTF8 client encoding
    await client.query("SET client_encoding = 'UTF8';");
    // Ensure HNSW index on embedding column exists with enhanced graph recall (m=32, ef_construction=128)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_flash_news_embedding_hnsw 
      ON flash_news USING hnsw (embedding vector_cosine_ops)
      WITH (m = 32, ef_construction = 128);
    `);
    // Ensure pg_trgm GIN index on raw_content exists for sub-millisecond SQL LIKE / ILIKE queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_flash_news_trgm_content 
      ON flash_news USING gin (raw_content gin_trgm_ops);
    `);
    // Ensure JSONB GIN index on tickers exists for O(1) containment queries (@> '["TICKER"]')
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_flash_news_tickers_gin 
      ON flash_news USING gin (tickers);
    `);
    // Ensure composite index on direction + created_at for instant sentiment filtering without sort overhead
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_flash_news_direction_time 
      ON flash_news (direction, created_at DESC);
    `);
    // Ensure mcp_audit_logs table exists for cross-process audit trails
    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tool VARCHAR(128) NOT NULL,
        args JSONB,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        is_error BOOLEAN NOT NULL DEFAULT FALSE,
        error_detail TEXT,
        result_summary TEXT,
        source VARCHAR(32) NOT NULL DEFAULT 'stdio',
        data_source VARCHAR(32) NOT NULL DEFAULT 'DB'
      );
      ALTER TABLE mcp_audit_logs ADD COLUMN IF NOT EXISTS data_source VARCHAR(32) DEFAULT 'DB';
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_created_at ON mcp_audit_logs (created_at);
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool ON mcp_audit_logs (tool);
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_source ON mcp_audit_logs (source);
    `);
  } finally {
    client.release();
  }
}

