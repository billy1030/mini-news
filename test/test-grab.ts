import { fetchLiveNews } from "../src/poller/fetcher.js";
import { parseRawNews } from "../src/parser/index.js";

async function run() {
  console.log("=== Testing Live News Fetcher and Parser ===");
  try {
    const rawItems = await fetchLiveNews();
    console.log(`Successfully fetched ${rawItems.length} items from upstream.`);

    if (rawItems.length > 0) {
      console.log("\n--- Sample Raw Item ---");
      console.log(JSON.stringify(rawItems[0], null, 2));

      console.log("\n--- Parsed Entity ---");
      const parsed = parseRawNews(rawItems[0]);
      console.log(JSON.stringify(parsed, null, 2));
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

run();
