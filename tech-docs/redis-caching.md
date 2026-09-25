# Redis Architecture & Caching Specification

This document specifies the **Redis & In-Memory Caching Architecture** for `mini-news`, designed to support high-concurrency multi-user queries, LLM rate-limit mitigation, and distributed real-time news streaming.

---

## 1. Architectural Overview & Objectives

In a multi-user or agentic environment, real-time financial news querying exhibits distinct patterns:
1. **Burst Read Concurrency**: Multiple autonomous agents and human analysts simultaneously query the same breaking news flashes (e.g. FOMC statements, CPI releases, emergency rate fixes).
2. **Repetitive Semantic Queries**: Similar natural language search concepts (e.g., "Fed rate hike", "Middle East crude oil supply") are submitted repeatedly across different user sessions.
3. **Database & API Protection**: Uncached dynamic SQL can saturate the PostgreSQL connection pool, while redundant embedding requests can exceed MiniMax API quotas (HTTP 429).

```
                      ┌──────────────────────────────────────────────┐
                      │             Incoming Requests                │
                      │  (Multi-Session MCP SSE / Web Dashboard / API)│
                      └──────────────────────┬───────────────────────┘
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │    L1 In-Memory / L2 Redis Cache Layer       │
                      │  - Hot Flash Cache (TTL: 5-15s)              │
                      │  - Semantic Embedding Cache (TTL: 24h)       │
                      │  - Token Bucket Rate Limiter                 │
                      └──────────────┬───────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
          [Cache Hit]│                                │[Cache Miss]
                    ▼                                 ▼
         Immediate Response (0-1ms)          ┌───────────────────┐
                                             │ PostgreSQL 5232 / │
                                             │ MiniMax API /     │
                                             │ Micro-Batcher     │
                                             └───────────────────┘
```

---

## 2. Core Redis-Like Capabilities

### 2.1 Result Caching (Hot Flash & Alerts Cache)
- **Target Operations**: `get_latest_alerts`, `get_latest_financial_flash`, `/api/news`.
- **Key Schema**:
  - `cache:alerts:latest:{limit}` (TTL: `5s`)
  - `cache:flash:latest:{limit}` (TTL: `10s`)
- **Eviction Strategy**: Time-To-Live (TTL) with opportunistic invalidation when the poller inserts high-priority alert items (`importance >= 2` or `is_alert = true`).
- **Benefit**: Reduces PostgreSQL read load by up to **90%** during major market volatility events.

### 2.2 Semantic Vector Cache (MiniMax Embedding Deduplication)
- **Target Operations**: `search_news_semantic`, `/api/semantic-search`.
- **Key Schema**:
  - `cache:embedding:{sha256(queryText)}` (TTL: `24 hours`)
- **Benefit**:
  - Eliminates upstream API round-trips for identical or repeated natural language questions.
  - Decreases semantic search latency from ~350ms to **under 2ms**.
  - Directly reduces MiniMax token billing.

### 2.3 Real-Time Pub/Sub (Flash Event Broadcasting)
- **Channel**: `financial:news:stream` and `financial:news:alerts`
- **Behavior**:
  - Background Poller acts as Publisher upon successful deduplication and commit of new rows.
  - MCP SSE Session Manager acts as Subscriber, dispatching real-time notifications to all active SSE client streams (`/sse`) without requiring clients to poll.

### 2.4 Distributed Poller Lock (Multi-Instance Leader Election)
- **Target**: Horizontal scaling across multiple Docker containers or Zeabur replicas.
- **Key Schema**: `lock:poller:ingestion` (TTL: `15s`, auto-renewing heartbeat)
- **Behavior**:
  - Prevents race conditions and redundant upstream scraping when multiple container instances run simultaneously.
  - If the active leader container fails, the lock expires after 15s, allowing a standby replica to assume polling duties automatically.

### 2.5 Token Bucket Rate Limiter
- **Target**: Per-user / per-session throttling over HTTP/SSE.
- **Key Schema**: `ratelimit:{sessionId}:{minuteWindow}`
- **Threshold**: Default 60 requests/minute per session.
- **Response**: HTTP 429 (`Too Many Requests`) with `Retry-After` header.

---

## 3. Tiered Implementation Strategy

`mini-news` employs a **Dual-Mode Tiered Architecture**:

| Feature | Tier 1: Built-in In-Memory (Zero Extra Infra) | Tier 2: Dedicated Redis Container (Port 5279) |
| :--- | :--- | :--- |
| **Prerequisites** | None (Node.js runtime memory) | `docker-compose.yml` with `redis:7-alpine` |
| **Configuration** | Default (when `REDIS_URL` is empty) | Set `REDIS_URL=redis://localhost:5279` |
| **Hot Flash Cache** | In-process Map with timestamp TTL | Redis strings with native `EX` expiration |
| **Semantic Cache** | LRU memory store (up to 1,000 queries) | Redis Hash / Key store (persistent across restarts) |
| **Event Broadcasting**| Node.js internal `EventEmitter` | Redis `PUBLISH` / `SUBSCRIBE` across containers |
| **Leader Lock** | Process-local mutex | Redis `SET ... NX PX` distributed lock |
| **Scaling Capability**| Single-process / local development | Horizontal scale-out (Zeabur / K8s multi-replica) |

---

## 4. Docker Compose & Port Allocation

When enabling Tier 2 (Dedicated Redis), `mini-news` standardizes on **Port 5279** within the reserved `52XX` range:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: mini-news-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass redispassword
    ports:
      - "5279:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "redispassword", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  redis_data:
```

### Environment Variable (`.env`)
```bash
# Redis Configuration (Optional - falls back to built-in In-Memory cache if omitted)
REDIS_URL=redis://:redispassword@localhost:5279
REDIS_CACHE_TTL_ALERTS=5
REDIS_CACHE_TTL_FLASH=10
REDIS_CACHE_TTL_VECTORS=86400
```
