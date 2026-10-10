# P05-D4: Reporting reports and exports

Parent task: P05-D, "Implement Support, Reviews, Notifications, Reports and
Settings end-to-end" (Lane D). This child is the Reporting provider of the
admin "التقارير والتحليلات" screen ("الإيرادات، الاستخدام، العمليات والجودة").

This child is **not production-ready, not deployed and not integrated**.
`BUSINESS_READY` stays `false`: no Gateway route, no `reporting.read`
permission and no broker read grant for Billing's exchange exist yet
(CR-D-P05-D4-01..03), and no Billing producer runs on the accepted topology.

## Scope

| Path | Change |
| --- | --- |
| `services/reporting/src/domain/reports.ts` | Pure rules: report periods and buckets (closed time-zone set, alignment, bounds), exact growth and division, stream freshness, RFC 4180 CSV with formula-injection guard, idempotency-key format |
| `services/reporting/src/domain/revenue.ts` | Pure rules: Billing revenue facts, validation, version-monotonic folding of obligations and refunds |
| `services/reporting/src/domain/operations.ts` | Adds integrity code `REFUND_IDENTITY_CONFLICT` |
| `services/reporting/src/application/reports.service.ts` | `parseRevenueEvent` (registered Billing contract parsers), `RevenueProjector`, `ReportQueries` (revenue, operations), CSV renderers, `ReportExports` (idempotent bounded export) |
| `services/reporting/src/application/access.ts` | `REPORT_READS` / `requireReport` |
| `services/reporting/src/ports/reports.ports.ts` | Writer, reader and export-store ports |
| `services/reporting/src/infrastructure/persistence/prisma-reports.store.ts` | Transaction-bound revenue writer, SQL aggregates, export store |
| `services/reporting/src/infrastructure/messaging/revenue-topology.ts` | Subscriber-owned `reporting.revenue` queue, DLX and DLQ bound to `washgo.billing.events` |
| `services/reporting/src/inbox/projection-worker.ts` | Shared worker loop, extracted unchanged from the operations runner |
| `services/reporting/src/inbox/operations-consumer.runner.ts` | Now a thin entry point on the shared loop (same queue, log events and semantics) |
| `services/reporting/src/inbox/revenue-consumer.runner.ts` | New worker for the revenue projection |
| `services/reporting/src/transport/http/reports.controller.ts` | `GET revenue`, `GET operations`, `POST exports` |
| `services/reporting/src/app.module.ts` | Wiring and the `REPORTING_EXPORTS_PER_MINUTE` budget (default 10) |
| `services/reporting/prisma/migrations/20261011090000_p05d_reports_and_exports` | Additive migration |
| `services/reporting/test/reports.domain.spec.ts` | Unit tests |
| `tests/production/D/reporting-reports.test.mjs` | Real PostgreSQL, RabbitMQ and Identity suites R1-R5, B1-B2, H1-H4 |

No shared package, lockfile, Gateway, CI, infra or another service is changed.

## Sources: only Reporting's own projections

Every figure is computed by SQL over Reporting's own tables. There is no
cross-service SQL and no call to an owner at read time.

| Report figure | Projection | Fed by |
| --- | --- | --- |
| Revenue (settled, pending, refunds, voided, series) | `rpt_obligation`, `rpt_refund` (new) | `billing.obligation-created.v1`, `billing.obligation-status-changed.v1`, `billing.refund-status-changed.v1` (registered, envelope v2, `washgo.billing.events`) through the inbox |
| Scheduled service duration, assigned jobs | `ops_assignment` (P03-D1) | Dispatch facts (no registered Dispatch event yet, CR-D-P03-01) |
| Booked time, committed holds | `ops_slot_hold` (P02-D1) | `scheduling.hold-changed.v1` |
| Eligible resources | `ops_resource_eligibility` (P02-D1) | `workforce.eligibility-changed.v1` |
| Freshness | `ops_freshness` | every applied delivery |

Reporting did **not** consume any Billing event before this child (the P03-D1
cash KPI is fed only by domain builders). This child adds consumption of three
registered Billing events. `billing.cash-collected.v1`,
`billing.cash-collection-reversed.v1` and `billing.custody-handover-changed.v1`
are deliberately not consumed: every settlement change (including a reversal)
is already published as an obligation status change, and custody is not
revenue. The P03-D1 `ops_obligation` table is unchanged and still not fed by a
real stream (its vocabulary has no `CASH_COLLECTED`); widening it is left to a
later child.

