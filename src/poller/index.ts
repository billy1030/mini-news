import { db, initDatabase } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { parseRawNews } from "../parser/index.js";
import { fetchLiveNews } from "./fetcher.js";
import { getMinimaxEmbeddings } from "../services/embedding.js";
import { isNull, desc } from "drizzle-orm";

let pollIntervalMs =
  (Number(process.env.POLL_INTERVAL_SECONDS) || 60) * 1000;

export function setPollInterval(seconds: number): void {
  const safeSeconds = Math.max(15, Math.min(300, seconds));
  pollIntervalMs = safeSeconds * 1000;
  process.env.POLL_INTERVAL_SECONDS = String(safeSeconds);
  console.log(`[Poller] Poll interval updated to ${safeSeconds} seconds.`);
}

export function getPollInterval(): number {
  return pollIntervalMs / 1000;
}

let isPolling = false;

/**
 * Executes a single ingestion iteration with automatic MiniMax vector embeddings
 */
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
      const contents = parsedItems.map((p) => p.rawContent);
      embeddings = await getMinimaxEmbeddings(contents, "db");
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
    }
  }

  return { fetched: rawItems.length, inserted: insertedCount };
}

/**
 * Re-indexes all existing news items that have NULL embeddings
 */
export async function reindexMissingEmbeddings(batchSize: number = 20): Promise<{ processed: number; updated: number }> {
  if (!process.env.MINIMAX_API_KEY) {
    throw new Error("Cannot reindex embeddings: MINIMAX_API_KEY is not configured.");
  }

  const missing = await db
    .select({ id: flashNews.id, rawContent: flashNews.rawContent })
    .from(flashNews)
    .where(isNull(flashNews.embedding))
    .orderBy(desc(flashNews.createdAt))
    .limit(batchSize);

  if (missing.length === 0) {
    return { processed: 0, updated: 0 };
  }

  const texts = missing.map((m) => m.rawContent);
  const vectors = await getMinimaxEmbeddings(texts, "db");

  let updated = 0;
  for (let i = 0; i < missing.length; i++) {
    const vectorStr = `[${vectors[i].join(",")}]`;
    await db.execute(
      `UPDATE flash_news SET embedding = '${vectorStr}'::vector WHERE id = '${missing[i].id}';`
    );
    updated++;
  }

  return { processed: missing.length, updated };
}

/**
 * Starts continuous background polling worker
 */
export async function startPoller(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  console.log(`[Poller] Initializing database and starting poller (interval: ${pollIntervalMs / 1000}s)...`);
  await initDatabase();

  const runLoop = async () => {
    try {
      const stats = await pollOnce();
      console.log(`[Poller] Ingested ${stats.inserted} new items out of ${stats.fetched} fetched.`);
    } catch (err) {
      console.error("[Poller] Polling cycle error:", err);
    } finally {
      if (isPolling) {
        setTimeout(runLoop, pollIntervalMs);
      }
    }
  };

  // Run immediately on start
  await runLoop();
}

export function stopPoller(): void {
  isPolling = false;
  console.log("[Poller] Poller stopped.");
}
