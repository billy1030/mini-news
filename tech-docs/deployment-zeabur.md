# Production Deployment: Docker & Zeabur

Mini-News is designed for containerized production deployment.

---

## 1. Multi-Stage Dockerfile Overview

The [`Dockerfile`](file:///c:/ai/mini-news/Dockerfile) uses a multi-stage build:
- **`builder` (Node 22-alpine)**: Installs development dependencies, compiles TypeScript code to `dist/`, and strips dev dependencies.
- **`runner` (Node 22-alpine)**: Production-only image containing only `dist/` and production `node_modules`, running under a non-root `node` user on port `5200`.

---

## 2. Deploying on Zeabur

[Zeabur](https://zeabur.com) offers zero-downtime deployment with managed PostgreSQL and pgvector.

### Step 1: Provision PostgreSQL on Zeabur
1. In your Zeabur project, click **Create Service** -> **Marketplace** -> **PostgreSQL**.
2. Go to the PostgreSQL service **Variables** or **Networking** tab to retrieve the internal or external connection string.
3. In PostgreSQL console or via SQL client, enable vector:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

### Step 2: Deploy Mini-News
1. Link your GitHub repository in Zeabur.
2. Zeabur will automatically detect the root `Dockerfile`.
3. In the Mini-News service **Variables** tab, set:
   - `DATABASE_URL`: `${POSTGRES_CONNECTION_STRING}` (or the internal service URL).
   - `PORT`: `5200`
   - `NODE_ENV`: `production`
   - `POLL_INTERVAL_SECONDS`: `60`
4. Click **Deploy**. Zeabur will build and start the container with persistent 7x24 news ingestion.
