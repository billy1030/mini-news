# Roadmap: Mini-News Backend MCP Server

## Phase 1: Ingestion, Storage Engine & Containerization
- [x] 1.1: PostgreSQL database schema with Drizzle ORM and pgvector extension support (`src/db/schema.ts`, `src/db/index.ts`).
- [x] 1.2: Docker containerization (`Dockerfile`, `docker-compose.yml` with pgvector image) & Zeabur readiness.
- [x] 1.3: News fetcher & parser module extracting UTF-8 content, HKT timestamps, importance, tags, and tickers (`src/parser/`).
- [x] 1.4: Background poller worker fetching mutemute.com every 60s with deduplication and DB persistence (`src/poller/`).
- [x] 1.5: Verification suite & test harness (`test/test-db.ts`, `test/test-grab.ts`, `test/test-sql-safety.ts`).

## Phase 2: MCP Server & Dynamic Financial SQL Generation
- [x] 2.1: MCP Server setup via stdio transport using `@modelcontextprotocol/sdk` (`src/mcp/server.ts`).
- [x] 2.2: Tool `describe_news_schema` (DDL schema and sample rows for LLMs) (`src/mcp/schemaDoc.ts`).
- [x] 2.3: Tool `query_financial_news_sql` with AST/read-only safety guards (`src/mcp/sqlSafety.ts`).
- [x] 2.4: Tool `search_news_hybrid` (ILIKE + JSONB Tickers + pgvector ready).
- [x] 2.5: Tool `get_latest_alerts` (breaking red-bar / importance >= 2 news).

## Phase 3: MiniBot Integration & Deployment
- [x] 3.1: Register server in `minibot.config.json` for multi-agent workflows.
- [x] 3.2: Create agent skill `mini-news-financial-mcp` for automated SQL generation.
- [ ] 3.3: Production deployment verification on Zeabur.
