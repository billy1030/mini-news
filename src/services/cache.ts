import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { mcpAuditLogs } from "../db/schema.js";
import { desc, gte } from "drizzle-orm";

interface CacheEntry<T> {

  value: T;
  expiresAt: number;
}

export interface McpAuditLogEntry {
  id: string;
  timestamp: string;
  tool: string;
  args?: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
  errorDetail?: string;
  resultSummary?: string;
  source: "stdio" | "sse" | "web";
  dataSource?: "CACHE" | "DB" | "VECTOR" | "SCHEMA";
}

/**
 * High-performance, zero-dependency in-memory cache and event bus.
 * Implements Redis-like TTL caching, SHA-256 vector deduplication,
 * token bucket rate limiting, real-time news Pub/Sub, and 15-minute rolling MCP audit logs.
 */
export class CacheService extends EventEmitter {
  private cache = new Map<string, CacheEntry<any>>();
  private rateLimits = new Map<string, { tokens: number; lastRefill: number }>();
  private auditLogs: McpAuditLogEntry[] = [];
  private readonly maxEntries: number;
  private readonly auditLogTtlMs: number = 15 * 60 * 1000; // 15 minutes rolling window
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxEntries: number = 2000) {
    super();
    this.maxEntries = maxEntries;

    // Background garbage collection sweep every 15 seconds
    setInterval(() => {
      this.pruneExpired();
      this.pruneAuditLogs();
    }, 15 * 1000).unref();
  }

  /**
   * Retrieves an item from the cache if not expired.
   */
  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  /**
   * Stores an item with a specified TTL in seconds.
   */
  public set<T>(key: string, value: T, ttlSeconds: number = 10): void {
    if (this.cache.size >= this.maxEntries) {
      this.pruneOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Invalidate keys matching a prefix or pattern
   */
  public invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Generates a stable SHA-256 hash key for semantic queries or SQL
   */
  public hashKey(input: string): string {
    return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
  }

  /**
   * Token bucket rate limiter: Allows up to `maxTokens` per minute.
   * Returns true if allowed, false if rate limited.
   */
  public checkRateLimit(key: string, maxTokens: number = 60, refillTimeMs: number = 60000): boolean {
    const now = Date.now();
    let bucket = this.rateLimits.get(key);

    if (!bucket) {
      bucket = { tokens: maxTokens - 1, lastRefill: now };
      this.rateLimits.set(key, bucket);
      return true;
    }

    // Refill tokens proportionally over elapsed time
    const elapsed = now - bucket.lastRefill;
    if (elapsed > refillTimeMs) {
      bucket.tokens = maxTokens;
      bucket.lastRefill = now;
    }

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return true;
    }

    return false;
  }

  /**
   * Broadcasts real-time news item to all subscribed SSE / MCP clients
   */
  public publishNews(channel: "flash" | "alert", newsItem: Record<string, unknown>): void {
    this.emit(`channel:${channel}`, newsItem);
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private pruneOldest() {
    // Delete the oldest 10% of items to prevent memory growth
    const deleteCount = Math.ceil(this.maxEntries * 0.1);
    const keys = Array.from(this.cache.keys()).slice(0, deleteCount);
    keys.forEach((k) => this.cache.delete(k));
  }

  /**
   * Appends an MCP request/response entry to the 5-minute in-memory rolling audit log
   * and persists it asynchronously to the PostgreSQL database for cross-process visibility (e.g. stdio MiniBot).
   */
  public logMcpInteraction(entry: Omit<McpAuditLogEntry, "id" | "timestamp">): void {
    const logItem: McpAuditLogEntry = {
      id: crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLogs.unshift(logItem); // Newest first

    // Prevent unbounded memory growth if high load occurs in 5 minutes (max 1000 logs)
    if (this.auditLogs.length > 1000) {
      this.auditLogs.length = 1000;
    }

    // Fire-and-forget async insert into PostgreSQL for cross-process observability
    db.insert(mcpAuditLogs)
      .values({
        id: logItem.id,
        createdAt: new Date(logItem.timestamp),
        tool: logItem.tool,
        args: logItem.args,
        durationMs: logItem.durationMs,
        isError: logItem.isError,
        errorDetail: logItem.errorDetail,
        resultSummary: logItem.resultSummary,
        source: logItem.source,
        dataSource: logItem.dataSource || "DB",
      })
      .catch((err) => {
        // Non-blocking error handling for audit trail
        console.error("[CacheService] Failed to persist MCP audit log to DB:", err.message);
      });
  }

  /**
   * Retrieves recent audit logs within the 15-minute window from memory.
   */
  public getAuditLogs(limit: number = 50): McpAuditLogEntry[] {
    const cutoff = Date.now() - this.auditLogTtlMs;
    return this.auditLogs
      .filter((l) => new Date(l.timestamp).getTime() >= cutoff)
      .slice(0, limit);
  }

  /**
   * Retrieves recent audit logs from PostgreSQL within the 15-minute window (unifying stdio and web/sse processes).
   */
  public async getAuditLogsAsync(limit: number = 50): Promise<McpAuditLogEntry[]> {
    try {
      const cutoffDate = new Date(Date.now() - this.auditLogTtlMs);
      const rows = await db
        .select()
        .from(mcpAuditLogs)
        .where(gte(mcpAuditLogs.createdAt, cutoffDate))
        .orderBy(desc(mcpAuditLogs.createdAt))
        .limit(limit);

      if (rows && rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          timestamp: r.createdAt.toISOString(),
          tool: r.tool,
          args: r.args || undefined,
          durationMs: r.durationMs,
          isError: r.isError,
          errorDetail: r.errorDetail || undefined,
          resultSummary: r.resultSummary || undefined,
          source: (r.source as "stdio" | "sse" | "web") || "stdio",
          dataSource: (r.dataSource as "CACHE" | "DB" | "VECTOR" | "SCHEMA") || "DB",
        }));
      }
    } catch (err: any) {
      console.error("[CacheService] Falling back to memory audit logs:", err.message);
    }

    // Fallback to local memory logs if DB query fails or has no entries
    return this.getAuditLogs(limit);
  }

  private pruneAuditLogs() {
    const cutoff = Date.now() - this.auditLogTtlMs;
    this.auditLogs = this.auditLogs.filter((l) => new Date(l.timestamp).getTime() >= cutoff);
  }

  public getStats() {
    const cutoff = Date.now() - this.auditLogTtlMs;
    const activeAuditLogs = this.auditLogs.filter((l) => new Date(l.timestamp).getTime() >= cutoff);
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? ((this.hits / totalRequests) * 100).toFixed(1) + "%" : "0.0%";

    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      rateLimitBuckets: this.rateLimits.size,
      auditLogsCount15m: activeAuditLogs.length,
      auditLogsCount5m: activeAuditLogs.length,
      hits: this.hits,
      misses: this.misses,
      hitRate,
    };
  }
}

export const cacheService = new CacheService();


