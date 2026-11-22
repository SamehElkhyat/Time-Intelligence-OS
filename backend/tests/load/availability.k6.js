// k6 load test for the read-heavy endpoints.
//   k6 run tests/load/availability.k6.js
//   k6 run -e BASE_URL=https://staging.example.com/api -e VUS=50 -e DURATION=2m tests/load/availability.k6.js
//
// Each virtual user signs in as its own account (so per-user caching and locking behave as in
// production), seeds a small realistic day once, then repeatedly reads the main screens.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api';
const availabilityMs = new Trend('availability_day_ms', true);
const dashboardMs = new Trend('dashboard_ms', true);

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<600'],
    availability_day_ms: ['p(95)<400'],
    dashboard_ms: ['p(95)<600'],
  },
};

const jar = http.cookieJar();

export function setup() {
  return { runId: `${Date.now()}` };
}

function json(res) {
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}

export default function (data) {
  // one account per VU, created on the first iteration
  if (!globalThis.__session) {
    const email = `k6-${data.runId}-${__VU}@example.com`;
    const reg = http.post(`${BASE}/auth/register`, JSON.stringify({ email, password: 'k6-load-test-passphrase', displayName: 'k6', timezone: 'UTC' }), { headers: { 'Content-Type': 'application/json' } });
    check(reg, { registered: (r) => r.status === 201 });
    const body = json(reg);
    globalThis.__session = { csrf: body && body.csrfToken };
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': globalThis.__session.csrf };
    const cats = json(http.get(`${BASE}/categories`)) || [];
    const work = cats.find((c) => c.key === 'work');
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      const start = new Date(now + (i + 1) * 2 * 3600 * 1000).toISOString();
      const end = new Date(now + (i + 1) * 2 * 3600 * 1000 + 3600 * 1000).toISOString();
      http.post(`${BASE}/activities`, JSON.stringify({ title: `Block ${i}`, categoryId: work.id, plannedStart: start, plannedEnd: end }), { headers });
    }
    for (let i = 0; i < 8; i++) {
      http.post(`${BASE}/tasks`, JSON.stringify({ title: `Task ${i}`, estimatedDurationSec: 1800 + i * 300, priority: i % 2 ? 'HIGH' : 'MEDIUM' }), { headers });
    }
  }

  const day = http.get(`${BASE}/availability/day`, { tags: { name: 'availability_day' } });
  availabilityMs.add(day.timings.duration);
  check(day, { 'availability 200': (r) => r.status === 200 });

  const dash = http.get(`${BASE}/analytics/dashboard`, { tags: { name: 'dashboard' } });
  dashboardMs.add(dash.timings.duration);
  check(dash, { 'dashboard 200': (r) => r.status === 200 });

  check(http.get(`${BASE}/tasks?pageSize=20`), { 'tasks 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/time-tracking/active`), { 'timer 200': (r) => r.status === 200 });
  sleep(1);
}
