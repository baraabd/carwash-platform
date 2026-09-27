# F008 observability runbook

## Scope and acceptance

Baseline is main `15544a92a270b2abafcf57e58191e90b7d8eba42` (merged F007).
This sprint is NOT accepted based on this document, code inspection, prior green
runs or a local database-free test. The final PR must contain successful focused
F008, F001, F006, F007 and Sprint 0.2 verification on its final source tree.
Each machine report records its exact source SHA and actual tools.

Read ADR 0009 for boundaries, privacy policy, durable context and rollback.
All commit messages, PR titles/descriptions and GitHub discussion are English.

## Configuration

- `LOG_LEVEL`: debug/info/warn/error; default info. Use static event names and
  structured technical fields. Never put a request body, cookie, OTP, credential,
  payment secret or restricted document identifier in a log call.
- `OBSERVABILITY_METRICS_TOKEN`: secret of 32–256 characters, injected by the
  deployment secret manager, never committed or placed in test evidence.
  Requests use the Authorization Bearer header, not query parameters.
  Missing/weak configuration or an incorrect token produces HTTP 404.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`: optional full OTLP HTTP trace URL ending
  in the collector's configured traces path, normally `/v1/traces`. HTTPS is
  required outside localhost. No query/fragment/embedded credentials. Collector
  deployment/network access is an operator prerequisite, not supplied credentials.
- `NODE_ENV`: development/test/staging/production; other values become unknown.

Keep metrics behind a private network and terminate TLS at the internal proxy.
Do not expose a metrics token to the customer, technician or administrator browser.
No local collector/Grafana stack is added: the package does not require one to run.
The test collector is ephemeral and receives only generated technical spans.

## Correlation and metrics

HTTP responses include `x-request-id`, `x-correlation-id`, and `traceparent`.
Trace IDs are observability correlation, never authorization or tenant identity.
Forward only these validated headers through internal HTTP clients. Baggage and
tracestate are not propagated. Publishers preserve a stored outbox traceparent
when available, and consumers preserve the validated logical event correlation ID.
Business events stay owned by their original contracts.

Metrics include `cw_http_requests_total`, `cw_http_duration_seconds`,
`cw_db_pool_connections`, `cw_worker_active`, `cw_events_total`,
`cw_event_lag_seconds`, `cw_service_ready`, `cw_dependency_up`,
`cw_dependency_duration_seconds` and prefixed process metrics.
Event outcomes count attempts/observations, not unique business events.
Pool/dependency metrics that have not been observed must not be interpreted as up.
Non-HTTP workers own an instrumented registry but no network scrape listener;
worker deployment scrape wiring remains explicit future operational work.

Example foundation-only queries (adapt alert windows to deployment measurements):

```promql
sum by (service, status_class) (rate(cw_http_requests_total[5m]))
histogram_quantile(0.95, sum by (service, le) (rate(cw_http_duration_seconds_bucket[5m])))
sum by (service, outcome) (rate(cw_events_total{outcome="retry"}[5m]))
cw_service_ready == 0
```

These are technical examples, not business dashboards or production SLOs.

## Reproduce verification

Use `.nvmrc` and the packageManager pin. Never resolve new versions during CI.

```sh
corepack enable
corepack prepare --activate
node scripts/verify-toolchain.mjs
pnpm install --frozen-lockfile
pnpm generate
pnpm build
pnpm typecheck
pnpm format:check
pnpm lint
pnpm test:observability
pnpm test:unit
pnpm test:nest
pnpm test:gateway
pnpm test:contracts
pnpm check:boundaries
pnpm check:migrations
pnpm check:design-reference
pnpm test:design-lock
pnpm acceptance:run
pnpm exec playwright install --with-deps chromium
pnpm acceptance:gateway
```

`acceptance:run` provisions and tears down isolated PostgreSQL/RabbitMQ resources;
it now includes `tests/integration/observability.test.mjs`. Never point it at
production. The gateway acceptance separately uses real Identity/PostgreSQL/Redis
and a browser. The F007 workflow also checks gateway non-root image boot,
unavailable-dependency readiness and graceful termination. Prior security gates
must pass on the new dependency resolution.

Focused process smoke tests do not claim real database availability: their DB
connection is deliberately unreachable so 503 readiness remains meaningful.
Only the real acceptance reports establish database/broker/Redis evidence.

## Known prerequisites for the next sprints

F009 follows acceptance of F008 and must add the missing aggregate and security
coverage rather than relabel existing partial CI as complete. Branch protection
was disabled at baseline; a repository policy is not enforced merely by adding a
workflow or CODEOWNERS. Any unavailable administrative permission must be reported.

F010 currently has only the approved customer HTML. The repository does not supply
approved technician/admin HTML authorities. These apps are blocked for parity,
not redesigned. F010 also depends on actual F009 acceptance. No full app port or
100% visual/business parity is claimed by this infrastructure work.
