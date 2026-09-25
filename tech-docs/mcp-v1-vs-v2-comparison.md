# Technical Architecture Comparison: Current vs Next Release (Multi-User & Scaled MCP)

This document provides a technical comparison between the current release of `mini-news` (v1.0.0) and the upcoming architecture (v2.0.0) targeting multi-user/multi-session support, continuous micro-batching, and enterprise resilience.

---

## 1. High-Level Comparison Table

| Architecture Dimension | Current Release (v1.0.0) | Next Release (v2.0.0 Target) |
| :--- | :--- | :--- |
| **Transport Protocol** | Single-process `StdioServerTransport` (stdin/stdout) | Dual-mode: Stdio + Remote `SSEServerTransport` / HTTP Stream |
| **Session Model** | **Single Session**: 1 agent process to 1 Node server | **Multi-Session**: Map-based session registry keyed by `sessionId` |
| **Concurrency Support** | Sequential / Single-tenant only | Concurrent multi-user requests with isolated session states |
| **Embedding Generation** | Sequential one-off API calls per semantic query | **Continuous Micro-Batching** (Queue with flush on size $\ge 16$ or $20\text{ms}$ wait) |
| **Rate Limit Protection** | Prone to 429 errors when multiple queries run | Queue-buffered throttling with automatic exponential backoff |
| **Data Retrieval Model** | Static JSON batch (Fixed LIMIT, default 15–50) | **Continuous Cursor / Chunked Streaming** with pagination tokens |
| **Database Pool Management**| Default shared connection pool | Configured `pg.Pool` with per-query statement timeout (`statement_timeout = '3000ms'`) |
| **Result Caching** | None (Every tool call hits DB / MiniMax API) | In-memory / Redis hot-cache with 5–15s TTL for market flashes |
| **Process Model** | Colocated (Poller, Web, and MCP in one process) | Modular/Worker Isolation (Ingestion worker decoupled from query server) |
| **Observability** | `console.error` logs on stderr | Structured JSON logging, `/healthz`, `/metrics` (active sessions, queue depth, p95 latency) |

---

## 2. In-Depth Architectural Differences

### 2.1 Transport & Multi-User Session Handling

#### Current Release (v1.0.0)
- MCP server runs strictly over `StdioServerTransport` via `src/mcp/server.ts`.
- **Limitation**: Any IDE or agent (e.g. MiniBot, Claude Desktop) must spawn its own local `node` sub-process. Multiple users or web clients cannot share or remotely access the server without spawning independent Node processes connecting to the same DB.

#### Next Release (v2.0.0)
- Introduces an HTTP / SSE server endpoint (`/sse` & `/message?sessionId=...`) alongside Stdio:
  ```
  [User A / IDE 1] ──HTTP/SSE──┐
  [User B / IDE 2] ──HTTP/SSE──┼──> [MCP SSE Gateway] ──> [Session Manager] ──> Tool Dispatcher
  [Local Agent]    ──Stdio─────┘
  ```
- **Session Registry**: Tracks active client connections with dedicated heartbeat timeouts, user authentication, and isolated progress channels.

---

### 2.2 Continuous Micro-Batching Behavior

#### Current Release (v1.0.0)
- When `search_news_semantic` is called, it makes an immediate synchronous request to the MiniMax API:
  ```typescript
  // Immediate per-call request
  const [vector] = await getMinimaxEmbeddings([query]);
  ```
- Multiple concurrent user queries cause $N$ separate HTTP requests to MiniMax, leading to rate limits (`HTTP 429`) and high latency.

#### Next Release (v2.0.0)
- Implements a **Continuous Micro-Batcher (`ContinuousEmbeddingQueue`)**:
  1. Requests push their query string and deferred Promise (`resolve`, `reject`) into an in-memory batch buffer.
  2. The batcher automatically flushes when either:
     - Buffer reaches target batch size (e.g., $N = 16$), OR
     - Window timer expires (e.g., $\Delta t = 20\text{ms}$).
  3. A single batched MiniMax API call computes embeddings for all $N$ requests at once.
  4. Individual user promises are resolved concurrently with their corresponding vector.

---

### 2.3 Data Streaming & Continuous Batching for Large News Windows

#### Current Release (v1.0.0)
- Dynamic SQL (`query_financial_news_sql`) and alerts enforce a hard-clamped limit (up to 300 rows).
- Fetching large spans of news requires agents to manually construct `OFFSET` or time-based queries, increasing DB overhead.

#### Next Release (v2.0.0)
- Supports **Cursor-based Continuous Pagination Tokens**:
  - MCP tools return an opaque `next_cursor` token referencing `(time_hkt, id)`.
  - Enables agents to iteratively scan historical market events across multiple tool turns without DB lockup or memory spikes.
- Employs **MCP Progress Notifications** to stream batch progress to LLM clients on large operations (e.g., reindexing or deep time-window sweeps).

---

### 2.4 Database Reliability & Safety

#### Current Release (v1.0.0)
- SQL queries are sanitized with regular expressions (`src/mcp/sqlSafety.ts`) to ensure read-only behavior.
- However, heavy read queries (e.g. unbounded full-text ILIKE across millions of rows) can block Postgres worker threads indefinitely.

#### Next Release (v2.0.0)
- **Active Statement Timeout**: Prepends/wraps dynamic SQL execution with `SET LOCAL statement_timeout = '3000ms'`.
- **Query Complexity Guard**: Restricts maximum subqueries and join count.
- **Hot Cache**: Caches top 20 latest alerts and breaking news for 5 seconds to reduce Postgres reads under burst multi-user traffic.

---

## 3. Migration Roadmap

1. **Phase 1: Dual Transport & Session Manager**
   - Add SSE endpoint to `src/web/server.ts` or dedicated MCP port.
   - Retain backwards compatibility with `--mcp-only` on Stdio.
2. **Phase 2: Continuous Embedding Micro-Batcher**
   - Implement `ContinuousEmbeddingQueue` in `src/services/embedding.ts`.
   - Update `search_news_semantic` to dispatch through the batch queue.
3. **Phase 3: Resilience & Caching**
   - Add Postgres connection pool limits and statement timeouts.
   - Introduce short-TTL in-memory cache for news flash queries.
4. **Phase 4: Stream Tokens & Cursor Batching**
   - Add cursor tokens to `search_flash_by_time_window` and `get_latest_financial_flash`.
