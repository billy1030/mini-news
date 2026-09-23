# Database & Schema Specification

The storage backend uses **PostgreSQL 16** with **pgvector** (`v0.8.6+`) and is managed via **Drizzle ORM**.

---

## Database Configuration

- **Encoding**: UTF-8 (`--encoding=UTF8 --lc-collate=C --lc-ctype=C`)
- **Connection Pool**: 10 max connections with 5s timeout.
- **Extensions**:
  - `vector`: Provides support for vector similarity search operators (`<=>` cosine distance, `<#>` negative inner product, `<->` L2 distance).

---

## Table: `flash_news`

Stores 7x24 real-time financial flash news ingested from upstream sources.

| Column Name | PostgreSQL Type | Drizzle Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `varchar` | **Primary Key**. Source unique identifier. |
| `created_at` | `TIMESTAMPTZ` | `timestamp({ withTimezone: true })` | UTC creation timestamp, default `NOW()`. |
| `date_hkt` | `DATE` | `date` | Pre-calculated HKT Date (`YYYY-MM-DD`). |
| `time_hkt` | `VARCHAR(8)` | `varchar(8)` | Pre-calculated HKT Time (`HH:mm:ss`). |
| `importance` | `INTEGER` | `integer` | Importance level: `0` (Normal), `1-2` (Notable), `3` (Breaking). |
| `is_alert` | `BOOLEAN` | `boolean` | Flag for breaking red-banner flashes. |
| `category` | `VARCHAR(64)` | `varchar(64)` | Tag classification (default `'general'`). |
| `raw_content` | `TEXT` | `text` | Full flash news text (UTF-8). |
| `tickers` | `JSONB` | `jsonb` | Array of tickers: `["AAPL", "NVDA", "BTC"]`. |
| `direction` | `VARCHAR(16)` | `varchar(16)` | Market sentiment: `'UP'`, `'DOWN'`, `'FLAT'`. |
| `embedding` | `VECTOR(1536)` | `vector(1536)` | MiniMax `embo-01` 1536-dimensional semantic vector embedding. |

---

## Indices

```sql
-- Standard Relational & Chronological Indices
CREATE INDEX idx_flash_news_created_at ON flash_news USING btree (created_at);
CREATE INDEX idx_flash_news_date_hkt ON flash_news USING btree (date_hkt);
CREATE INDEX idx_flash_news_importance ON flash_news USING btree (importance);
CREATE INDEX idx_flash_news_category ON flash_news USING btree (category);
CREATE INDEX idx_flash_news_tickers ON flash_news USING gin (tickers);

-- pgvector Hierarchical Navigable Small World (HNSW) Index
CREATE INDEX IF NOT EXISTS idx_flash_news_embedding_hnsw 
ON flash_news USING hnsw (embedding vector_cosine_ops);
```

---

## Semantic Vector Query Pattern

Mini-News uses the cosine distance operator (`<=>`) for semantic retrieval:

```sql
SELECT 
  id,
  time_hkt AS "timeHkt",
  direction,
  raw_content AS "rawContent",
  ROUND((1 - (embedding <=> '[... 1536 floats ...]')::numeric), 4) AS similarity
FROM flash_news
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '[... 1536 floats ...]'
LIMIT 10;
```

---

## Drizzle Schema Definition File
Located at: [`src/db/schema.ts`](file:///c:/ai/mini-news/src/db/schema.ts)
