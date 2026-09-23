# Mini-News: Real-time Financial Flash and SQL MCP Server

Backend service for real-time financial flash news grabbing, storage, and dynamic SQL query execution via MCP.

---

## 📖 Technical Documentation

All detailed system specifications, database schemas, port matrices, and deployment guidelines are organized under [`tech-docs/`](file:///c:/ai/mini-news/tech-docs/README.md):

- [Architecture & System Design](file:///c:/ai/mini-news/tech-docs/architecture.md)
- [Database & Schema Specification (PostgreSQL + pgvector)](file:///c:/ai/mini-news/tech-docs/database-schema.md)
- [Port Map & Network Configuration (52XX Series)](file:///c:/ai/mini-news/tech-docs/port-mapping.md)
- [MCP Server & Dynamic SQL Specification](file:///c:/ai/mini-news/tech-docs/mcp-server.md)
- [Deployment Guide: Docker & Zeabur](file:///c:/ai/mini-news/tech-docs/deployment-zeabur.md)

---

## ⚡ Quick Start

### 1. Start Local PostgreSQL with pgvector (Host Port 5232)
```bash
docker compose up -d
```

### 2. Push Schema & Test Ingestion
```bash
npx drizzle-kit push --force
npm run test:grab
npx tsx test/test-ingest.ts
```

### 3. Run Service (Ingestion Poller + MCP Server on Port 5200)
```bash
npm run dev
```
