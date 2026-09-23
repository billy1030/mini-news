import { initDatabase, pool } from "../src/db/index.js";

async function testConnection() {
  console.log("=== Testing Database Connection & pgvector ===");
  try {
    await initDatabase();
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT version(), current_setting('client_encoding') as encoding;");
      console.log("PostgreSQL Version & Encoding:", res.rows[0]);

      const extRes = await client.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';");
      console.log("pgvector status:", extRes.rows[0] || "Not installed");
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Database connection failed:", error);
  } finally {
    await pool.end();
  }
}

testConnection();
