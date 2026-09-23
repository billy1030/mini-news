import { startPoller } from "./poller/index.js";
import { startMcpServer } from "./mcp/server.js";
import { startWebServer } from "./web/server.js";

async function main() {
  console.log("=== Mini-News Service Starting ===");

  const isMcpOnly = process.argv.includes("--mcp-only");
  const isWebOnly = process.argv.includes("--web-only");

  // 1. Start Web Dashboard on port 5200 (unless strictly MCP only)
  if (!isMcpOnly) {
    const port = Number(process.env.PORT) || 5200;
    startWebServer(port);
  }

  // 2. Start background ingestion poller
  if (!isMcpOnly && !isWebOnly) {
    startPoller().catch((err) => {
      console.error("[Main] Poller startup error:", err);
    });
  }

  // 3. Start MCP Server on stdio transport (unless web only)
  if (!isWebOnly) {
    await startMcpServer();
  }
}

main().catch((err) => {
  console.error("[Main] Fatal process error:", err);
  process.exit(1);
});
