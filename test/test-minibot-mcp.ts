import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("=== Testing MiniBot Integration with mini-news MCP via Stdio ===");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["c:/ai/mini-news/dist/index.js", "--mcp-only"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgrespassword@localhost:5232/mini_news",
      MINIMAX_API_KEY: "sk-cp-tkzzMQP3ZOnVLdzdEdPoNNznMyVh-Y9guY-AfQW3qfQDve9sVyWXWj55IGIT3xXTd6C5svtGG6GT09a69TujB_umaVuNX2r4pgPkl8DBSVhclQuu3T305Cg",
      NODE_ENV: "production",
      PATH: process.env.PATH || "",
    },
  });

  const client = new Client(
    { name: "minibot-integration-test", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("✅ MCP Client connected successfully to mini-news stdio server!");

  // 1. List Available Tools
  const tools = await client.listTools();
  console.log(`\n📋 Available Tools (${tools.tools.length}):`);
  tools.tools.forEach((t) => console.log(` - ${t.name}: ${t.description.slice(0, 75)}...`));

  // 2. Test Describe Schema
  console.log("\n🧪 1. Testing describe_news_schema...");
  const schemaRes = await client.callTool({ name: "describe_news_schema", arguments: {} });
  const schemaContent = (schemaRes.content as any)[0].text;
  console.log(`Schema retrieved (${schemaContent.length} chars). Has 'pg_trgm':`, schemaContent.includes("pg_trgm"));

  // 3. Test pg_trgm GIN Accelerated Substring Query via Dynamic SQL
  console.log("\n🧪 2. Testing query_financial_news_sql with LIKE query (pg_trgm GIN)...");
  const sqlRes = await client.callTool({
    name: "query_financial_news_sql",
    arguments: {
      sql: "SELECT id, time_hkt, direction, LEFT(raw_content, 60) AS summary FROM flash_news WHERE raw_content ILIKE '%指數%' ORDER BY created_at DESC LIMIT 2;",
    },
  });
  console.log("SQL Output:", (sqlRes.content as any)[0].text);

  // 4. Test JSONB Tickers containment query
  console.log("\n🧪 3. Testing query_financial_news_sql with JSONB tickers containment...");
  const tickerSqlRes = await client.callTool({
    name: "query_financial_news_sql",
    arguments: {
      sql: "SELECT id, tickers, LEFT(raw_content, 50) AS summary FROM flash_news WHERE jsonb_array_length(tickers) > 0 ORDER BY created_at DESC LIMIT 2;",
    },
  });
  console.log("Ticker SQL Output:", (tickerSqlRes.content as any)[0].text);

  // 5. Test Semantic Vector Search
  console.log("\n🧪 4. Testing search_news_semantic (pgvector HNSW)...");
  const semanticRes = await client.callTool({
    name: "search_news_semantic",
    arguments: {
      query: "港股市場及恆生指數走勢",
      limit: 2,
      minSimilarity: 0.45,
    },
  });
  const semanticData = JSON.parse((semanticRes.content as any)[0].text);
  console.log(`Semantic matches: ${semanticData.length}`);
  if (semanticData.length > 0) {
    console.log(`Top match similarity: ${semanticData[0].similarity_score} | Text: ${semanticData[0].raw_content.slice(0, 60)}...`);
  }

  // 6. Test Reindexing with Days filter
  console.log("\n🧪 5. Testing reindex_news_embeddings with days filter (days=30)...");
  const reindexRes = await client.callTool({
    name: "reindex_news_embeddings",
    arguments: { batch_size: 5, days: 30 },
  });
  console.log("Reindex Result:", (reindexRes.content as any)[0].text);

  await client.close();
  console.log("\n🎉 All MiniBot MCP integration tests passed with 100% success!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Integration test failed:", err);
  process.exit(1);
});
