import { validateReadOnlySql } from "../src/mcp/sqlSafety.js";

function testSqlSafety() {
  console.log("=== Testing SQL Safety & Read-Only Validator ===");

  const testCases = [
    {
      sql: "SELECT id, time_hkt, raw_content FROM flash_news WHERE date_hkt = '2026-09-23'",
      expectedValid: true,
      desc: "Standard SELECT",
    },
    {
      sql: "WITH recent AS (SELECT * FROM flash_news LIMIT 5) SELECT * FROM recent",
      expectedValid: true,
      desc: "CTE WITH query",
    },
    {
      sql: "SELECT * FROM flash_news LIMIT 200",
      expectedValid: true,
      desc: "SELECT with high limit (should cap to 50)",
    },
    {
      sql: "DROP TABLE flash_news",
      expectedValid: false,
      desc: "Malicious DROP TABLE",
    },
    {
      sql: "INSERT INTO flash_news (id) VALUES ('hack')",
      expectedValid: false,
      desc: "Malicious INSERT",
    },
    {
      sql: "SELECT * FROM flash_news; DELETE FROM flash_news",
      expectedValid: false,
      desc: "Multi-statement semicolon injection",
    },
    {
      sql: "SELECT pg_sleep(10)",
      expectedValid: false,
      desc: "Dangerous system function call",
    },
  ];

  let passed = 0;
  for (const tc of testCases) {
    const res = validateReadOnlySql(tc.sql);
    const ok = res.isValid === tc.expectedValid;
    if (ok) passed++;
    console.log(
      `[${ok ? "PASS" : "FAIL"}] ${tc.desc}:`,
      res.isValid ? `Valid -> "${res.sanitizedSql}"` : `Blocked -> "${res.error}"`
    );
  }

  console.log(`\nResults: ${passed} / ${testCases.length} tests passed.`);
}

testSqlSafety();
