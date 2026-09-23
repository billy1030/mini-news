import { startPoller } from "./poller/index.js";
import { startMcpServer } from "./mcp/server.js";

async function main() {
  console.log("=== Mini-News Service Starting ===");

  // Mode: If launched as standalone MCP server vs with background poller
  const isMcpOnly = process.argv.includes("--mcp-only");

  if (!isMcpOnly) {
    // Start background ingestion poller
    startPoller().catch((err) => {
      console.error("[Main] Poller startup error:", err);
    });
  }

  // Start MCP Server on stdio transport
  await startMcpServer();
}

main().catch((err) => {
  console.error("[Main] Fatal process error:", err);
  process.exit(1);
});
