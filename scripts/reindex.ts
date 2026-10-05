import { pool, initDatabase } from "../src/db/index.js";
import { reindexMissingEmbeddings } from "../src/poller/index.js";

async function main() {
  console.log("[Reindexer] Initializing DB and HNSW index...");
  await initDatabase();

  // Re-create the HNSW index with m=32, ef_construction=128
  const client = await pool.connect();
  try {
    console.log("[Reindexer] Recreating idx_flash_news_embedding_hnsw with m=32, ef_construction=128...");
    await client.query("DROP INDEX IF EXISTS idx_flash_news_embedding_hnsw;");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_flash_news_embedding_hnsw 
      ON flash_news USING hnsw (embedding vector_cosine_ops)
      WITH (m = 32, ef_construction = 128);
    `);
    console.log("[Reindexer] HNSW index successfully updated.");
  } finally {
    client.release();
  }

  console.log("[Reindexer] Reindexing records with contextual metadata (Tickers, Categories, Direction)...");
  const result = await reindexMissingEmbeddings(50, true);
  console.log("[Reindexer] Completed! Processed:", result.processed, "Updated:", result.updated);

  await pool.end();
}

main().catch((err) => {
  console.error("[Reindexer] Error:", err);
  process.exit(1);
});
