# P08-E2 — Production smoke and initial operating window

Status: **implemented tooling; not run against production**. No production target,
authorization, credentials or incident contacts exist, so there is no production smoke
result and no operating window was opened. Parent P08-E stays `INTEGRATION_PENDING`.

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
| `dashboard <uid>` | Grafana returns the dashboard with the read token; without a resolved token it is `NOT_AUTHORIZED` (not PASSED) |

Rules: explicit `timeoutMs` (no default); timeout is `FAILED: timeout`; response bodies are
bounded; no redirects; no credentials beyond the dashboard read token; token references
resolve only from `env://NAME` and the value never appears in the report. The customer
booking safe path is listed under `pendingSeparately`: it requires an owner-approved path and
a real customer session executed by the reviewed runbook, so the smoke never claims it.

## Operating window (`scripts/production/E/operating-window.mjs`)

Input: the PASSED `ext.operating-window-policy` barrier receipt (durationMinutes,
maxSampleGapMinutes, thresholds `{bound, limit, onBreach}`) and
`carwash.operating-window-observations/v1` (openedAt, distinct primary/backup contacts,
samples, incidents). Decisions:

- `ROLLBACK` / `STOP` / `FORWARD_RECOVERY` — a threshold with that action was breached (rollback > stop > forward recovery);
- `STOP` — a sample gap longer than the policy or a missing/non-finite metric: acceptance cannot be observed;
- `OBSERVING` — window open, or elapsed with unresolved/unacknowledged incidents;
- `VERIFIED_IN_OPERATION` — the full window was observed inside every approved threshold with no open incident.

Exit codes: 0 verified, 3 observing, 2 rollback/stop/forward-recovery, 1 unusable input.
The tool decides; the reviewed runbook executes the rollback or stop.

## Tests (run under `pnpm test:production:e`)

- `tests/production/E/production-smoke.test.mjs` — 10 tests. Real TLS listener with an
  openssl-issued CA/leaf for `localhost`, real DNS lookup, real HTTP fixtures speaking the
  Prometheus/Alertmanager/Grafana read APIs. **Local fixtures, not production evidence.**
- `tests/production/E/operating-window.test.mjs` — 8 tests (pure decisions + real CLI process).

## Security / privacy / rollback

No secrets in target files or reports; anonymous probes only, apart from the dashboard read
token. Additive tooling only (no runtime, migration, contract or event change); revert to
remove.
