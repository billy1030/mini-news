# System Architecture & Data Flow

```
+-------------------------------------------------------------+
|                      Upstream Source                        |
|   https://mutemute.com/mutenews/ajax/app-news.php           |
|            (7x24 Live Financial News Stream)                |
+-------------------------------------------------------------+
                              |
                              | HTTP POST (Every 60s)
                              v
+-------------------------------------------------------------+
|                 Ingestion Engine (Poller)                   |
|  - Fetcher & Network retry logic                            |
|  - UTF-8 decoding & character normalization                 |
|  - HKT Timezone Calculator (Asia/Hong_Kong)                 |
|  - Financial Ticker extraction ($AAPL, NVDA, BTC)           |
|  - Market sentiment direction detector (UP / DOWN / FLAT)   |
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
|    HNSW vector index on 1536-dim embeddings                 |
+-------------------------------------------------------------+
                              ^
                              | SQL Queries & MCP Tool Calls
                              v
+-------------------------------------------------------------+
|                     MCP Server Layer                        |
|  - stdio / SSE Transports (@modelcontextprotocol/sdk)       |
|  - AST & Regex Read-Only SQL Safety Validator               |
|  - Automated LIMIT 50 token bounding protection             |
+-------------------------------------------------------------+
                              ^
                              | Tool Invocations
                              v
+-------------------------------------------------------------+
|                   AI Clients / Consumers                    |
|       (MiniBot Multi-Agent, Claude Desktop, Cursor)         |
+-------------------------------------------------------------+
```

## Component Overview

1. **`src/poller/`**:
   - `fetcher.ts`: Communicates with upstream news API endpoints.
   - `index.ts`: Controls polling interval (`POLL_INTERVAL_SECONDS`), runs idempotent batch writes to the database.
2. **`src/parser/`**:
   - Parses timestamps into accurate UTC `created_at` and localized HKT `date_hkt`/`time_hkt`.
   - Recognizes financial tickers, currency pairs, and crypto symbols.
3. **`src/db/`**:
   - `schema.ts`: Drizzle ORM declaration with custom pgvector type support.
   - `index.ts`: PostgreSQL client connection pool with automatic `CREATE EXTENSION IF NOT EXISTS vector`.
4. **`src/mcp/`**:
   - `server.ts`: Implements Model Context Protocol server tools.
   - `sqlSafety.ts`: Enforces read-only execution, blocks dangerous DDL and multi-statement attacks.
   - `schemaDoc.ts`: Provides DDL schemas and query patterns to LLMs.
