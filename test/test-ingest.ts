import { pollOnce } from "../src/poller/index.js";
import { db } from "../src/db/index.js";
import { flashNews } from "../src/db/schema.js";
import { sql } from "drizzle-orm";

async function testIngestionAndQuery() {
  console.log("=== Testing Real News Ingestion & SQL Querying ===");

  // 1. Run one ingestion cycle
  const stats = await pollOnce();
  console.log(`Ingestion completed: Fetched ${stats.fetched} items, Inserted ${stats.inserted} new rows.`);

  // 2. Query total rows
  const countResult = await db.execute(sql`SELECT count(*) as total FROM flash_news;`);
  console.log("Total rows in flash_news table:", countResult.rows[0]);

  // 3. Sample query
  const sampleNews = await db
    .select({
      id: flashNews.id,
      dateHkt: flashNews.dateHkt,
      timeHkt: flashNews.timeHkt,
      rawContent: flashNews.rawContent,
      direction: flashNews.direction,
      tickers: flashNews.tickers,
      importance: flashNews.importance,
    })
    .from(flashNews)
    .limit(3);

  console.log("\nSample Stored Records in PostgreSQL:");
  console.log(JSON.stringify(sampleNews, null, 2));

  process.exit(0);
}

testIngestionAndQuery().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
