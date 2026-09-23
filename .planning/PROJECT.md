# Project: Mini-News Backend MCP Server

## Overview
A real-time financial flash news grabber, database storage, and Model Context Protocol (MCP) server.
It continuously grabs live financial flash news (7x24 live stream from mutemute.com/mutenews), parses time-series timestamps, categories, and importance tiers, stores them in SQLite with FTS5, and exposes MCP tools for dynamic SQL generation and retrieval to MiniBot.

## Core Objectives
1. **Real-time News Grabber**: Ingests https://mutemute.com/mutenews/ajax/app-news.php every 60 seconds with cursor pagination and deduplication.
2. **Structured & Time-Axis Storage**: Stores news into SQLite (data/news.db) with columns for UNIX timestamp (created_at), HKT time (	ime_hkt, date_hkt), importance tier (importance: 3 vs 0), category tag (category), and raw text.
3. **Full-Text & Vector Readiness**: Enables SQLite FTS5 for instant keyword and entity search, with an extensible schema for embeddings.
4. **MCP Tool Suite for LLM Agent**:
   - describe_news_schema: DDL schema and sample rows for the agent to compose accurate SQL.
   - query_financial_news_sql: Dynamic read-only SQL query execution with safety checks (SELECT only, max 50 rows).
   - search_news_hybrid: FTS5 full-text + time-window filtered search.
   - get_latest_alerts: Quick access to high-importance breaking news.
5. **MiniBot Integration**: Ready to plug into MiniBot (minibot.config.json) to empower multi-agent research.
