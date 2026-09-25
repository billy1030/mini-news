# Mini-News Technical Documentation

Welcome to the **Mini-News** technical architecture documentation.

Mini-News is a production-grade 7x24 real-time financial flash news ingestion engine, PostgreSQL/pgvector database storage, and Model Context Protocol (MCP) server designed to empower AI Agents (e.g. MiniBot, Claude Desktop, Cursor) with dynamic SQL query generation and hybrid semantic retrieval.

---

## 📚 Documentation Index

1. [Architecture & System Design](file:///c:/ai/mini-news/tech-docs/architecture.md)
   - High-level system topology, data flow, dynamic poller, and component breakdown.
2. [Database & Schema Specification](file:///c:/ai/mini-news/tech-docs/database-schema.md)
   - PostgreSQL 16 schema, Drizzle ORM models, indexes, and pgvector HNSW layout with MiniMax 1536-dimensional embeddings.
3. [Port Map & Network Configuration](file:///c:/ai/mini-news/tech-docs/port-mapping.md)
   - Standard 52XX port allocations (Web Dashboard: 5200, PostgreSQL: 5232), Docker container bridges, and Zeabur production mapping.
4. [MCP Server & Dynamic SQL Specification](file:///c:/ai/mini-news/tech-docs/mcp-server.md)
   - MCP tool contracts (`describe_news_schema`, `query_financial_news_sql`, `search_news_semantic`, `reindex_news_embeddings`, etc.) and SQL safety filters.
5. [Ingestion & Deduplication Pipeline](file:///c:/ai/mini-news/tech-docs/ingestion-deduplication.md)
   - Dynamic 15s–300s polling mechanics, atomic deduplication, and vector embedding pipeline.
6. [Deployment Guide: Docker & Zeabur](file:///c:/ai/mini-news/tech-docs/deployment-zeabur.md)
   - Multi-stage Docker packaging, environment variables, and Zeabur one-click deployment.
7. [MCP Current vs Next Release Comparison (v1.0 vs v2.0)](file:///c:/ai/mini-news/tech-docs/mcp-v1-vs-v2-comparison.md)
   - Architectural comparison table, multi-user/multi-session SSE transport, continuous micro-batching, and reliability roadmap.
8. [Redis & In-Memory Caching Architecture](file:///c:/ai/mini-news/tech-docs/redis-caching.md)
   - Multi-user hot caching (alerts & semantic queries), real-time Pub/Sub broadcasting, distributed leader election lock, and rate limiting.
