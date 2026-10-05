import { db, initDatabase } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { parseRawNews } from "../parser/index.js";
import { fetchLiveNews } from "./fetcher.js";
import { getMinimaxEmbeddings } from "../services/embedding.js";
import { cacheService } from "../services/cache.js";
import { isNull, desc, and, gte } from "drizzle-orm";

let pollIntervalMs =
  (Number(process.env.POLL_INTERVAL_SECONDS) || 60) * 1000;

let pollTimeoutHandle: NodeJS.Timeout | null = null;
let pollLoopFn: (() => Promise<void>) | null = null;

export function setPollInterval(seconds: number): void {
  const safeSeconds = Math.max(15, Math.min(300, seconds));
  pollIntervalMs = safeSeconds * 1000;
  process.env.POLL_INTERVAL_SECONDS = String(safeSeconds);
  console.log(`[Poller] Poll interval updated to ${safeSeconds} seconds.`);
  if (pollTimeoutHandle && isPolling && pollLoopFn) {
    clearTimeout(pollTimeoutHandle);
    pollTimeoutHandle = setTimeout(pollLoopFn, pollIntervalMs);
  }
}

export function getPollInterval(): number {
  return pollIntervalMs / 1000;
}

let isPolling = false;

/**
 * Executes a single ingestion iteration with automatic MiniMax vector embeddings
 */
/**
 * Constructs an enriched, high-recall representation for vector indexing.
 * Combines tickers, category, sentiment direction, and raw content.
 * Requires at least 6 characters of content to avoid index pollution.
 */
export function buildIndexableText(
  item: {
    rawContent?: string | null;
    tickers?: string[] | null;
    category?: string | null;
    direction?: string | null;
  },
  minChar: number = 3
): string | null {
  const content = (item.rawContent || "").trim();
  // Filter out noise, empty fragments, or items with fewer than minChar characters (min 3)
  if (content.length < Math.max(1, minChar)) {
    return null;
  }

  const parts: string[] = [];
  if (item.tickers && item.tickers.length > 0) {
    parts.push(`【標的/代碼】: ${item.tickers.join(" ")}`);
  }
  if (item.direction && item.direction !== "FLAT") {
    parts.push(`【走勢】: ${item.direction === "UP" ? "看多/上漲" : "看空/下跌"}`);
  }
  if (item.category && item.category !== "general") {
    parts.push(`【板塊】: ${item.category}`);
  }
  parts.push(content);

  return parts.join(" | ");
}

export async function pollOnce(): Promise<{ fetched: number; inserted: number }> {
  const rawItems = await fetchLiveNews();
  if (rawItems.length === 0) {
    return { fetched: 0, inserted: 0 };
  }

  const parsedItems = rawItems.map(parseRawNews);

  // Compute vector embeddings via MiniMax (embo-01) if API Key is configured
  let embeddings: (number[] | null)[] = new Array(parsedItems.length).fill(null);
  if (process.env.MINIMAX_API_KEY) {
    try {
      const textsToEmbed = parsedItems.map((p) => buildIndexableText(p) || p.rawContent);
      embeddings = await getMinimaxEmbeddings(textsToEmbed, "db");
    } catch (err: any) {
      console.warn("[Poller] MiniMax embedding generation failed, continuing without embedding:", err.message);
    }
  }

  let insertedCount = 0;
  for (let i = 0; i < parsedItems.length; i++) {
    const item = parsedItems[i];
    const embedding = embeddings[i] || null;

    // Idempotent upsert: ON CONFLICT (id) DO NOTHING
    const result = await db
      .insert(flashNews)
      .values({
        ...item,
        embedding: embedding as any,
      })
      .onConflictDoNothing({ target: flashNews.id });
    
    if (result.rowCount && result.rowCount > 0) {
      insertedCount++;
      // If breaking alert or high importance, broadcast to connected MCP SSE sessions
      if (item.isAlert || (item.importance !== undefined && item.importance >= 2)) {
        cacheService.publishNews("alert", item as any);
      }
    }
  }

  // If new records were added, invalidate hot query cache
  if (insertedCount > 0) {
    cacheService.invalidatePrefix("alerts:latest:");
    cacheService.invalidatePrefix("flash:latest:");
  }

  return { fetched: rawItems.length, inserted: insertedCount };
}

