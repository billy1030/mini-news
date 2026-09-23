# Ingestion & Deduplication Pipeline

Mini-News ingests 7x24 real-time financial flash feeds from upstream providers (e.g. `mutemute.com/mutenews`). Because financial markets publish continuous streams where polling cycles overlap, deduplication and high-throughput vector processing are critical.

---

## 1. Dynamic Polling Frequency

The ingestion engine supports dynamic polling intervals from **15 seconds** to **300 seconds** (default: 60s):
- **Runtime Adjustments**: Can be tuned dynamically from the Dashboard UI (`POST /api/config`) or by calling `setPollInterval(seconds)`.
- **Immediate Polling**: An on-demand trigger (`POST /api/fetch-live` or MCP tool) forces an immediate polling execution without resetting the scheduled interval.

---

## 2. Ingestion Lifecycle & Data Flow

```
[Upstream API (7x24 Live Feed)]
               │
               ▼ (Configurable 15s-300s via fetcher.ts)
[Raw Payload: 25-100 Items]
               │
               ▼ (parseRawNews in parser/index.ts)
[Normalized Entities]
  ├─ UTF-8 String Cleanup & Entity Unescaping
  ├─ HKT Time Calculation (Asia/Hong_Kong)
  ├─ Financial Ticker Detection ($AAPL, NVDA, BTC)
  └─ Market Direction Classification (UP / DOWN / FLAT)
               │
               ▼ (MiniMax embo-01 Vector Generation)
[1536-Dimensional Float Array Embeddings]
               │
               ▼ (Idempotent Batch Upsert in poller/index.ts)
[PostgreSQL: flash_news table]
  ├─ Exists in table? -> SKIP (DO NOTHING)
  └─ New ID?          -> INSERT, Index BTree & HNSW
```

---

## 3. Deduplication Strategy: Primary Key Idempotent Upsert

### Mechanism
- **Source Identifier**: Every incoming flash news item has an upstream identifier (`id`, `uid`, or `createdAt`). The parser normalizes this to a unique string `id`.
- **Atomic Database Handling**: We use PostgreSQL's atomic conflict resolution via Drizzle ORM:
  ```typescript
  await db
    .insert(flashNews)
    .values(itemsWithEmbeddings)
    .onConflictDoNothing({ target: flashNews.id });
  ```
- **Guarantees**:
  - Zero duplicates when the same news item appears across overlapping polling windows.
  - No database lock contention or thread race conditions.
  - Transparent ingestion stats logged every cycle:
    `[Poller] Ingested X new items out of Y fetched.`

---

## 4. Vector Reindexing Pipeline

For items inserted before vector indexing was enabled or in the event of upstream API rate-limiting during ingestion:
- `reindexMissingEmbeddings(batchSize)` queries items `WHERE embedding IS NULL`.
- Calls MiniMax `embo-01` with `type: "db"` and persists the generated vectors in batches.
