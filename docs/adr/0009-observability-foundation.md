# ADR 0009: owner-local observability and durable trace context

Status: implemented; acceptance is conditional on final-source CI evidence.
Scope: F008. Baseline: `15544a92a270b2abafcf57e58191e90b7d8eba42`.

## Decision

`@carwash/observability` owns only technical logging, W3C context, tracing,
Prometheus instruments and framework-neutral HTTP middleware. Each process owns
its tracer provider and registry. There is no business persistence in this package,
no cross-service database access, and no global OpenTelemetry provider mutation.
The service-kit logging entry point remains a compatibility facade.

All ten existing Nest foundation services, the independently built gateway, and
three existing message workers adopt this package. The nine ownership-only service
skeletons and three not-yet-implemented browser apps are not invented runtimes.
Browser code must never import the Node package; later app implementation can
forward the documented request/correlation headers through its API client.

Pino writes structured records synchronously to the process output, permitting
bounded shutdown without a background logging worker. This trades throughput for
a smaller reliable foundation; production load/backpressure capacity is NOT proven.
Destination exceptions, hostile getters/serialization, exporter failures and metric
observation failures cannot replace business results. Logs accept static event names,
redact nested sensitive fields, never log raw bodies by default, and reserve source
and trace identifiers against caller overrides. Exception text and stack traces are
not logged. This does not authorize placing arbitrary personal data in innocent keys.

An AsyncLocalStorage-backed explicit OpenTelemetry context carries request ID,
correlation ID and W3C traceparent. Inbound UUIDs/traceparent are validated;
baggage and tracestate are deliberately discarded. Upstream sampling decisions
are preserved. HTTP, publisher and consumer spans contain technical operation
names, never URLs, raw request bodies or database statements.

Catalog persists the optional `trace_parent` beside its outbox row using one
additive owner-local migration. The business event JSON is byte-shape compatible:
no transport metadata is appended to a strict event contract. The relay creates a
producer span under this persisted parent, even after the request and producer
process have ended; RabbitMQ headers carry the new producer context. Consumers
continue this context while retaining commit-before-ack and inbox idempotency.
Old outbox rows with null context remain publishable. Metrics do not modify retry,
lease, fencing, compensation or ownership semantics.

The service template exposes actual owner-local pg Pool counts through the
existing Prisma adapter and disposes that pool through the adapter. Regenerated
F003 service-template hashes describe changed technical scaffolding, NOT golden
UI snapshots. Additional assertions verify the pool's ownership and disposal.

## Security and health

`/metrics` is disabled unless `OBSERVABILITY_METRICS_TOKEN` is 32–256 characters.
Its Bearer token comparison is constant-time; unauthenticated requests return 404.
Only GET is allowed; responses are no-store. A failed collector returns 503 without
breaking health/business requests. Use a private network and external TLS; the
public gateway must not expose this endpoint through its edge proxy.

Metric label values are finite: method, health/application route class, status
class, dependency kind, worker kind and event outcome. Service/environment come
from deployment configuration. No booking/user/document/email/token identifiers
are metric labels. Readiness is observed, not manufactured: foundation shells
still return 503, and the gauge starts at -1 until a readiness response is observed.
Pool/dependency gauges are absent until their real source is observed; absence is
not healthy. Worker registries can be consumed by an owner-local metrics endpoint
when a worker deployment provides one; this sprint does not expose a new unauthenticated
worker listener or fabricate a scrape integration for a non-HTTP process.

OTLP HTTP export is opt-in. Endpoints must be HTTPS (loopback HTTP allowed for
local tests), without credentials/query/fragment. Export has a bounded queue,
1-second export timeout and a bounded shutdown flush. Flush timeout/failure yields
a safe structured warning, never a secret-bearing exporter error. Forced process
termination can lose telemetry and is not claimed to flush.

## Validation and rollback

The focused suite exercises redaction, failing/hostile sinks, context isolation,
metric cardinality/hot reload, real HTTP authorization, all runtime processes and
graceful shutdown. The real integration suite proves HTTP -> PostgreSQL outbox ->
separate relay -> RabbitMQ -> consumer, including committed effects and flushed
OTLP spans. Existing foundation, Identity, gateway and image gates must remain green.
No UI reference, migration history or golden design byte is rewritten.

Rollback application code without dropping the nullable outbox column. Disabling
OTLP export stops external trace delivery; omitting the metrics token disables
scraping. Do not revert an applied migration or reset a production database.
