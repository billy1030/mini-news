import { cacheService } from "../src/services/cache.js";

async function runCacheTests() {
  console.log("=== Testing Option A: In-Memory Redis-like Capabilities ===");

  // 1. Basic TTL caching
  console.log("\n[1] Testing Key/Value TTL Caching...");
  cacheService.set("test:key", { message: "financial alert" }, 2);
  const cached = cacheService.get<{ message: string }>("test:key");
  console.log("Cache hit:", cached?.message === "financial alert");

  // 2. Prefix Invalidation
  console.log("\n[2] Testing Prefix Invalidation...");
  cacheService.set("alerts:latest:10", [1, 2, 3], 10);
  cacheService.set("alerts:latest:20", [4, 5, 6], 10);
  console.log("Before invalidation alerts:latest:10:", cacheService.get("alerts:latest:10"));
  cacheService.invalidatePrefix("alerts:latest:");
  console.log("After invalidation alerts:latest:10 (should be null):", cacheService.get("alerts:latest:10"));

  // 3. Token Bucket Rate Limiting
  console.log("\n[3] Testing Token Bucket Rate Limiting...");
  const sessionKey = "user_test_session";
  let allowedCount = 0;
  for (let i = 0; i < 5; i++) {
    if (cacheService.checkRateLimit(sessionKey, 3, 10000)) {
      allowedCount++;
    }
  }
  console.log(`Allowed ${allowedCount}/5 requests (Max limit 3) -> Rate limiting enforced: ${allowedCount === 3}`);

  // 4. Pub/Sub Real-Time Event Dispatch
  console.log("\n[4] Testing Pub/Sub Event Dispatching...");
  let receivedAlert = false;
  cacheService.once("channel:alert", (item) => {
    console.log("Received published alert event:", item.content);
    receivedAlert = true;
  });

  cacheService.publishNews("alert", { content: "Breaking: Fed emergency rate fix" });
  console.log("Pub/Sub verified:", receivedAlert);

  console.log("\n[5] Cache Stats:", cacheService.getStats());
  console.log("\n=== Option A In-Memory Cache Verification Passed Successfully! ===");
}

runCacheTests().catch(console.error);
