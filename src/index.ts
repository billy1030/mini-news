import * as dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load .env relative to project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

import { startPoller } from "./poller/index.js";
import { startMcpServer } from "./mcp/server.js";
import { startWebServer } from "./web/server.js";
import { initDatabase } from "./db/index.js";

async function main() {
  const isMcpOnly = process.argv.includes("--mcp-only");
  const isWebOnly = process.argv.includes("--web-only");

  if (!isMcpOnly) {
    console.log("=== Mini-News Service Starting ===");
  }

  // Ensure DB schema & tables (e.g. mcp_audit_logs, pgvector) are ready
  if (isMcpOnly) {
    await initDatabase().catch((err) => {
      console.error("[MCP Stdio] Database init error:", err.message);
    });
  }

  // 1. Start Web Dashboard on port 5200 (unless strictly MCP only)
  if (!isMcpOnly) {
    const port = Number(process.env.PORT) || 5200;
    startWebServer(port);
  }

  // 2. Start background ingestion poller
  if (!isMcpOnly) {
    startPoller().catch((err) => {
      console.error("[Main] Poller startup error:", err);
    });
  }

  // 3. Start MCP Server on stdio transport (unless web only)
  if (!isWebOnly) {
    await startMcpServer();
  } else {
    // Keep process alive in web-only mode
    setInterval(() => {}, 1000 * 60 * 60);
  }
}

main().catch((err) => {
  console.error("[Main] Fatal process error:", err);
  process.exit(1);
});
