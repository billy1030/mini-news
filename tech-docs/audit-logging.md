# MCP Audit Logging & Observability Architecture

This document specifies the **MCP Request/Response Audit Logging, Multi-Process Synchronization, Data Source Tracking, and Visual Observability** engine built into `mini-news`.

---

## 1. Architectural Overview & Objectives

In modern agentic workflows (e.g., MiniBot, Claude Desktop, Cursor, Custom HTTP consumers), visibility into model interactions is essential. Mini-News features an end-to-end audit logging pipeline that records:
1. **Tool Invocation Metadata**: Tool name, execution parameters (`args`), duration in milliseconds (`durationMs`), error status, error message, and truncated result summary.
2. **Transport Source (`source`)**: Distinguishes whether the invocation came via `stdio` (CLI/MiniBot), `sse` (multi-user SSE streaming), or `web` (interactive dashboard UI).
3. **Data Source Tracking (`dataSource`)**: Tracks exactly where the data was served from:
   - `⚡ CACHE`: Served from L1 zero-latency in-memory cache (0-1ms).
   - `💾 DB`: Fetched from PostgreSQL relational tables via direct Drizzle queries or dynamic SQL AST execution.
   - `🧠 VECTOR`: Computed via MiniMax `embo-01` embeddings and retrieved from pgvector HNSW cosine distance indices.
   - `📄 SCHEMA`: Returned from static in-memory Data Dictionary and schema specifications.
4. **Cache Hit Rate Metrics**: Real-time calculation of cache hits, misses, and hit ratio percentage (`hits / (hits + misses) * 100%`).
5. **Cross-Process Synchronization**: Unifies separate processes (`node dist/index.js --mcp-only` stdio subprocess spawned by MiniBot vs `src/index.ts` Web Control Center daemon) through shared PostgreSQL persistence with an in-memory fallback.

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│       MiniBot (stdio process)   │       │   Web Dashboard / SSE Clients   │
│  - Executes tools via stdin     │       │  - Executes tools via HTTP/SSE  │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 ▼                                         ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│     In-Memory 15m Ring Buffer   │       │     In-Memory 15m Ring Buffer   │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 │         Async Fire-and-Forget Insert    │
                 └────────────────► ┌─────────────┐ ◄──────┘
                                    │ PostgreSQL  │
                                    │ mcp_audit_  │
                                    │    logs     │
                                    └──────┬──────┘
                                           │
                                           ▼
                               ┌──────────────────────┐
                               │  GET /api/mcp/audit  │
                               │  (Unified 15m Modal) │
                               └──────────────────────┘