/**
 * Re-indexes news items with enriched vector representations.
 * If forceAll is true, reindexes even items that already have embeddings.
 * @param days Filter to only reindex news created in the last X days (default: 30 days). If <= 0, no date filter is applied.
 */
export async function reindexMissingEmbeddings(
  batchSize: number = 50,
  forceAll: boolean = false,
  minChar: number = 3,
  days: number = 30
): Promise<{ processed: number; updated: number; skippedTooShort?: number; days?: number }> {
  if (!process.env.MINIMAX_API_KEY) {
    throw new Error("Cannot reindex embeddings: MINIMAX_API_KEY is not configured.");
  }

  const query = db
    .select({
      id: flashNews.id,
      rawContent: flashNews.rawContent,
      tickers: flashNews.tickers,
      category: flashNews.category,
      direction: flashNews.direction,
    })
    .from(flashNews);

  const conditions = [];
  if (!forceAll) {
    conditions.push(isNull(flashNews.embedding));
  }
  if (days && days > 0) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    conditions.push(gte(flashNews.createdAt, cutoffDate));
  }

  const targets = conditions.length > 0
    ? await query.where(and(...conditions)).orderBy(desc(flashNews.createdAt)).limit(batchSize)
    : await query.orderBy(desc(flashNews.createdAt)).limit(batchSize);

  if (targets.length === 0) {
    return { processed: 0, updated: 0, skippedTooShort: 0, days };
  }

  // Filter items that satisfy minimum length and build enriched contextual strings
  const validItems: typeof targets = [];
  const texts: string[] = [];

  for (const item of targets) {
    const enriched = buildIndexableText(item, minChar);
    if (enriched) {
      validItems.push(item);
      texts.push(enriched);
    }
  }

  const skippedTooShort = targets.length - validItems.length;

  if (validItems.length === 0) {
    return { processed: targets.length, updated: 0, skippedTooShort };
  }

  // MiniMax API supports up to 50-60 texts per batch request. Chunk by 30 to avoid timeout/payload limits.
  const CHUNK_SIZE = 30;
  let updated = 0;

  for (let offset = 0; offset < validItems.length; offset += CHUNK_SIZE) {
    const chunkItems = validItems.slice(offset, offset + CHUNK_SIZE);
    const chunkTexts = texts.slice(offset, offset + CHUNK_SIZE);

    const vectors = await getMinimaxEmbeddings(chunkTexts, "db");

    for (let i = 0; i < chunkItems.length; i++) {
      const vectorStr = `[${vectors[i].join(",")}]`;
      await db.execute(
        `UPDATE flash_news SET embedding = '${vectorStr}'::vector WHERE id = '${chunkItems[i].id}';`
      );
      updated++;
    }
  }

  return { processed: targets.length, updated, skippedTooShort, days };
}

/**
 * Starts continuous background polling worker
 */
export async function startPoller(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  console.log(`[Poller] Initializing database and starting poller (interval: ${pollIntervalMs / 1000}s)...`);
  await initDatabase();

  pollLoopFn = async () => {
    try {
      const stats = await pollOnce();
      console.log(`[Poller] Ingested ${stats.inserted} new items out of ${stats.fetched} fetched.`);
    } catch (err) {
      console.error("[Poller] Polling cycle error:", err);
    } finally {
      if (isPolling && pollLoopFn) {
        pollTimeoutHandle = setTimeout(pollLoopFn, pollIntervalMs);
      }
    }
  };

  // Run immediately on start
  await pollLoopFn();
}

export function stopPoller(): void {
  isPolling = false;
  if (pollTimeoutHandle) {
    clearTimeout(pollTimeoutHandle);
    pollTimeoutHandle = null;
  }
  console.log("[Poller] Poller stopped.");
}