### Revenue rules (pure domain, unit-tested)

- **Settled** = obligations whose current Billing status is `PAID` (verified
  payment) or `CASH_COLLECTED` (authorised cash receipt), attributed to the
  occurrence time of the status event that settled them (`settled_at`), summed
  from Billing's `verified` amount. The two are reported separately.
  `CASH_COLLECTED` never means the company holds the cash.
- **Pending** = obligations created in the period (`created_at`, from the
  creation event) whose current status is `UNPAID`, `AWAITING_CASH`,
  `AWAITING_PAYMENT`, `UNDER_REVIEW` or `OUTCOME_UNKNOWN`, summed from the
  latest `outstanding` (or the created amount when no status change was seen).
  Pending is never added to settled and never called earned.
- **Voided** obligations are counted, never summed.
- **Refunds**: `SUCCEEDED` in the period (by the success occurrence) are summed;
  `REQUESTED`/`OUTCOME_UNKNOWN` first observed in the period are open and never
  treated as money returned. `netSettledMinor = settled - refunds succeeded`
  (may be negative, signed decimal string).
- **Growth** = (settled − previous settled) / previous settled, where the
  previous period is the equal-length period immediately before `from`. Ratio
  with 6 decimals, percent with 2, rounded half away from zero, computed with
  BigInt only. A zero base gives `ratio: null, percent: null, reason:
  "ZERO_BASE"`. Growth is on settled gross (not net of refunds).
- **Restated, not period-locked.** Reports reflect what Reporting knows now: a
  later reversal (newer status) removes an obligation from settled; a stale
  delivery cannot re-settle it (R2).
- **Monotonic by Billing's aggregate version.** Newer applies, older is STALE,
  the same version with different content is `FACT_VERSION_CONFLICT`. A stale
  creation event still fills the creation amount/time (a true past fact). One
  obligation keeps one currency and scale (`OBLIGATION_CURRENCY_CONFLICT`); a
  refund keeps its obligation, currency and scale (`REFUND_IDENTITY_CONFLICT`).
- **Exact money only**: integer minor units (`BIGINT`), summed by PostgreSQL as
  `NUMERIC`, returned as decimal strings with the currency's scale (SYP 2,
  USD 2, as in the Billing contract).

### Market and currency

`currency` is a required, explicit parameter (`SYP` | `USD`); a report never
mixes currencies. **Market cannot be filtered**: no Billing event carries a
market. The response says `market: {filtered: false, reason:
"NO_MARKET_DIMENSION_IN_SOURCE"}` instead of assuming one (CR-D-P05-D4-04).

### Execution time and capacity utilisation

- **Actual execution time is UNAVAILABLE** (`executionDuration.available:
  false, reason: "NO_FIELD_PROGRESS_SOURCE"`). No owner publishes field
  progress (CR-D-P03-03). The approved card "متوسط وقت التنفيذ 47 دقيقة"
  therefore cannot be filled with a measured value.
- `scheduledServiceDuration` reports, under its own name and basis
  (`ASSIGNED_JOB_WINDOW`), the planned job window of assignments currently
  `ASSIGNED` whose start is in the period: count, exact average (ms and
  minutes, half away from zero), nearest-rank p50/p90. It is a plan, never
  measured execution; D6 must not label it "execution time".
- **Capacity utilisation is UNAVAILABLE** (`reason:
  "NO_CAPACITY_SUPPLY_SOURCE"`). Utilisation needs supply (shift hours per
  capacity resource), which neither Workforce nor Scheduling publishes. The
  response gives the numerator facts only (`committedHolds`, `bookedMinutes`,
  current `eligibleResources`) and `ratio: null` (CR-D-P05-D4-05).
- "الجودة" (quality) has no source (Reviews publishes nothing); not reported.

### Freshness (every response and every export)

