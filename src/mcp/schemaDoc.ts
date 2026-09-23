/**
 * Provides comprehensive database DDL and schema context for LLM agents.
 */
export const NEWS_SCHEMA_DOC = `
# PostgreSQL Database Schema: mini_news

## Table: flash_news
Stores 7x24 real-time financial flash news feeds with time-series and ticker annotations.

### Columns:
- \`id\` (VARCHAR(64), PRIMARY KEY): Unique source news identifier.
- \`created_at\` (TIMESTAMPTZ, NOT NULL): UTC publication timestamp.
- \`date_hkt\` (DATE, NOT NULL): Date formatted in Hong Kong Time (YYYY-MM-DD, Asia/Hong_Kong).
- \`time_hkt\` (VARCHAR(8), NOT NULL): Time formatted in Hong Kong Time (HH:mm:ss).
- \`importance\` (INTEGER, NOT NULL): Importance tier (0 = Normal, 1-2 = Notable, 3 = High Alert / Breaking).
- \`is_alert\` (BOOLEAN, NOT NULL): True if highlighted as urgent red-banner breaking alert.
- \`category\` (VARCHAR(64), NOT NULL): Category tag (e.g. 'general', 'macro', 'equity', 'crypto').
- \`raw_content\` (TEXT, NOT NULL): Full flash news text (UTF-8, Chinese & English).
- \`tickers\` (JSONB, NOT NULL): JSON array of mentioned stock/crypto tickers (e.g., ["AAPL", "NVDA", "BTC"]).
- \`direction\` (VARCHAR(16)): Market sentiment tag: 'UP' (surge/gain), 'DOWN' (drop/fall), 'FLAT'.
- \`embedding\` (VECTOR(1536)): 1536-dimensional semantic embedding vector (pgvector).

### Recommended Query Patterns:
1. **Query by Ticker**:
   SELECT id, time_hkt, raw_content, direction FROM flash_news WHERE tickers @> '["NVDA"]'::jsonb ORDER BY created_at DESC LIMIT 10;

2. **Query Latest Urgent News for Today**:
   SELECT time_hkt, raw_content FROM flash_news WHERE date_hkt = CURRENT_DATE AND (importance >= 2 OR is_alert = true) ORDER BY created_at DESC LIMIT 20;

3. **Keyword Full-Text Matching**:
   SELECT time_hkt, raw_content, direction FROM flash_news WHERE raw_content ILIKE '%降息%' ORDER BY created_at DESC LIMIT 10;
`;
