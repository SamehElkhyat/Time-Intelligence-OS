// Measures real request latency against a running backend (no k6 needed).
//   node scripts/bench.mjs [baseUrl] [email] [password] [concurrency] [requestsPerEndpoint]
// Defaults to the seeded demo account. Prints p50 / p95 / p99 / max in milliseconds per endpoint.
// Numbers depend on the machine and data volume — record them with that context, never as promises.
import { performance } from 'node:perf_hooks';

const [BASE = 'http://localhost:4000/api', EMAIL = 'demo@timeflow.app', PASSWORD = 'demo-timeflow-2026', CONC = '8', N = '200'] = process.argv.slice(2);
const concurrency = Number(CONC);
const perEndpoint = Number(N);

let cookie = '';
const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
if (!res.ok) throw new Error(`login failed: ${res.status}`);
cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const today = new Date().toISOString().slice(0, 10);
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

const endpoints = [
  ['GET /availability/day', '/availability/day'],
  ['GET /analytics/dashboard', '/analytics/dashboard'],
  ['GET /analytics/summary (14 days)', `/analytics/summary?from=${ago(13)}&to=${today}`],
  ['GET /analytics/summary (90 days)', `/analytics/summary?from=${ago(89)}&to=${today}`],
  ['GET /productivity/patterns', '/productivity/patterns'],
  ['GET /productivity/leakage', `/productivity/leakage?from=${ago(6)}&to=${today}`],
  ['GET /tasks (page of 25)', '/tasks?pageSize=25'],
  ['GET /activities (page of 25)', '/activities?pageSize=25'],
  ['GET /time-tracking/active', '/time-tracking/active'],
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const rows = [];

for (const [label, path] of endpoints) {
  const times = [];
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (next < perEndpoint) {
      next++;
      const t0 = performance.now();
      const r = await fetch(BASE + path, { headers: { cookie } });
      await r.arrayBuffer();
      times.push(performance.now() - t0);
      if (!r.ok) failures++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const sorted = times.sort((a, b) => a - b);
  rows.push({ endpoint: label, 'p50 ms': +pct(sorted, 50).toFixed(1), 'p95 ms': +pct(sorted, 95).toFixed(1), 'p99 ms': +pct(sorted, 99).toFixed(1), 'max ms': +sorted[sorted.length - 1].toFixed(1), errors: failures });
}
console.log(`\n${perEndpoint} requests per endpoint, concurrency ${concurrency}, ${new Date().toISOString()}\n`);
console.table(rows);
