import { reindexMissingEmbeddings } from "../src/poller/index.js";
import { getMinimaxEmbeddings } from "../src/services/embedding.js";
import { db } from "../src/db/index.js";
import { sql } from "drizzle-orm";

async function run() {
  console.log("=== Testing Vector Indexing & Semantic Retrieval ===");

  // 1. Reindex a batch of existing news
  console.log("1. Running reindexMissingEmbeddings...");
  const reindexStats = await reindexMissingEmbeddings(10);
  console.log(`Reindex result: processed ${reindexStats.processed}, updated ${reindexStats.updated}`);

  // 2. Perform a test semantic search
  const query = "央行發行債券或票據";
  console.log(`\n2. Performing semantic search for: "${query}"...`);
  const [queryVec] = await getMinimaxEmbeddings([query], "query");
  const vectorStr = `[${queryVec.join(",")}]`;

  const results = await db.execute(sql`
    SELECT 
      id, 
      date_hkt, 
      time_hkt, 
      direction, 
      raw_content,
      ROUND((1 - (embedding <=> ${vectorStr}::vector))::numeric, 4) AS similarity_score
    FROM flash_news
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector ASC
    LIMIT 3;
  `);

  console.log(`Found ${results.rows.length} semantic matches:`);
  results.rows.forEach((r: any, idx: number) => {
    console.log(`\n[Match #${idx + 1}] Similarity: ${r.similarity_score} | Time: ${r.time_hkt}`);
    console.log(`Content: ${r.raw_content.slice(0, 100)}...`);
  });

  console.log("\n=== Vector Semantic Test Completed Successfully ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