```

---

## 2. PostgreSQL Schema: `mcp_audit_logs`

Audit logs are persisted in PostgreSQL to ensure cross-process visibility:

| Column Name | PostgreSQL Type | Drizzle Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `varchar(64)` | **Primary Key**. 8-character random hex ID. |
| `created_at` | `TIMESTAMPTZ` | `timestamp({ withTimezone: true })` | UTC creation timestamp, default `NOW()`. |
| `tool` | `VARCHAR(128)` | `varchar(128)` | Name of the executed MCP tool. |
| `args` | `JSONB` | `jsonb` | Parsed tool input arguments. |
| `duration_ms`| `INTEGER` | `integer` | Execution duration in milliseconds. |
| `is_error` | `BOOLEAN` | `boolean` | `true` if tool threw an unhandled error; `false` on success. |
| `error_detail`| `TEXT` | `text` | Error message and stack/cause details if applicable. |
| `result_summary` | `TEXT` | `text` | Truncated result output (up to 1,000 characters). |
| `source` | `VARCHAR(32)` | `varchar(32)` | Transport channel: `'stdio'`, `'sse'`, or `'web'`. |
| `data_source` | `VARCHAR(32)` | `varchar(32)` | Data provenance: `'CACHE'`, `'DB'`, `'VECTOR'`, or `'SCHEMA'`. |

### Database Indices
```sql
CREATE INDEX idx_mcp_audit_created_at ON mcp_audit_logs USING btree (created_at);
CREATE INDEX idx_mcp_audit_tool ON mcp_audit_logs USING btree (tool);
CREATE INDEX idx_mcp_audit_source ON mcp_audit_logs USING btree (source);
```

---

## 3. Tool Palette & Visual Color-Coding

Each MCP tool has an assigned color scheme, icon, and left-border accent in the Web Dashboard audit viewer:

| MCP Tool Name | Color Code | Badge Background | Icon | Description |
| :--- | :--- | :--- | :---: | :--- |
| `get_latest_financial_flash` | `#0284c7` (Sky Blue) | `rgba(2, 132, 199, 0.12)` | ⚡ | Real-time 7x24 live flash stream |
| `get_latest_alerts` | `#f59e0b` (Amber Gold) | `rgba(245, 158, 11, 0.15)` | 🚨 | Breaking news alerts (`importance >= 2`) |
| `query_financial_news_sql` | `#8b5cf6` (Purple) | `rgba(139, 92, 246, 0.15)` | 🔍 | Validated read-only SQL execution |
| `search_news_semantic` | `#ec4899` (Pink) | `rgba(236, 72, 153, 0.15)` | 🧠 | pgvector HNSW cosine similarity search |
| `semantic_search_news` | `#ec4899` (Pink) | `rgba(236, 72, 153, 0.15)` | 🧠 | Web API alias for semantic search |
| `search_news_hybrid` | `#10b981` (Emerald) | `rgba(16, 185, 129, 0.15)` | 🏷️ | Keyword + ticker filter search |
| `search_flash_by_time_window` | `#14b8a6` (Teal) | `rgba(20, 184, 166, 0.15)` | ⏱️ | Timeline event window search |
| `describe_news_schema` | `#64748b` (Slate) | `rgba(100, 116, 139, 0.15)` | 📄 | DDL data dictionary & query guide |
| `reindex_news_embeddings` | `#e11d48` (Rose) | `rgba(225, 29, 72, 0.15)` | 🔄 | Batch vector embedding generation |
| *Dynamic Fallback* | HSL Hash Color | `hsla(H, 80%, 50%, 0.12)` | 🔧 | Deterministic color for custom tools |

---

## 4. REST API Endpoint

### `GET /api/mcp/audit-logs?limit=N`
Returns the recent interactions within the rolling 15-minute window.

#### Response Example
```json
{
  "logs": [
    {
      "id": "eaf41994",
      "timestamp": "2026-09-25T03:50:50.865Z",
      "tool": "get_latest_financial_flash",
      "args": { "limit": 30 },
      "durationMs": 16,
      "isError": false,
      "resultSummary": "{\n  \"items\": [\n    {\n      \"id\": \"5113019\",...",
      "source": "stdio",
      "dataSource": "DB"
    }
  ],
  "count": 1,
  "stats": {
    "size": 1,
    "maxEntries": 2000,
    "rateLimitBuckets": 0,
    "auditLogsCount15m": 1,
    "auditLogsCount5m": 1,
    "hits": 12,
    "misses": 4,
    "hitRate": "75.0%"
  }
}
```

---

## 5. Web UI Features

1. **Top Nav Bar**: Dedicated **"15m Audit Log"** pill button with Lucide-style SVG icon and amber accent.
2. **Card Structure**:
   - **Far Left**: Exact HKT execution timestamp `🕐 HH:mm:ss HKT`.
   - **ID Badge**: Monospace `#id` badge (`font-weight: 700`).
   - **Tool Pill**: Distinct color, icon, and border per MCP tool.
   - **Status Badge**: Green `✓ Xms` or Red `✗ ERROR`.
   - **Data Source Badge**: `⚡ CACHE`, `💾 DB`, `🧠 VECTOR`, or `📄 SCHEMA`.
   - **Transport Source Badge**: `STDIO`, `SSE`, or `WEB`.
   - **Icon Action Button**: 32x32px pill icon button for copying JSON payload with clipboard feedback.
3. **Copy All & Auto-Refresh**:
   - Auto-refreshes every 5 seconds while the modal is open.
   - "Copy All Logs" exports the entire 15-minute log window as formatted JSON.
4. **Summary Header & System Metrics**:
   - Displays real-time **Cache Hit Rate (%)**, total hits, misses, and active cache keys.