Per source stream: `source`, `stream` (producer exchange), `state`,
`lastEventOccurredAt` (newest applied source occurrence),
`lastAppliedAt` (Reporting's apply clock), `appliedCount`.
`state` is `NEVER_RECEIVED` (no event ever applied), `FRESH` (an event was
applied within **900 seconds** of `generatedAt`, inclusive) or `STALE`
(otherwise). `freshnessPolicy: {staleAfterSeconds: 900, basis:
"LAST_APPLIED_AT"}`. `incompleteSources` lists every non-FRESH source the
report depends on, so a quiet or broken pipeline makes the figure visibly
partial. STALE cannot distinguish a quiet producer from a broken pipeline
without producer heartbeats. `generatedAt` comes from the injected clock.

### Periods (UTC)

`from`, `to`: canonical UTC instants (`YYYY-MM-DDTHH:MM:SS[.mmm]Z`), `to`
exclusive. `timezone` ∈ {`UTC`, `Asia/Damascus`} (closed set; IANA rules via
Intl/PostgreSQL). `granularity` ∈ {`day`, `hour`}. Both bounds must lie on a
bucket boundary of the zone (local midnight for `day`, whole hour for `hour`).
At most 92 day buckets or 168 hour buckets. Hour buckets are UTC hours (equal
to local hours in both allowed zones, unambiguous across DST). Errors (422):
`INVALID_FROM`, `INVALID_TO`, `INVALID_PERIOD`, `PERIOD_NOT_ALIGNED`,
`PERIOD_TOO_LARGE`, `INVALID_TIMEZONE`, `INVALID_GRANULARITY`,
`INVALID_CURRENCY`, `INVALID_ZONE`.

## Read and export API (served by Reporting, base `/internal/v1/reporting/reports`)

| Route | Permission | Budget |
| --- | --- | --- |
| `GET revenue?from&to&timezone&granularity&currency` | `billing.read` | reads (`REPORTING_READS_PER_MINUTE`, default 120) |
| `GET operations?from&to&timezone&granularity[&zoneId]` | `operations.dispatch` | reads |
| `POST exports` (header `Idempotency-Key`) | the exported report's permission | exports (`REPORTING_EXPORTS_PER_MINUTE`, default 10) |

Authentication: bearer → Identity `GET /internal/v1/identity/session` (fail
closed: 401 unknown/revoked, 503 Identity unavailable or unconfigured), the
Gateway's `x-auth-subject` must match. Deny by default: 403 without the
permission. `super-admin` holds every permission. Per-subject fixed-window
budgets → 429. Access audit logs carry subject, report, action, decision and
correlation id, never figures.

### Authorization matrix (Identity roles today)

| Role | revenue | operations | export revenue | export operations |
| --- | --- | --- | --- | --- |
| finance (`billing.read`) | 200 | 403 | 201/200 | 403 |
| operations (`operations.dispatch`) | 403 | 200 | 403 | 201/200 |
| support, reviewer, technician, customer | 403 | 403 | 403 | 403 |
| super-admin | 200 | 200 | 201/200 | 201/200 |

Decision D-P05-D4-01: existing permissions are used because they match the
desks (revenue is a finance read; the operational report is an operations
read). `reporting.read` remains requested (CR-D-P02-02 / CR-D-P01-01); if Lane E
grants it, only `REPORT_READS` changes.

### `GET revenue` response (200)

```json
{
  "report": "revenue",
  "derived": true,
  "generatedAt": "2026-10-11T12:00:00.000Z",
  "authority": [{ "owner": "billing", "reads": "obligations, verification, settlement, custody, refunds and ledger" }],
  "period": { "from": "…Z", "to": "…Z", "timezone": "UTC", "granularity": "day" },
  "sources": [{ "source": "billing", "stream": "washgo.billing.events", "state": "FRESH",
                "lastEventOccurredAt": "…Z", "lastAppliedAt": "…Z", "appliedCount": "42" }],
  "freshnessPolicy": { "staleAfterSeconds": 900, "basis": "LAST_APPLIED_AT" },
  "incompleteSources": [],
  "previousPeriod": { "from": "…Z", "to": "…Z" },
  "currency": "SYP",
  "scale": 2,
  "market": { "filtered": false, "reason": "NO_MARKET_DIMENSION_IN_SOURCE" },
  "settled": { "totalMinor": "400000", "verifiedPaymentMinor": "250000", "cashCollectedMinor": "150000",
               "obligationCount": 2, "amountUnknownCount": 0 },
  "previousSettled": { "totalMinor": "200000", "obligationCount": 1 },
  "growth": { "basis": "SETTLED_TOTAL", "ratio": "1.000000", "percent": "100.00", "reason": null },
  "pending": { "totalMinor": "100000", "obligationCount": 2,
               "byStatus": [{ "status": "UNPAID", "count": 1, "amountMinor": "70000" }, "… one entry per pending status"] },
  "refunds": { "succeededMinor": "50000", "succeededCount": 1, "openMinor": "0", "openCount": 0 },
  "netSettledMinor": "350000",
  "voidedCount": 1,
  "series": [{ "bucketStart": "…Z", "settledMinor": "0", "pendingCreatedMinor": "0", "refundedMinor": "0" }]
}
```

`growth` with a zero base: `{"basis": "SETTLED_TOTAL", "ratio": null, "percent": null, "reason": "ZERO_BASE"}`.
`byStatus` always lists the five pending statuses in the order UNPAID,
AWAITING_CASH, AWAITING_PAYMENT, UNDER_REVIEW, OUTCOME_UNKNOWN. `series` has one
entry per bucket, zeros included. Amounts are decimal strings of minor units;
divide by `10^scale` only for display.

### `GET operations` response (200)

```json
{
  "report": "operations",
  "derived": true,
  "generatedAt": "…Z",
  "authority": [{ "owner": "scheduling", "reads": "…" }, { "owner": "dispatch", "reads": "…" }, { "owner": "workforce", "reads": "…" }],
  "period": { "from": "…Z", "to": "…Z", "timezone": "UTC", "granularity": "hour" },
  "sources": [{ "source": "scheduling", "…": "…" }, { "source": "dispatch", "…": "…" }, { "source": "workforce", "…": "…" }],
  "freshnessPolicy": { "staleAfterSeconds": 900, "basis": "LAST_APPLIED_AT" },
  "incompleteSources": ["dispatch"],
  "zoneId": null,
  "executionDuration": { "available": false, "averageMs": null, "reason": "NO_FIELD_PROGRESS_SOURCE" },
  "scheduledServiceDuration": { "basis": "ASSIGNED_JOB_WINDOW", "count": 2, "averageMs": "2820000",
                                "averageMinutes": "47.00", "p50Ms": 2700000, "p90Ms": 2940000, "reason": null },
  "capacityUtilization": { "available": false, "ratio": null, "reason": "NO_CAPACITY_SUPPLY_SOURCE",
                           "committedHolds": 2, "bookedMinutes": "94.00", "eligibleResources": 5 },
  "series": [{ "bucketStart": "…Z", "committedHolds": 1, "bookedMinutes": "45.00", "assignedJobs": 1 }]
}
```

With no assigned job: `scheduledServiceDuration` has `count: 0`, `averageMs:
null`, `averageMinutes: null`, `p50Ms: null`, `p90Ms: null`, `reason: "NO_DATA"`.

### `POST exports`

Request (`Content-Type: application/json`, `Idempotency-Key:
^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$`), closed keys:

```json
{ "report": "revenue", "from": "…Z", "to": "…Z", "timezone": "UTC", "granularity": "day", "currency": "SYP" }
{ "report": "operations", "from": "…Z", "to": "…Z", "timezone": "Asia/Damascus", "granularity": "day", "zoneId": "<uuid, optional>" }
```

Order of checks: authenticate (401/503) → export budget (429) → report kind
(422 `INVALID_REPORT`) → the report's permission (403) → key and parameters
(422 `IDEMPOTENCY_KEY_INVALID`, `INVALID_EXPORT_REQUEST`, period errors) →
idempotency. A denied caller never reaches the idempotency store and leaves no
audit row (H2).

Response: `201` (new) or `200` (replay), body `text/csv; charset=utf-8`,
headers `Content-Disposition: attachment; filename="washgo-<report>-<date>-<exportId>.csv"`,
`Cache-Control: no-store`, `X-Export-Id`, `X-Export-Row-Count`,
`X-Export-Generated-At`, `Idempotency-Replayed: true|false`. Errors use the
service JSON error envelope: `409 IDEMPOTENCY_CONFLICT` (same key, different
report/parameters), `410 EXPORT_EXPIRED` (replay after the 24 h content window;
the file is never silently regenerated).

CSV format:

- UTF-8 with BOM (Arabic-safe in spreadsheet software), CRLF line ends, every
  record has the same field count (RFC 4180).
- A metadata block of key/value records: `report`, `generatedAt`, `derived`,
  `periodFrom`, `periodTo`, `timezone`, `granularity`,
  `freshnessStaleAfterSeconds`, `incompleteSources`, and per source
  `source.<s>.stream|state|lastEventOccurredAt|lastAppliedAt|appliedCount`,
  then the report summary (revenue: currency, scale, amount unit, settled
  totals, previous total, growth ratio/percent/unavailable reason, pending,
  refunds, net; operations: zone, execution/capacity availability and reasons,
  scheduled duration, booked minutes).
- One all-empty separator record, the column header and one row per bucket
  (revenue: `bucketStart,settledMinor,pendingCreatedMinor,refundedMinor`;
  operations: `bucketStart,committedHolds,bookedMinutes,assignedJobs`).
- Formula injection: any cell starting with `=`, `+`, `-`, `@`, TAB or CR is
  prefixed with `'`, except a cell that is exactly a signed decimal number
  (for example a negative net amount `-150`), which a spreadsheet reads as a
  number and never as a formula (`-2+3` is still prefixed).
- Bound: at most 1000 rows (`EXPORT_TOO_LARGE`); the period bounds keep real
  exports at most 168 rows. Content at most 1 MiB (database CHECK).

**PDF is not implemented.** The approved button says "تصدير PDF"; this child
delivers CSV only. No PDF library exists in the repository and adding a
dependency is Lane E's decision. D6 must label the action honestly (for
example "تصدير CSV") or keep the PDF button disabled with a pending note until
the owner decides (CR-D-P05-D4-06). This is a visible difference from the
approved screen and needs an explicit owner decision; it is not hidden.

