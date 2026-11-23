# P08-E2 — Production smoke and initial operating window

Status: **implemented tooling; hardened by the 2026-11-23 P08 delivery; not run
against production**. No production target, authorization, credentials or
incident contacts were supplied for this delivery, so no production smoke result
is claimed and no operating window was opened.

## Production smoke (`scripts/production/E/production-smoke.mjs`)

Read-only probes against an owner-authorized target (`carwash.smoke-target/v1`):

| Probe | PASSED only when |
| --- | --- |
| `dns <host>` | every listed public hostname resolves |
| `tls <host>` | chain verifies (system trust or the supplied private CA), hostname matches, and the certificate is valid for at least the owner-supplied `tls.minValidDays` |
| `gateway live` | HTTP 200 **and** `businessReady: true` — the current foundation gateway returns `false`, so it fails today |
| `gateway ready` | HTTP 200 and `ready: true` |
| `owner ready <owner>` | the gateway readiness reports that owner `true`; unrouted owners fail |
| `payment provider ready (<owner>)` | the payment owner (Billing) is ready behind the gateway |
| `identity session denies anonymous` | anonymous session read returns 401 |
| `private media denies anonymous` | anonymous object read returns 401/403; a redirect (e.g. to a signed URL) is a failure and is never followed |
| `alertmanager ready` | `/api/v2/status` cluster status `ready` |
| `required alert rules loaded` | every named alert rule is loaded in Prometheus |
| `dashboard <uid>` | Grafana returns HTTP 200 and the requested dashboard UID with the read token; without a resolved token it is `NOT_AUTHORIZED` (not PASSED) |

Rules: explicit `timeoutMs` (no default); an absolute deadline covers DNS,
connection, TLS, headers and body, including slow-drip responses. Timeout is
`FAILED: timeout`; response bodies are bounded; no redirects; no credentials beyond the dashboard read token; token references
resolve only from `env://NAME` and the value never appears in the report. The customer
booking safe path is listed under `pendingSeparately`: it requires an owner-approved path and
a real customer session executed by the reviewed runbook, so the smoke never claims it.

All production endpoints require HTTPS. URLs must not embed credentials, query
parameters or fragments. Anonymous Identity and Media probes use root-relative
paths on the gateway's own origin, and the gateway hostname must be included in
the TLS/DNS inventory. An unrelated service returning 401/403 cannot satisfy a
gateway privacy check.

Tests can explicitly enable `--allow-loopback-http-fixtures` for monitoring
fixtures on numeric loopback addresses. The gateway still requires HTTPS.
Reports identify this mode with `fixtureOnly: true`. A successful fixture run
returns `PASSED_FIXTURE_ONLY` and CLI exit 4, which the receipt producer records
as a failed production gate. It cannot substitute a production smoke result.

## Operating window (`scripts/production/E/operating-window.mjs`)

Input: the PASSED `ext.operating-window-policy` barrier receipt (durationMinutes,
maxSampleGapMinutes, thresholds `{bound, limit, onBreach}`) and
`carwash.operating-window-observations/v1` (openedAt, distinct primary/backup contacts,
samples, incidents). Decisions:

- `ROLLBACK` / `STOP` / `FORWARD_RECOVERY` — a threshold with that action was breached (rollback > stop > forward recovery);
- `STOP` — a sample gap longer than the policy or a missing/non-finite metric: acceptance cannot be observed;
- `OBSERVING` — window open, or elapsed with unresolved/unacknowledged incidents;
- `VERIFIED_IN_OPERATION` — the full window was observed inside every approved threshold with no open incident.

An empty sample set cannot verify a window, even when the permitted sample gap
is longer than the window. Missing observations contribute a `STOP` decision;
they cannot be hidden by a lower-priority forward-recovery breach. Incident
acknowledgment must name a person; resolution must contain a valid UTC timestamp
that is not in the future. Incident IDs must be distinct. Contact identities
must be valid strings for two distinct people. Breach actions must be explicit
supported values.

Exit codes: 0 verified, 3 observing, 2 rollback/stop/forward-recovery, 1 unusable input.
The tool decides; the reviewed runbook executes the rollback or stop.

## Tests (run under `pnpm test:production:e`)

- `tests/production/E/production-smoke.test.mjs` — real TLS listener with an
  openssl-issued CA/leaf for `localhost`, real DNS lookup, real HTTP fixtures speaking the
  Prometheus/Alertmanager/Grafana read APIs. **Local fixtures, not production evidence.**
- `tests/production/E/operating-window.test.mjs` — pure decision regressions and a real CLI process, including malformed incidents, empty observations and competing severities.

## Security / privacy / rollback

No secrets in target files or reports; anonymous probes only, apart from the dashboard read
token. Additive tooling only (no runtime, migration, contract or event change); revert to
remove.
