import { getMinimaxEmbeddings } from "./embedding.js";
import { cacheService } from "./cache.js";

interface QueueItem {
  text: string;
  cacheKey: string;
  type: "db" | "query";
  resolve: (vector: number[]) => void;
  reject: (err: any) => void;
}

export interface BatcherOptions {
  maxBatchSize?: number;
  maxWaitMs?: number;
}

/**
 * Continuous Micro-Batcher for vector embeddings with built-in L1 semantic cache.
 * Aggregates concurrent single or small requests into optimal batch calls to MiniMax,
 * resolving within a maximum window timeout (e.g. 25ms) or immediately when maxBatchSize is reached.
 */
export class ContinuousEmbeddingBatcher {
  private queue: QueueItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly maxBatchSize: number;
  private readonly maxWaitMs: number;
  private isProcessing = false;

  constructor(options: BatcherOptions = {}) {
    this.maxBatchSize = options.maxBatchSize || 16;
    this.maxWaitMs = options.maxWaitMs || 25;
  }

  /**
   * Queue a single query/text for embedding. Returns a promise that resolves with the 1536-dim vector.
   * If the exact query was embedded within the last 24h, returns immediately from cache (0ms).
   */
  public async embed(text: string, type: "db" | "query" = "query"): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error("Text to embed cannot be empty.");
    }

    const cleanText = text.trim();
    const cacheKey = `embedding:${type}:${cacheService.hashKey(cleanText)}`;
    const cachedVector = cacheService.get<number[]>(cacheKey);
    if (cachedVector) {
      return cachedVector;
    }

    return new Promise<number[]>((resolve, reject) => {
      this.queue.push({
        text: cleanText,
        cacheKey,
        type,
        resolve: (vec) => {
          // Cache vector for 24 hours (86,400s)
          cacheService.set(cacheKey, vec, 86400);
          resolve(vec);
        },
        reject,
      });

      // If batch size threshold reached, flush immediately
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.timer) {
        // Start flush countdown window
        this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
      }
    });
  }

  /**
   * Flushes the current batch to the MiniMax API
   */
  private async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0 || this.isProcessing) {
      return;
    }

    // Take current slice up to maxBatchSize
    const currentBatch = this.queue.splice(0, this.maxBatchSize);
    this.isProcessing = true;

    try {
      const texts = currentBatch.map((item) => item.text);
      // Group by type if necessary or default to query (semantic search is primary concurrent consumer)
      const primaryType = currentBatch[0].type;
      const vectors = await getMinimaxEmbeddings(texts, primaryType);

      if (vectors.length !== currentBatch.length) {
        throw new Error(
          `MiniMax returned ${vectors.length} vectors for a batch of ${currentBatch.length} items.`
        );
      }

      currentBatch.forEach((item, idx) => {
        item.resolve(vectors[idx]);
      });
    } catch (err) {
      currentBatch.forEach((item) => {
        item.reject(err);
      });
    } finally {
      this.isProcessing = false;
      // If items accumulated while processing previous batch, flush next
      if (this.queue.length > 0) {
        if (this.queue.length >= this.maxBatchSize) {
          this.flush();
        } else if (!this.timer) {
          this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
        }
      }
    }
  }

  /**
   * Current queue status for health/monitoring metrics
   */
  public getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      maxBatchSize: this.maxBatchSize,
      maxWaitMs: this.maxWaitMs,
    };
  }
}

// Global shared singleton for application
export const embeddingBatcher = new ContinuousEmbeddingBatcher({
  maxBatchSize: 16,
  maxWaitMs: 30,
});