### Idempotency and audit

- `report_export_audit` (append-only by trigger): `export_id`, `subject`,
  `idempotency_key`, `report`, `parameters_hash` (SHA-256 of the canonical
  validated parameters), `row_count`, `generated_at`, `content_sha256`,
  `recorded_at`. No report data, no figures.
- `UNIQUE (subject, idempotency_key)`: the key is scoped to the caller. The
  insert is `ON CONFLICT DO NOTHING` in one transaction with the content row,
  so concurrent requests with one key produce exactly one audit row; losers
  wait on the unique index and then return the winner's bytes (H3: 10 HTTP
  requests, 16 store-level requests).
- `report_export_content` keeps the CSV for replay for 24 h; expired rows are
  purged in bounded batches (100) inside each new export transaction. The
  audit row is kept.

## Migration `20261011090000_p05d_reports_and_exports`

Additive (expand only): four tables, seven indexes (one unique), one foreign
key, CHECK constraints (closed status vocabularies, positive versions,
currency code and scale, amount ranges inside BIGINT, settled time exactly
when settled, nothing outstanding when closed, succeeded time exactly when
SUCCEEDED, refund amount positive, export key format, report kind, row-count
bound, hex hashes, content size), and the `report_export_audit_immutable`
trigger reusing `reporting_reject_mutation` (P01-D). No existing object is
altered. The runtime role gets DML through provisioning, as for every Lane D
table; immutability does not depend on grants.

