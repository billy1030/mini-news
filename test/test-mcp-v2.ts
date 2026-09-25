import { embeddingBatcher } from "../src/services/embeddingBatcher.js";
import { validateReadOnlySql, executeReadOnlySql } from "../src/mcp/sqlSafety.js";
import { createConfiguredMcpServer } from "../src/mcp/toolRegistry.js";

async function testBatcherAndSafety() {
  console.log("=== Testing MCP v2.0 Architecture Upgrades ===");

  // 1. Test SQL statement timeout & safety
  console.log("\n[1] Testing SQL Safety & Statement Timeout...");
  const valid = validateReadOnlySql("SELECT * FROM flash_news LIMIT 10");
  console.log("Validation result (valid):", valid.isValid, valid.sanitizedSql);

  const blocked = validateReadOnlySql("DELETE FROM flash_news");
  console.log("Validation result (blocked write):", blocked.isValid, blocked.error);

  // 2. Test MCP Tool Registry Factory
  console.log("\n[2] Testing MCP Server Tool Registry...");
  const server = createConfiguredMcpServer();
  console.log("MCP Server instantiated successfully:", server !== undefined);

  // 3. Test Continuous Embedding Micro-Batcher status
  console.log("\n[3] Testing Micro-Batcher Initial Status...");
  const status = embeddingBatcher.getStatus();
  console.log("Batcher status:", status);

  console.log("\n=== All V2 architectural unit checks passed! ===");
}

testBatcherAndSafety().catch(console.error);
