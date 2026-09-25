import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createConfiguredMcpServer } from "./toolRegistry.js";
import { cacheService } from "../services/cache.js";
import http from "node:http";

interface SessionEntry {
  id: string;
  server: Server;
  transport: SSEServerTransport;
  createdAt: Date;
  lastActiveAt: Date;
  unsubscribeAlerts?: () => void;
}

/**
 * Manages concurrent, isolated multi-user MCP sessions over Server-Sent Events (SSE).
 */
export class McpSessionManager {
  private sessions = new Map<string, SessionEntry>();

  constructor() {
    // Background garbage collection for inactive sessions (TTL: 30 minutes)
    setInterval(() => this.cleanupInactiveSessions(), 60 * 1000).unref();
  }

  /**
   * Handles GET /sse: Creates a new SSE transport and attaches an isolated MCP server.
   */
  public async handleSseConnection(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/message", res);
    const server = createConfiguredMcpServer();

    await server.connect(transport);
    const sessionId = transport.sessionId;

    // Pub/Sub listener: Forward breaking alerts directly into client logging/notification channel
    const onAlert = (item: Record<string, unknown>) => {
      server.sendLoggingMessage({
        level: "warning",
        data: `[Breaking Alert] ${item.timeHkt || ""}: ${String(item.rawContent || "").slice(0, 120)}...`,
      }).catch(() => {});
    };

    cacheService.on("channel:alert", onAlert);

    const entry: SessionEntry = {
      id: sessionId,
      server,
      transport,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      unsubscribeAlerts: () => cacheService.off("channel:alert", onAlert),
    };

    this.sessions.set(sessionId, entry);
    console.log(`[MCP SSE] New session created: ${sessionId} (Active sessions: ${this.sessions.size})`);

    // Clean up when connection closes
    req.on("close", () => {
      entry.unsubscribeAlerts?.();
      this.sessions.delete(sessionId);
      console.log(`[MCP SSE] Session closed: ${sessionId} (Active sessions: ${this.sessions.size})`);
    });
  }

  /**
   * Handles POST /message: Dispatches incoming JSON-RPC calls with token-bucket rate limiting.
   */
  public async handleIncomingMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    // Rate limit check: max 60 calls per minute per session
    const allowed = cacheService.checkRateLimit(`session:${sessionId}`, 60, 60000);
    if (!allowed) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "60",
      });
      res.end(JSON.stringify({ error: "Rate limit exceeded (Max 60 requests per minute)." }));
      return;
    }

    const session = this.sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Session not found or expired: ${sessionId}` }));
      return;
    }

    session.lastActiveAt = new Date();
    await session.transport.handlePostMessage(req, res);
  }

  private cleanupInactiveSessions() {
    const now = Date.now();
    const timeoutMs = 30 * 60 * 1000; // 30 minutes

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt.getTime() > timeoutMs) {
        console.log(`[MCP SSE] Expiring inactive session: ${id}`);
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Returns current session metrics
   */
  public getMetrics() {
    return {
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      })),
    };
  }
}

export const mcpSessionManager = new McpSessionManager();
