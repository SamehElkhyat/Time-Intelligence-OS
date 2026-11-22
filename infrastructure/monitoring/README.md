# Monitoring

| Signal | How |
|---|---|
| **Liveness / readiness** | `GET /api/health/live`, `GET /api/health/ready` (database required; Redis optional; BullMQ counters: waiting / active / delayed / failed / completed). Docker `HEALTHCHECK`s use them. |
| **Logs** | Structured JSON (pino) with a request id (`x-request-id` is accepted from the caller or generated, and echoed on every response). Credentials (`Cookie`, `Authorization`, `X-CSRF-Token`, `Set-Cookie`) are redacted. `LOG_LEVEL` controls verbosity. |
| **Traces** | OpenTelemetry. Set `OTEL_EXPORTER_OTLP_ENDPOINT`; HTTP, Express and Nest-core instrumentation are enabled. Verified to deliver spans (service `timeflow-backend`, per-controller and per-middleware spans) to an OTLP receiver. `otel-collector.yaml` is a ready-to-run local collector. |
| **Jobs** | `GET /api/health/ready` → `queue`. Failed jobs are retained 7 days in Redis (BullMQ `removeOnFail`). |
| **Performance** | `backend/scripts/bench.mjs` (latency percentiles per endpoint) and `backend/tests/load/availability.k6.js`. |

Not included: metrics scraping (Prometheus) and dashboards/alerts — add an exporter or the collector's `prometheus` exporter when a metrics backend is chosen.
