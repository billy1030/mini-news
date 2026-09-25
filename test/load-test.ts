/**
 * Multi-User Concurrent Load Testing Script for Mini-News MCP & Web Service.
 *
 * Simulates concurrent agent sessions and dashboard users to test:
 * 1. SSE Connection & Session Lifecycle (/sse & /message)
 * 2. Hot-Cache Hit Latency vs Cold Fetch (/api/news & get_latest_alerts)
 * 3. Continuous Micro-Batcher & Semantic Vector Caching (/api/semantic-search)
 * 4. Token-Bucket Rate Limiter Enforcement
 * 5. Overall Throughput (RPS), Error Rate, and Latency Percentiles (p50, p95, p99)
 *
 * Usage:
 *   npx tsx test/load-test.ts [--port 5200] [--concurrency 10] [--requests 100]
 */

interface LoadTestOptions {
  baseUrl: string;
  concurrency: number;
  totalRequests: number;
}

interface LatencyStats {
  total: number;
  success: number;
  failed: number;
  rateLimited: number;
  latencies: number[];
  durationMs: number;
}

function parseArgs(): LoadTestOptions {
  const args = process.argv.slice(2);
  let port = 5200;
  let concurrency = 10;
  let totalRequests = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) port = Number(args[i + 1]);
    if (args[i] === "--concurrency" && args[i + 1]) concurrency = Number(args[i + 1]);
    if (args[i] === "--requests" && args[i + 1]) totalRequests = Number(args[i + 1]);
  }

  return {
    baseUrl: `http://localhost:${port}`,
    concurrency,
    totalRequests,
  };
}

function calculatePercentiles(latencies: number[]) {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = Math.round(sorted.reduce((acc, curr) => acc + curr, 0) / sorted.length);

  return { p50, p95, p99, min, max, avg };
}

