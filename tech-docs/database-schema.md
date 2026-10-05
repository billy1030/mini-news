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

-- pgvector Hierarchical Navigable Small World (HNSW) Index (m=32, ef_construction=128)
CREATE INDEX IF NOT EXISTS idx_flash_news_embedding_hnsw 
ON flash_news USING hnsw (embedding vector_cosine_ops)
WITH (m = 32, ef_construction = 128);
```

---

## Table: `mcp_audit_logs`

Stores rolling MCP tool call interactions across all processes (`stdio`, `sse`, `web`) to support cross-process audit visibility.

| Column Name | PostgreSQL Type | Drizzle Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `varchar(64)` | **Primary Key**. 8-character unique hex identifier. |
| `created_at` | `TIMESTAMPTZ` | `timestamp({ withTimezone: true })` | UTC creation timestamp, default `NOW()`. |
| `tool` | `VARCHAR(128)` | `varchar(128)` | Name of the executed tool. |
| `args` | `JSONB` | `jsonb` | Invocation input arguments. |
| `duration_ms` | `INTEGER` | `integer` | Execution time in milliseconds. |
| `is_error` | `BOOLEAN` | `boolean` | Flag indicating execution failure (`true`/`false`). |
| `error_detail` | `TEXT` | `text` | Error details and message if failed. |
| `result_summary` | `TEXT` | `text` | Truncated result output (up to 1,000 chars). |
| `source` | `VARCHAR(32)` | `varchar(32)` | Invocator source: `'stdio'`, `'sse'`, or `'web'`. |
| `data_source` | `VARCHAR(32)` | `varchar(32)` | Data source: `'CACHE'`, `'DB'`, `'VECTOR'`, `'SCHEMA'`. |

```sql
CREATE INDEX idx_mcp_audit_created_at ON mcp_audit_logs USING btree (created_at);
CREATE INDEX idx_mcp_audit_tool ON mcp_audit_logs USING btree (tool);
CREATE INDEX idx_mcp_audit_source ON mcp_audit_logs USING btree (source);
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

## Specialized Indexing Strategies (Beyond Vector HNSW)

While the pgvector HNSW index accelerates vector similarity search, Mini-News leverages and supports multiple complementary PostgreSQL index types to optimize text search, JSON lookups, and chronological sorting:

### 1. `pg_trgm` GIN Index (Accelerates SQL `LIKE '%keyword%'` / `ILIKE`)
* **Problem**: Standard B-Tree indexes only assist prefix matching (`LIKE 'word%'`). Wildcard substring queries (`LIKE '%降息%'` or `ILIKE '%NVDA%'`) force slow sequential table scans.
* **Pattern**:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;

  CREATE INDEX IF NOT EXISTS idx_flash_news_trgm_content 
  ON flash_news USING gin (raw_content gin_trgm_ops);
  ```
* **Performance Gain**: Converts full-text wildcard scans into sub-millisecond GIN trigram index lookups.

### 2. JSONB GIN Index (Accelerates `tickers` Array Filtering)
* **Problem**: Tickers are stored in a JSONB array (e.g. `["02513.HK", "NVDA"]`). Sequential scanning is required without specialized JSON indexing.
* **Pattern**:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_flash_news_tickers_gin 
  ON flash_news USING gin (tickers);
  ```
* **Usage**:
  ```sql
  -- Instant lookup for any news tagging a specific stock or asset:
  SELECT * FROM flash_news WHERE tickers @> '["02513.HK"]'::jsonb;
  ```

### 3. Partial Index (Breaking Alerts & Urgent Flashes)
* **Problem**: Only ~5%–10% of items are breaking alerts (`is_alert = true` or `importance >= 2`). Indexing the remaining 90% of regular news is unnecessary overhead.
* **Pattern**:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_flash_news_alerts_only 
  ON flash_news (created_at DESC) 
  WHERE is_alert = true OR importance >= 2;
  ```
* **Performance Gain**: Produces a tiny, high-density index kept entirely in buffer cache, accelerating `get_latest_alerts` tool calls.

### 4. Composite B-Tree Indexes (Zero-Sort Feed Filtering)
* **Problem**: Dashboard views filter by sentiment direction or alert status and order by newest first (`ORDER BY created_at DESC`), requiring query-time heap sorting.
* **Pattern**:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_flash_news_direction_time 
  ON flash_news (direction, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_flash_news_alert_time 
  ON flash_news (is_alert, created_at DESC);
  ```
* **Performance Gain**: Eliminates query-time sorting overhead by retrieving rows pre-ordered directly from the index tree.

---

## Drizzle Schema Definition File
Located at: [`src/db/schema.ts`](file:///c:/ai/mini-news/src/db/schema.ts)
