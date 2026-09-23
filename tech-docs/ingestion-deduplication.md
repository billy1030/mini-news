# Ingestion & Deduplication Pipeline

Mini-News ingests 7x24 real-time financial flash feeds from upstream providers (e.g. `mutemute.com/mutenews`). Because financial markets publish continuous streams where polling cycles overlap, deduplication is critical to prevent noisy duplicate alerts and bloated storage.

---

## 1. Current Deduplication Strategy: Primary Key Idempotent Upsert

### Mechanism
- **Source Identifier**: Every incoming flash news item has an upstream identifier (`id`, `uid`, or `createdAt`). The parser normalizes this to a unique string `id`.
- **Atomic Database Handling**: We use PostgreSQL's atomic conflict resolution via Drizzle ORM:
  ```typescript
  await db
    .insert(flashNews)
    .values(item)
    .onConflictDoNothing({ target: flashNews.id });
  ```
- **Guarantees**:
  - Zero duplicates when the same news item appears across overlapping polling windows (e.g. every 60s).
  - No database lock contention or thread race conditions.
  - Transparent ingestion stats logged every cycle:
    `[Poller] Ingested X new items out of Y fetched.`

---

## 2. Ingestion Lifecycle & Data Flow

```
[Upstream API (7x24 Live Feed)]
               │
               ▼ (Every 60s via fetcher.ts)
[Raw Payload: 25-50 Items]
               │
               ▼ (parseRawNews in parser/index.ts)
[Normalized Entities]
  ├─ UTF-8 String Cleanup & Entity Unescaping
  ├─ HKT Time Calculation (Asia/Hong_Kong)
  ├─ Financial Ticker Detection ($AAPL, NVDA, BTC)
  └─ Market Direction Classification (UP / DOWN / FLAT)
               │
               ▼ (Idempotent Batch Upsert in poller/index.ts)
[PostgreSQL: flash_news table]
  ├─ Exists in table? -> SKIP (DO NOTHING)
  └─ New ID?          -> INSERT & Index
```

---

## 3. Edge Cases & Roadmap for Advanced Deduplication

While ID-based deduplication guarantees zero duplicates for identical upstream IDs, financial streams present edge cases across different providers:

| Scenario | Current Handling | Advanced Mitigation Path |
| :--- | :--- | :--- |
| **Identical feed item re-broadcast** | ✅ **Filtered** (`ON CONFLICT DO NOTHING`) | N/A (Handled) |
| **Breaking news amended/updated by editor** | ⚠️ **Retained original** (Subsequent updates skipped) | Switch to `ON CONFLICT (id) DO UPDATE SET raw_content = EXCLUDED.raw_content, updated_at = NOW()` |
| **Cross-source duplicates (Different IDs, same text)** | ⚠️ **Both stored** (Treated as separate records) | **Content Fingerprinting**: Calculate normalized text MD5/SHA-256 hash (`content_hash` UNIQUE constraint) |
| **Rephrased syndication (Slightly altered wording)** | ⚠️ **Both stored** | **Semantic Deduplication**: Use `pgvector` cosine similarity (`> 0.95` within a 15-minute sliding window) or `pg_trgm` fuzzy matching |
