# mini-news — 索引

> 簡介: **Mini-News** — 即時金融快訊抓取、儲存與 **SQL MCP Server** 的後端服務。整合 PostgreSQL + pgvector,提供 ingestion 輪詢、Drizzle ORM schema 推播,並透過 MCP 提供**動態 SQL 查詢**能力給 LLM agent。

## 目錄結構

| 名稱 | 類型 | 說明 |
| --- | --- | --- |
| `src/` | TypeScript 源碼目錄 | 主程式碼 (ingestion poller、MCP server、SQL handlers) |
| `tech-docs/` | 技術文件目錄 | architecture、database schema、port map、MCP、Zeabur 部署指南 (另含 README) |
| `test/` | 測試目錄 | 單元測試、整合測試、`test-ingest.ts` 等 |
| `data/` | 資料目錄 | 抓取的原始/處理資料 |
| `dist/` | 編譯輸出 | TypeScript 編譯後產物 |
| `.planning/` | GSD 規劃目錄 | GSD 工作流規劃 |
| `.agents/` | Agent 設定 | Agent skills / sub-agents |
| `node_modules/` | 套件目錄 | npm 相依 (略) |

## 主要檔案

- `README.md` — 簡介 + Quick Start 三步驟(`docker compose up` → drizzle push → `npm run dev`)
- `package.json` — npm scripts (`dev`、`test:grab`) 與相依
- `tsconfig.json` — TypeScript 編譯設定
- `drizzle.config.ts` — Drizzle ORM CLI 設定
- `Dockerfile` — 容器化建置
- `docker-compose.yml` — 起 PostgreSQL + pgvector(Host Port 5232)
- `.env` / `.env.example` — 環境變數(實際 / 範本)
- `startup.bat` — Windows 啟動腳本
- `stop.bat` — 停止腳本
- `mcp-client-config.json` — MCP client 設定範本
- `minibot.config.json` — MiniBot 設定檔(供 MiniBot 整合使用)

## 備註

- **Port Map(系列 52XX)**:
  - PostgreSQL + pgvector:**5232** (Host)
  - 服務對外:**5200**
- **Tech Stack**:Node.js + TypeScript + Drizzle ORM + PostgreSQL 17 + pgvector + MCP。
- **SQL MCP Server**:動態 SQL 查詢,供 LLM agent 直接 query 最新快訊資料。
- **Ingestion Poller**:即時抓取金融快訊 RSS / API → 入庫。
- 部署選項:本地 Docker、Zeabur PaaS(詳見 `tech-docs/deployment-zeabur.md`)。
- 與 MiniBot (`loop-engg`) 整合:`minibot.config.json` 可掛載此 MCP server 為工具來源。
- 為中型後端專案,有 5 份完整技術文件 (`tech-docs/architecture.md` 等)。