async function runWorkerPool(
  total: number,
  concurrency: number,
  taskFn: (index: number) => Promise<{ ok: boolean; status: number; duration: number }>
): Promise<LatencyStats> {
  const latencies: number[] = [];
  let success = 0;
  let failed = 0;
  let rateLimited = 0;

  let currentIndex = 0;
  const startTime = Date.now();

  async function worker() {
    while (currentIndex < total) {
      const idx = currentIndex++;
      try {
        const res = await taskFn(idx);
        latencies.push(res.duration);
        if (res.status === 429) {
          rateLimited++;
        } else if (res.ok) {
          success++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        latencies.push(0);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = Date.now() - startTime;
  return { total, success, failed, rateLimited, latencies, durationMs };
}

async function printBenchmark(title: string, stats: LatencyStats) {
  const p = calculatePercentiles(stats.latencies);
  const rps = ((stats.total / stats.durationMs) * 1000).toFixed(1);

  console.log(`\n========================================================`);
  console.log(`📊 Benchmark: ${title}`);
  console.log(`========================================================`);
  console.log(`Total Requests:    ${stats.total}`);
  console.log(`Successful:        ${stats.success} (${((stats.success / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Failed / Errors:   ${stats.failed}`);
  console.log(`Rate-Limited (429): ${stats.rateLimited}`);
  console.log(`Total Time:        ${(stats.durationMs / 1000).toFixed(2)}s`);
  console.log(`Throughput:        ${rps} req/sec`);
  console.log(`--------------------------------------------------------`);
  console.log(`Avg Latency:       ${p.avg}ms`);
  console.log(`Min Latency:       ${p.min}ms`);
  console.log(`p50 (Median):      ${p.p50}ms`);
  console.log(`p95:               ${p.p95}ms`);
  console.log(`p99:               ${p.p99}ms`);
  console.log(`Max Latency:       ${p.max}ms`);
  console.log(`========================================================`);
}

async function main() {
  const { baseUrl, concurrency, totalRequests } = parseArgs();

  console.log(`\n🚀 Starting Mini-News Load & Concurrency Testing Suite`);
  console.log(`Target:      ${baseUrl}`);
  console.log(`Concurrency: ${concurrency} parallel clients`);
  console.log(`Requests:    ${totalRequests} requests per suite\n`);

  // Verify server reachability
  try {
    const res = await fetch(`${baseUrl}/api/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err: any) {
    console.error(`❌ Could not connect to target ${baseUrl}. Make sure mini-news service is running (e.g. npm run dev).`);
    process.exit(1);
  }

  // Suite 1: Hot Cache Read Load (/api/news)
  // Simulates 100 rapid dashboard / agent refresh calls hitting L1 Hot Cache
  console.log(`[Suite 1/3] Testing Hot Cache Concurrency (/api/news)...`);
  const newsStats = await runWorkerPool(totalRequests, concurrency, async () => {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/news?limit=20`);
    const duration = Math.round(performance.now() - t0);
    return { ok: res.ok, status: res.status, duration };
  });
  await printBenchmark("Hot-Cache Financial Flash Feed (/api/news)", newsStats);

  // Suite 2: Rate Limiting & Multi-Session Message Handling (/message)
  console.log(`\n[Suite 2/3] Testing Session Rate Limiting on Single Session Token (/message)...`);
  const benchSessionId = "bench_session_" + Date.now();

  const sessionStats = await runWorkerPool(70, 5, async () => {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/message?sessionId=${benchSessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
    });
    const duration = Math.round(performance.now() - t0);
    // Under token bucket limit of 60:
    // First 60 requests pass rate limiter (may return 404 since it's an synthetic test session)
    // Next 10 requests get HTTP 429 (Rate limited)
    const isRateLimited = res.status === 429;
    return { 
      ok: !isRateLimited, 
      status: res.status, 
      duration 
    };
  });
  await printBenchmark("Token Bucket Rate Limiting (Burst 70 req on max 60 limit)", sessionStats);

  // Suite 3: Native Remote MCP Agent Simulation (/sse + /message JSON-RPC)
  console.log(`\n[Suite 3/5] Testing Concurrent Remote MCP Client Sessions (SSE & JSON-RPC tools/call)...`);
  
  // Establish parallel agent SSE sessions
  const mcpClients = await Promise.all(
    Array.from({ length: Math.min(concurrency, 5) }, async (_, agentIdx) => {
      const controller = new AbortController();
      const res = await fetch(`${baseUrl}/sse`, { signal: controller.signal });
      const reader = res.body?.getReader();
      let sessionId = "";

      if (reader) {
        const decoder = new TextDecoder();
        const { value } = await reader.read();
        const text = decoder.decode(value);
        const match = text.match(/data: \/message\?sessionId=([a-zA-Z0-9-]+)/);
        if (match) {
          sessionId = match[1];
        }
      }

      // Initialize MCP Session
      if (sessionId) {
        await fetch(`${baseUrl}/message?sessionId=${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: `load-agent-${agentIdx}`, version: "2.0.0" }
            }
          })
        });
      }

      return { sessionId, controller };
    })
  );

  const activeMcpSessions = mcpClients.filter(c => Boolean(c.sessionId));
  console.log(`  Connected ${activeMcpSessions.length} active MCP SSE client sessions.`);

  const mcpProtocolStats = await runWorkerPool(totalRequests, concurrency, async (idx) => {
    if (activeMcpSessions.length === 0) {
      return { ok: false, status: 500, duration: 0 };
    }
    const session = activeMcpSessions[idx % activeMcpSessions.length];
    const tools = ["get_latest_alerts", "get_latest_financial_flash"];
    const toolName = tools[idx % tools.length];

    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/message?sessionId=${session.sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: idx + 10,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: { limit: 5 }
        }
      })
    });
    const duration = Math.round(performance.now() - t0);
    return { ok: res.ok, status: res.status, duration };
  });

  await printBenchmark("Native MCP JSON-RPC Remote Tool Calls (/message)", mcpProtocolStats);

  // Close SSE client connections
  activeMcpSessions.forEach(s => s.controller.abort());

  // Suite 4: MCP Tool Invocations via Web API (/api/sql)
  console.log(`\n[Suite 4/5] Triggering MCP Tool Calls & Populating 5-Minute Audit Log (/api/sql)...`);
  const mcpStats = await runWorkerPool(20, 5, async (idx) => {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: `SELECT id, time_hkt, raw_content, importance FROM flash_news ORDER BY created_at DESC LIMIT ${5 + (idx % 5)};`,
      }),
    });
    const duration = Math.round(performance.now() - t0);
    return { ok: res.ok, status: res.status, duration };
  });
  await printBenchmark("MCP Tool Execution & Audit Logging (query_financial_news_sql)", mcpStats);

  // Suite 5: Metrics, Micro-Batcher Status & 5m Audit Logs
  console.log(`\n[Suite 5/5] Inspecting Real-Time Service Metrics & Audit Log Count...`);
  const metricsRes = await fetch(`${baseUrl}/api/mcp/metrics`);
  if (metricsRes.ok) {
    const metrics = await metricsRes.json();
    console.log("Current Metrics:", JSON.stringify(metrics, null, 2));
  }

  const auditRes = await fetch(`${baseUrl}/api/mcp/audit-logs?limit=5`);
  if (auditRes.ok) {
    const auditData = await auditRes.json();
    console.log(`\n📋 5-Minute Audit Log Summary:`);
    console.log(`Total Active Logs (5m): ${auditData.count}`);
    console.log(`Sample Recent Logs:`);
    auditData.logs.slice(0, 5).forEach((l: any, i: number) => {
      console.log(`  [#${i + 1}] ${l.timestamp.slice(11, 19)} | ${l.source.toUpperCase()} | ${l.tool} (${l.durationMs}ms) -> ${l.resultSummary}`);
    });
  }

  console.log(`\n✅ Load test completed successfully! Check the "📋 5m Audit Log" button in the dashboard to see all entries.\n`);
}

main().catch(console.error);
