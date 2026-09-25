import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConfiguredMcpServer } from "./toolRegistry.js";

/**
 * Initialize and start the MCP Server on Stdio transport (for local CLI / IDE agents)
 */
export async function startMcpServer() {
  const server = createConfiguredMcpServer("stdio");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] mini-news MCP server running on stdio transport.");
}

export { createConfiguredMcpServer } from "./toolRegistry.js";
