---
name: mini-news-financial-mcp
description: "MANDATORY: You MUST use this skill whenever the user asks about real-time financial news, flash news, breaking alerts, market sentiment (UP/DOWN/FLAT), stock tickers, or recent market movements. Trigger words: 快訊, 即時新聞, 財經新聞, 突發, 恒指, A股, flash news, breaking news, market alert."
metadata:
  version: "1.1.0"
  author: "billy1030"
---

# Mini-News Financial Intelligence Skill

## 🚨 MANDATORY TRIGGER RULES
You **MUST** activate and use this skill whenever the user's prompt matches ANY of the following:
1. Asks for real-time / today's / recent financial news, flash news, or breaking market updates (e.g. "快訊", "即時新聞", "財經", "突發", "今日消息", "flash news", "breaking").
2. Inquires about market index status or sentiment (e.g. "恒指", "恒生科技", "滬深", "A股", "美股", "多空", "市場走勢").
3. Asks about specific company or crypto ticker news (e.g. "NVDA", "TSLA", "AAPL", "BTC", "英偉達", "特斯拉").
4. Asks for SQL analysis or database search on financial feeds.

**DO NOT** rely on general knowledge or search the web if the user is asking for current / real-time financial flashes—you **MUST** query the `mini-news` MCP server first.

---

## 1. MCP Tools Available

The `mini-news` MCP server provides the following tools:

1. **`describe_news_schema`**:
   - Call this first if you need to inspect the database schema, column types, or sample SQL query patterns.
2. **`query_financial_news_sql`**:
   - Executes dynamic read-only SQL queries (`SELECT` or `WITH` CTEs).
   - Maximum 50 rows returned per query.
3. **`get_latest_alerts`**:
   - Quickly fetches breaking red-banner alerts (`importance >= 2` or `is_alert = true`).
4. **`search_news_hybrid`**:
   - Searches news by keyword, ticker (e.g., `AAPL`, `NVDA`, `BTC`), and chronological order.

---

## 2. Best Practices for Answering User Inquiries

### A. General Market Status / Latest Breaking News
- Call `get_latest_alerts({ limit: 10 })` to get the most urgent market news flashes.
- Focus on the `time_hkt`, `direction`, and key market impacts.

### B. Company or Ticker Inquiries (e.g. "What happened to NVDA/TSLA?")
- You can use `search_news_hybrid`:
  ```json
  { "ticker": "NVDA", "limit": 10 }
  ```
- Or execute a targeted SQL query via `query_financial_news_sql`:
  ```sql
  SELECT time_hkt, date_hkt, raw_content, direction 
  FROM flash_news 
  WHERE tickers @> '["NVDA"]'::jsonb 
  ORDER BY created_at DESC LIMIT 10;
  ```

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
