# Port Map & Network Configuration

To prevent collisions with commonly used local development ports (such as `3000`, `8080`, and default PostgreSQL `5432`), **Mini-News** reserves and standardizes on the **52XX** port range.

---

## Port Allocation Matrix

| Service | Internal Port | Host / Exposed Port | Protocol | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Web Dashboard / GUI** | `5200` | **`5200`** | HTTP / WS | Web control panel, configuration UI, live monitor |
| **PostgreSQL Database** | `5432` | **`5232`** | TCP (PostgreSQL) | Local Docker Postgres container (`pgvector:pg16`) |
| **Redis Cache (Optional)** | `6379` | **`5279`** | TCP (Redis) | L2 hot cache, Pub/Sub, distributed lock (`redis:7-alpine`) |

---

## Local Development vs. Production (Zeabur)

### Local Development (`.env`)
```bash
PORT=5200
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5232/mini_news
```
- PostgreSQL is mapped to port **5232** on the host.
- Applications and scripts connect locally via `localhost:5232`.

### Production on Zeabur
- When deploying to **Zeabur**, services communicate via Zeabur's internal private network.
- Zeabur automatically injects `DATABASE_URL` and routes external HTTP traffic from custom domains to the port specified in `PORT` (`5200`).
