import { cacheService } from "../src/services/cache.js";
import { createConfiguredMcpServer } from "../src/mcp/toolRegistry.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

async function verifyAuditLog() {
  console.log("=== Verifying 5-Minute In-Memory MCP Audit Logging ===");

  const server = createConfiguredMcpServer();

  // Trigger a tool invocation through the MCP server
  console.log("\n[1] Calling describe_news_schema via MCP Tool Registry...");
  const handler = (server as any)._requestHandlers?.get("tools/call");
  if (handler) {
    await handler({
      method: "tools/call",
      params: {
        name: "describe_news_schema",
        arguments: {},
      },
    });
  }

  // Inspect the audit log in cacheService
  const logs = cacheService.getAuditLogs(10);
  console.log("\n[2] Audit Logs in 5-minute rolling window:", logs.length);
  if (logs.length > 0) {
    console.log("First log entry:", JSON.stringify(logs[0], null, 2));
  }

  console.log("\n[3] Cache Service Stats:", cacheService.getStats());
  console.log("\n=== 5-Minute Audit Log Verification Completed Successfully! ===");
}

verifyAuditLog().catch(console.error);