**Rollback:** redeploy the previous image; it never reads the new tables. The
revenue worker is a new process; stopping it stops consumption (its queue
keeps messages until the delivery limit/DLQ). Dropping the tables is a
separate reviewed contract step and is not needed to roll back code.

## Events

Consumed (envelope v2, producer `billing`, exchange `washgo.billing.events`,
queue `reporting.revenue`, quorum, delivery limit 3, DLX
`reporting.revenue.dlx`, DLQ `reporting.revenue.dlq`):
`billing.obligation-created.v1`, `billing.obligation-status-changed.v1`,
`billing.refund-status-changed.v1`. Parsed only with the registered
`@carwash/event-contracts` parsers; any other shape is dead-lettered. Inbox
primary key = producer `eventId`; same id with different bytes = `CONFLICT`
(never applied). Emitted: none.

## Evidence

RESULTS_PLACEHOLDER

## Real vs stubbed

| Dependency | Real? |
| --- | --- |
| PostgreSQL 16 (runtime identity, migrations by the migration identity, privilege hardening, replay drift check) | real |
| RabbitMQ 4 (B1/B2: ACL refusal, real worker process, duplicates, crash before ACK, DLQ) | real; the Billing read grant is applied by the test as the infrastructure administrator and restored (CR-D-P05-D4-01) |
| Identity (H1-H4: allow **and** deny paths; operations, finance, support and customer accounts; roles granted through Identity's own endpoint) | real; no stub Identity |
| Billing producer | **not real**: events are built with the registered contract shapes and applied through the real inbox store (R) or published by the infrastructure identity (B) |
| Dispatch producer | **not real**: no registered Dispatch event; assignment facts use the P03-D1 domain builder through the projector in one transaction (R4) |

## Contract requests (Lane E unless noted)

- **CR-D-P05-D4-01 (broker):** grant `cw_reporting_app` read on
  `washgo.billing.events` (read pattern
  `^(reporting\.|catalog\.events$|washgo\.billing\.events$)` plus the P02
  request) so the `reporting.revenue` queue can bind; run
  `services/reporting/dist/inbox/revenue-consumer.runner.js` as its own
  workload (`DATABASE_URL`, `BROKER_URL`).
- **CR-D-P05-D4-02 (Gateway, staff routes):**
  - `GET /api/admin/v1/reports/revenue` → `GET /internal/v1/reporting/reports/revenue` (same query), permission `billing.read`;
  - `GET /api/admin/v1/reports/operations` → `GET /internal/v1/reporting/reports/operations`, permission `operations.dispatch`;
  - `POST /api/admin/v1/reports/exports` → `POST /internal/v1/reporting/reports/exports`, forwarding `Idempotency-Key` and the JSON body, permission decided upstream by Reporting per `report` (`billing.read` or `operations.dispatch`); the Gateway must pass `text/csv` bodies, `Content-Disposition`, `X-Export-*` and `Idempotency-Replayed` through unchanged and must not buffer beyond 1 MiB.
- **CR-D-P05-D4-03 (Identity):** `reporting.read` (CR-D-P02-02 / CR-D-P01-01) if the owner wants one report permission; D-P05-D4-01 maps reports to existing permissions until then.
- **CR-D-P05-D4-04 (Billing owner):** a `marketId` on obligation events, so revenue can be filtered by market.
- **CR-D-P05-D4-05 (Workforce/Scheduling owners):** a published capacity-supply fact (shift/availability minutes per capacity resource and zone), so utilisation can be computed instead of reported UNAVAILABLE.
- **CR-D-P05-D4-06 (owner decision):** PDF export. Either approve CSV as the export format for the "تصدير PDF" button (visible label change), or approve a PDF renderer dependency (Lane E dependency decision).
- Still open from earlier children: CR-D-P03-01 (Dispatch events), CR-D-P03-03 (field progress for execution time).

## Security and privacy

- Rows hold opaque IDs, statuses, exact amounts and times only: no customer,
  phone, address, plate, provider reference or receipt.
- Revenue is finance-only; operations staff cannot read or export it, finance
  staff cannot read or export the operations report.
- Export audit rows hold no figures; the replayable CSV is kept 24 h and then
  purged. Exports are bounded (rows, bytes, per-subject budget).
- Logs carry subject, decision, report kind and correlation id; worker logs
  carry event ids and codes only.

## Not proven here (blockers)

- No Gateway route, permission or broker grant (CR-D-P05-D4-01..03); no Billing
  or Dispatch producer on the accepted topology.
- Execution time, capacity utilisation, market filter and quality are not
  derivable from published facts (CR-D-P03-03, CR-D-P05-D4-04, -05).
- PDF export pending owner decision (CR-D-P05-D4-06).
- No HA broker, no production database, no load test beyond the bounded
  concurrency cases.

## Next consumer

P05-D6 (admin-web) calls these routes through a candidate Gateway patch and
never imports this service. It must show `generatedAt`, each source's `state`
and `incompleteSources`, label settled and pending separately, show "غير
متاح" with the reason for execution time and capacity utilisation, and label
the export as CSV (or keep PDF disabled) until CR-D-P05-D4-06 is decided.
