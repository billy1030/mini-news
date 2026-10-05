---
name: mini-news-financial-mcp
description: "Query 7x24 real-time financial flash news, market sentiment (UP/DOWN/FLAT), stock tickers, and execute safe dynamic SQL queries via the mini-news MCP server when the user mentions mini-news."
metadata:
  version: "1.0.0"
  author: "billy1030"
---

# Mini-News Financial Intelligence Skill

## Trigger Keyword
Trigger this skill when the user explicitly mentions **`mini-news`** or asks to query via mini-news (e.g. *"mini-news to..."*).

---

## 1. MCP Tools Available

The `mini-news` MCP server provides the following tools:

1. **`describe_news_schema`**:
   - Call this first if you need to inspect the database schema, column types, or sample SQL query patterns.
2. **`query_financial_news_sql`**:
   - Executes dynamic read-only SQL queries (`SELECT` or `WITH` CTEs).
   - Maximum 300 rows returned per query.
3. **`get_latest_alerts`**:
   - Quickly fetches breaking red-banner alerts (`importance >= 2` or `is_alert = true`).
4. **`search_news_hybrid`**:
   - Searches news by keyword, ticker (e.g., `AAPL`, `NVDA`, `BTC`), and chronological order.
5. **`search_news_semantic`**:
   - Executes AI vector semantic search via MiniMax `embo-01` and pgvector HNSW cosine similarity.
   - Ideal for conceptual, macroeconomic, or thematic inquiries without needing exact keyword matches.
   - Optional `minSimilarity`: Confidence threshold (e.g. `0.60` for Relevant, `0.70` for High Match).
6. **`reindex_news_embeddings`**:
   - Scans and generates MiniMax vector embeddings for news items that currently have NULL embeddings.
   - Optional `days`: Reindex only items from the last X days (default: 30 days, 0 for all time).

---

## 2. Best Practices for Answering User Inquiries

### A. Conceptual & Thematic Inquiries (e.g. "What is happening in the Middle East oil market?")
- Call `search_news_semantic`:
  ```json
  { "query": "中東局勢與原油石油市場走勢", "limit": 5, "minSimilarity": 0.50 }
  ```
- Uses HNSW vector cosine similarity to retrieve thematic matches with high confidence.

### B. Company or Ticker Inquiries (e.g. "What happened to NVDA/TSLA?")
- Execute a targeted SQL query via `query_financial_news_sql` (accelerated by JSONB GIN index):
  ```sql
  SELECT time_hkt, date_hkt, raw_content, direction 
  FROM flash_news 
  WHERE tickers @> '["NVDA"]'::jsonb 
  ORDER BY created_at DESC LIMIT 10;
  ```
- Or call `search_news_hybrid`: `{ "ticker": "NVDA", "limit": 10 }`

### C. General Market Status / Latest Breaking News
- Call `get_latest_alerts({ limit: 10 })` to get the most urgent market news flashes.
- Focus on the `time_hkt`, `direction`, and key market impacts.

### C. Market Sentiment & Trend Inquiries (e.g. "Is the market bullish or bearish today?")
- Run an aggregation query:
  ```sql
  SELECT direction, count(*) as count 
  FROM flash_news 
  WHERE date_hkt = CURRENT_DATE 
  GROUP BY direction;
  ```
- Compare the count of `UP` (surging/gains) vs `DOWN` (drops/plunges) to provide a factual, data-driven summary.

### D. Keyword / Sector Specific Inquiries (e.g. "Any news on Fed interest rates?")
- Query with `ILIKE` pattern matching:
  ```sql
  SELECT time_hkt, raw_content, direction 
  FROM flash_news 
  WHERE raw_content ILIKE '%降息%' OR raw_content ILIKE '%利率%' 
  ORDER BY created_at DESC LIMIT 10;
  ```

---

## 3. SQL Safety Rules
- Only `SELECT` and `WITH` statements are permitted.
- Never write `INSERT`, `UPDATE`, `DELETE`, or `DROP`.
- Do not use multiple statements separated by semicolons.
- Maximum results are capped at 50 rows automatically.
