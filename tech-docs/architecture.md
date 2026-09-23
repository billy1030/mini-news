# System Architecture & Data Flow

```
+-------------------------------------------------------------+
|                      Upstream Source                        |
|   https://mutemute.com/mutenews/ajax/app-news.php           |
|            (7x24 Live Financial News Stream)                |
+-------------------------------------------------------------+
                              |
                              | HTTP POST (Configurable 15s - 300s Poller)
                              v
+-------------------------------------------------------------+
|                 Ingestion Engine (Poller)                   |
|  - Fetcher & Network retry logic                            |
|  - UTF-8 decoding & character normalization                 |
|  - HKT Timezone Calculator (Asia/Hong_Kong)                 |
|  - Financial Ticker extraction ($AAPL, NVDA, BTC)           |
|  - Market sentiment direction detector (UP / DOWN / FLAT)   |
|  - MiniMax embo-01 embedding generator (1536-dim vector)   |
+-------------------------------------------------------------+
                              |
                              | Idempotent Upsert (Drizzle ORM)
                              v
+-------------------------------------------------------------+
|               PostgreSQL 16 + pgvector Storage              |
|  - Port 5232 (Host) -> 5432 (Container)                     |
|  - Table: flash_news                                        |
|  - UTF-8 collation & client encoding                        |
|  - Indices: BTree on timestamps, GIN on JSONB tickers,      |
|    HNSW vector index (1536-dim, vector_cosine_ops)          |
+-------------------------------------------------------------+
            ^                                     ^
            | SQL Queries / Cosine Search         | REST / Config
            v                                     v
+-----------------------------+     +-----------------------------+
|      MCP Server Layer       |     |   Web Server & Dashboard    |
| - stdio / SSE Transports    |     | - Port 5200 (Node HTTP)     |
| - SQL Safety Guard (AST)    |     | - Dynamic poll frequency    |
| - search_news_semantic      |     | - 🧠 MiniMax Vector Search  |
| - reindex_news_embeddings   |     | - ⚡ Live SQL Playground    |
+-----------------------------+     +-----------------------------+
            ^                                     ^
            | MCP Tools                           | Web Browser
            v                                     v
+-----------------------------+     +-----------------------------+
|    AI Agents / Consumers    |     |      End User / Trader      |
| (MiniBot, Claude, Cursor)   |     |   (Real-time Live Stream)   |
+-----------------------------+     +-----------------------------+
```

## Component Overview

1. **`src/poller/`**:
   - `fetcher.ts`: Communicates with upstream news API endpoints.
   - `index.ts`: Controls dynamic polling frequency (`15s` - `300s`, configurable at runtime), executes idempotent batch writes, and enriches new items with MiniMax 1536-dimensional embeddings.
   - Provides batch reindexing capability (`reindexMissingEmbeddings`) to populate vector embeddings for historical records.

2. **`src/services/embedding.ts`**:
   - Connects to MiniMax Embedding API (`https://api.minimaxi.com/v1/embeddings`) with model `embo-01`.
   - Supports `"db"` embedding representation for ingested text and `"query"` embedding representation for real-time search queries.
   - Dimension: **1536 float elements**.

3. **`src/parser/`**:
   - Parses timestamps into accurate UTC `created_at` and localized HKT `date_hkt`/`time_hkt`.
   - Recognizes financial tickers (`$AAPL`, `NVDA`, `BTC`), currency pairs, and crypto symbols.
   - Classifies market sentiment direction into `UP`, `DOWN`, or `FLAT`.

4. **`src/db/`**:
   - `schema.ts`: Drizzle ORM declaration with custom `vector(1536)` type definition.
   - `index.ts`: PostgreSQL connection pool with automatic initialization of `CREATE EXTENSION IF NOT EXISTS vector` and HNSW index `idx_flash_news_embedding_hnsw`.

5. **`src/web/`**:
   - `server.ts`: Lightweight zero-dependency HTTP server running on port `5200`.
   - Endpoints:
     - `GET /`: Serves the responsive financial dashboard UI.
     - `GET /api/news?limit=N`: Fetches stored news flashes.
     - `POST /api/fetch-live`: Triggers immediate out-of-band poll.
     - `POST /api/config`: Dynamically updates the backend poll frequency (15s to 300s).
     - `POST /api/semantic-search`: Executes cosine distance vector search via pgvector.
     - `POST /api/reindex`: Reindexes news items that lack embeddings.
     - `POST /api/query`: Executes read-only SQL queries with AST safety validation.
   - `index.html`: Responsive, dark-mode-ready UI featuring real-time stream, direction filtering, semantic search bar, and interactive SQL Playground modal.

6. **`src/mcp/`**:
   - `server.ts`: Implements Model Context Protocol server tools (`describe_news_schema`, `query_financial_news_sql`, `get_latest_alerts`, `search_news_hybrid`, `search_news_semantic`, `reindex_news_embeddings`).
   - `sqlSafety.ts`: Enforces AST/regex read-only execution, blocks mutating DDL/DML, and injects safe limits.
   - `schemaDoc.ts`: Provides DDL schemas and query patterns to LLMs.
