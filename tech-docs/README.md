# Mini-News Technical Documentation Architecture

Welcome to the **Mini-News** technical architecture documentation.

Mini-News is a production-grade 7x24 real-time financial flash news ingestion engine, PostgreSQL/pgvector database storage, and Model Context Protocol (MCP) server designed to empower AI Agents (e.g. MiniBot, Claude Desktop, Cursor) with dynamic SQL query generation and hybrid semantic retrieval.

---

## 📚 Documentation Index

1. [Architecture & System Design](file:///c:/ai/mini-news/tech-docs/architecture.md)
   - High-level system topology, data flow, and component breakdown.
2. [Database & Schema Specification](file:///c:/ai/mini-news/tech-docs/database-schema.md)
   - PostgreSQL 16 schema, Drizzle ORM models, indexes, and pgvector HNSW layout.
3. [Port Map & Network Configuration](file:///c:/ai/mini-news/tech-docs/port-mapping.md)
   - Standard 52XX port allocations, Docker container bridges, and Zeabur production mapping.
4. [MCP Server & Dynamic SQL Specification](file:///c:/ai/mini-news/tech-docs/mcp-server.md)
   - MCP tool contracts (`describe_news_schema`, `query_financial_news_sql`, etc.) and SQL safety filters.
5. [Deployment Guide: Docker & Zeabur](file:///c:/ai/mini-news/tech-docs/deployment-zeabur.md)
   - Multi-stage Docker packaging, environment variables, and Zeabur one-click deployment.
