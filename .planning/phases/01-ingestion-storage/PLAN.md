# Phase 1 Plan: Ingestion, Storage Engine & Containerization

**Goal:** Establish a robust PostgreSQL database layer with Drizzle ORM and `pgvector`, build the live news fetcher/parser with HKT time & UTF-8 handling, set up background polling with deduplication, and configure production-grade Docker/Zeabur containers.

---

## Tasks

### Task 1.1: Database Layer & Schema Definition
- **Files:** `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`
- Implement Drizzle ORM schema for `flash_news` table including:
  - `id` (VARCHAR(64) PRIMARY KEY)
  - `created_at` (TIMESTAMPTZ default now)
  - `date_hkt` (DATE) & `time_hkt` (VARCHAR(8))
  - `importance` (INTEGER), `is_alert` (BOOLEAN)
  - `category` (VARCHAR(64)), `raw_content` (TEXT UTF-8)
  - `tickers` (JSONB), `direction` (VARCHAR(16))
  - `embedding` (VECTOR(1536) optional for pgvector)
- Implement database connection pool in `src/db/index.ts` with connection verification and automatic `vector` extension initialization.

### Task 1.2: Docker Containerization & Local Dev Environment
- **Files:** `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `zeabur.json`
- `docker-compose.yml`:
  - PostgreSQL 16 image with `pgvector/pgvector:pg16` pre-installed.
  - Set default UTF-8 collation and client encoding.
  - Persistent volume for DB data.
- `Dockerfile`:
  - Production-ready multi-stage Node.js build (builder -> runner).
  - Compatible with Zeabur deployment.

### Task 1.3: News Parser & Time/Encoding Module
- **Files:** `src/parser/index.ts`, `src/parser/types.ts`
- Implement robust parsing logic for raw news payloads from `mutemute.com`:
  - Ensure strict UTF-8 string decoding and HTML entity unescaping.
  - Precise HKT timestamp calculation (`Asia/Hong_Kong`) using Day.js / Intl.
  - Extract financial tags and tickers (e.g. `$TSLA`, `BTC`, `恒指`, `道指`).
  - Sentiment/direction detection (UP/DOWN/FLAT).

### Task 1.4: Ingestion Engine & Deduplication Poller
- **Files:** `src/poller/index.ts`
- Implement poller module:
  - Scheduled execution (every 60s configurable).
  - Fetch news feed from `mutemute.com/mutenews/ajax/app-news.php`.
  - Batch upsert into PostgreSQL with idempotent deduplication (`ON CONFLICT (id) DO NOTHING`).
  - Resilient error handling (network retries, exponential backoff).

### Task 1.5: Verification Test Suite
- **Files:** `test/test-db.ts`, `test/test-grab.ts`
- `test/test-db.ts`: Verifies DB connection, table existence, UTF-8 insertion/retrieval, and JSONB queries.
- `test/test-grab.ts`: Tests actual fetching and parsing from the live upstream endpoint without crashing.

---

## Verification Criteria
1. `npm run build` compiles with zero TypeScript errors.
2. Drizzle schema validates cleanly (`npx drizzle-kit check` / `push`).
3. Parser correctly decodes Chinese characters, symbols, and generates accurate HKT date/time.
4. Test scripts run and output formatted news records.
