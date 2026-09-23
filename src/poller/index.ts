import { db, initDatabase } from "../db/index.js";
import { flashNews } from "../db/schema.js";
import { parseRawNews } from "../parser/index.js";
import { fetchLiveNews } from "./fetcher.js";

const POLL_INTERVAL_MS =
  (Number(process.env.POLL_INTERVAL_SECONDS) || 60) * 1000;

let isPolling = false;

/**
 * Executes a single ingestion iteration
 */
export async function pollOnce(): Promise<{ fetched: number; inserted: number }> {
  const rawItems = await fetchLiveNews();
  if (rawItems.length === 0) {
    return { fetched: 0, inserted: 0 };
  }

  const parsedItems = rawItems.map(parseRawNews);

  let insertedCount = 0;
  for (const item of parsedItems) {
    // Idempotent upsert: ON CONFLICT (id) DO NOTHING
    const result = await db
      .insert(flashNews)
      .values(item)
      .onConflictDoNothing({ target: flashNews.id });
    
    if (result.rowCount && result.rowCount > 0) {
      insertedCount++;
    }
  }

  return { fetched: rawItems.length, inserted: insertedCount };
}

/**
 * Starts continuous background polling worker
 */
export async function startPoller(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  console.log(`[Poller] Initializing database and starting poller (interval: ${POLL_INTERVAL_MS / 1000}s)...`);
  await initDatabase();

  const runLoop = async () => {
    try {
      const stats = await pollOnce();
      console.log(`[Poller] Ingested ${stats.inserted} new items out of ${stats.fetched} fetched.`);
    } catch (err) {
      console.error("[Poller] Polling cycle error:", err);
    } finally {
      if (isPolling) {
        setTimeout(runLoop, POLL_INTERVAL_MS);
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
