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
    // Enable pgvector extension
    await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    // Ensure UTF8 client encoding
    await client.query("SET client_encoding = 'UTF8';");
    // Ensure HNSW index on embedding column exists for fast cosine similarity search
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_flash_news_embedding_hnsw ON flash_news USING hnsw (embedding vector_cosine_ops);"
    );
  } finally {
    client.release();
  }
}
