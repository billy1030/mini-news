import { pool } from "../db/index.js";

/**
 * Validates that a SQL string is strictly a safe read-only SELECT query.
 * Blocks mutations, DDL, injections, and dangerous system functions.
 */
export function validateReadOnlySql(rawSql: string): { isValid: boolean; error?: string; sanitizedSql: string } {
  const trimmed = rawSql.trim();

  // Strip trailing semicolons
  const cleanSql = trimmed.replace(/;+\s*$/, "");

  // Check for multi-statement semicolons
  if (cleanSql.includes(";")) {
    return {
      isValid: false,
      error: "Multiple SQL statements separated by semicolons are not allowed.",
      sanitizedSql: cleanSql,
    };
  }

  // Must start with SELECT or WITH (Common Table Expressions)
  const isSelectOrWith = /^(SELECT|WITH)\b/i.test(cleanSql);
  if (!isSelectOrWith) {
    return {
      isValid: false,
      error: "Only read-only SELECT or WITH (CTE) queries are permitted.",
      sanitizedSql: cleanSql,
    };
  }

  // Block dangerous write/DDL keywords
  const blockedKeywords = [
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bTRUNCATE\b/i,
    /\bCREATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bCOPY\b/i,
    /\bEXECUTE\b/i,
    /\bVACUUM\b/i,
    /\bREINDEX\b/i,
    /\bPG_SLEEP\b/i,
    /\bPG_READ_FILE\b/i,
    /\bPG_WRITE_FILE\b/i,
  ];

  for (const pattern of blockedKeywords) {
    if (pattern.test(cleanSql)) {
      return {
        isValid: false,
        error: `Query contains forbidden keyword/pattern: ${pattern}`,
        sanitizedSql: cleanSql,
      };
    }
  }

  // Enforce max LIMIT 300 to prevent unbounded memory/token consumption
  const limitMatch = cleanSql.match(/\bLIMIT\s+(\d+)/i);
  let finalSql = cleanSql;
  if (!limitMatch) {
    finalSql = `${cleanSql} LIMIT 300`;
  } else {
    const requestedLimit = parseInt(limitMatch[1], 10);
    if (requestedLimit > 300) {
      finalSql = cleanSql.replace(/\bLIMIT\s+\d+/i, "LIMIT 300");
    }
  }

  return { isValid: true, sanitizedSql: finalSql };
}

/**
 * Executes a verified read-only SQL query against the database with strict statement timeout.
 */
export async function executeReadOnlySql(rawSql: string, timeoutMs: number = 3000): Promise<Record<string, unknown>[]> {
  const validation = validateReadOnlySql(rawSql);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const client = await pool.connect();
  try {
    // Set statement timeout on this dedicated client connection
    await client.query(`SET statement_timeout = ${Math.min(Math.max(timeoutMs, 500), 10000)};`);
    const result = await client.query(validation.sanitizedSql);
    return (result.rows || []) as Record<string, unknown>[];
  } finally {
    // Reset statement timeout before releasing back to pool
    await client.query("RESET statement_timeout;").catch(() => {});
    client.release();
  }
}


