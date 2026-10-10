# P05-C1 — Workforce: technician operational profile, availability, equipment

Status: **IMPLEMENTED; INTEGRATION_PENDING** (parent P05-C). Routes are
provider-implemented and requested from Lane E (`contract-requests/CR-P05-C1-workforce-profile.md`).
Base: `main@66aa7528500a06f65a4b73305506feee7c3fc3b3`. Owner: `services/workforce`
(database `cw_workforce`). No dependency, shared package, lockfile, CI or gateway change.

## 1. What was added

| Capability | Owner / actor | Model |
| --- | --- | --- |
| Service area | operations (`operations.dispatch`) | `operator_service_area` (revision) + `operator_service_zone`; home zone implicit; <= 20 zones total |
| Weekly availability | technician (`work.execute:assigned`, self) | `operator_weekly_schedule` (IANA zone, revision) + `operator_weekly_window` (weekday, minutes, zone; EXCLUDE no overlap per weekday) |
| Apply a week | technician | creates ordinary `work_shift` rows, key `wk:<startDate>:r<revision>:<weekday>:<startMinute>` |
| Availability exceptions | technician (self) or operations | `availability_exception` (EXCLUDE: ACTIVE periods never overlap; <= 31 days; idempotency key + fingerprint) |
| Equipment / service vehicle readiness | operations register + set REQUIRED; technician or operations report status | `operator_equipment` (one per kind; CHECK `issue IS NULL` iff READY); `operator.equipment_blocked` mirror |
| Profile read model | technician (self) / operations | `GET /me/profile`, `GET /operators/:id/profile` |

Fleet ownership: the service catalog has no fleet service, so technician operational
equipment and the service vehicle stay in Workforce (approved Workforce model), as
readiness facts only — no plate, VIN, serial number, location or free text. No
cross-owner table was invented.

## 2. Rules

- **Capacity** (published `workforce.v1`, shape unchanged): shifts minus ACTIVE
  exceptions, in the same snapshot; `eligibleOperators` excludes an operator whose
  exception covers the instant. Dispatch already rejects offers without a covering
  shift (`NO_COVERING_SHIFT`), so a new offer can never land inside an exception.
- **Eligibility**: new input `equipmentBlocked` (any REQUIRED item UNAVAILABLE). When it
  moves, `version` and `eligibility_revision` move and `workforce.eligibility-changed.v1`
  is written to the outbox in the same transaction (lock order: operator → equipment).
  Dispatch's existing consumer withdraws open offers and not-started tasks on
  `INELIGIBLE` (P03-C4) — no Dispatch change was needed.
- **Revoked technician**: a suspended or inactive operator cannot set `AVAILABLE`,
  create a shift or apply a schedule (`409 OPERATOR_NOT_ACTIVE`); going on break,
  reading the profile and reporting equipment remain allowed. Identity session
  revocation is enforced per request by the Identity session check (401).
- **Service area**: a new shift, weekly window or applied occurrence must name a zone
  inside the area. **Security tightening**: `PATCH /me` no longer lets the technician
  move the home zone (`403`), because the home zone anchors the operations-owned area.
- **Concurrency**: every aggregate is revision-fenced (`409 REVISION_CONFLICT`);
  first writes race on the primary key; exceptions on the exclusion constraint;
  schedule application serialises on the schedule row and replays by key, so two
  concurrent applies create each shift once.
- **Time**: windows are local wall-clock in one IANA zone (default `Asia/Damascus`),
  converted with `Intl` (no dependency); windows never cross midnight; a local time
  skipped by a DST transition resolves to the instant after the gap.
- **Audit**: every mutation writes `audit_entry` in its transaction (no free text).

## 3. Migration

`20261011120000_p05c1_profile_schedule_equipment` — expand-only: one column with a
default (`operator.equipment_blocked = false`) and five new tables. Existing rows keep
their meaning; rollback of the application is compatible with the expanded schema
(old code ignores the new tables and column). No destructive step. Applied by
`cw_workforce_migrate`; runtime role has DML only.

## 4. Known limitations (not hidden)

- No push event for capacity changes (`workforce.capacity-changed.v1` not requested
  as a published contract yet); consumers see exceptions on their next capacity read.
- Work already assigned inside a new exception is not moved automatically.
- Zone names are Geo's; Workforce stores zone ids only.
- `/health/ready` stays 503 (`BUSINESS_READY = false`).

## 5. Evidence

Commands: `node scripts/production/C/stack.mjs up && node scripts/production/C/verify.mjs workforce`.
Results are recorded in the PR with exact head/tree. Families: unit (domain + application
over the in-memory ports), postgres (`profile.pg.spec`, `profile-http.pg.spec` plus the
existing suites, runtime role, real PostgreSQL 16), lane (`workforce-contract.test.mjs`
against the published parsers, outbox order).
Substitutes: Identity is an HTTP double of `/internal/v1/identity/session` in HTTP suites.
