# W09-E deployment, migration and rollback proposal

**BLOCKED_NOT_RUN.** Consume accepted BASE_W09 and real intended infrastructure,
reviewed artifacts/configuration, owner contracts and supported prior populated
state before execution. No unreviewed code/configuration edit is allowed mid-drill.

## What actual source establishes

The service catalog is authoritative:19 owner databases; Gateway/admin own no
business data. Acceptance serially follows catalog order, then hardens privileges
(`scripts/acceptance.mjs`). That loop is a foundation implementation detail, not
an accepted business deploy order. Owner runtime uses appDsn; the separate migration
runner uses migrationDsn (`scripts/acceptance/lib/migrations.mjs`). Startup guards,
service start scripts and Docker CMD execute application code without migrate/reset.

Source inventory21 migrations:19 foundation migrations (ten20260920000000, nine
20261005060000), Identity20260926040000_identity_security and Catalog
20260927143000_f008_outbox_trace_context. Exact paths/checksums are in the source
observation. These are not the future accepted populated-product migration set.
Prisma CLI is a dev dependency; production-only runtime images do not supply an
accepted immutable migration-job artifact. Do not run an invented job from them.

Existing real migration tests cover fresh apply/status/no-op replay and committed
migration/schema consistency. Drift uses --from-migrations/--to-schema; it does
not inspect the deployed DB. Duplicate tests accept exit0/text without exact
before/after history/business equality. Privilege catalogs cover19; attempted
CREATE/ALTER/DROP/INDEX/SCHEMA/TRUNCATE/history/escalation sample Identity/Catalog/
Billing/Reporting. Full19 attempted-role coverage remains required on intended
and restored infrastructure. Root append-only guard requires an explicit --base-ref;
F009 supplies it. Additive current SQL is not proved rollback compatibility.

## Queued actual procedure and evidence

| Phase                     | Owner-reviewed action and required result                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Freeze/verify             | Accepted source/tree + published/pulled runtime and migration-job repository digests; config/secret-reference revision, exact migration/schema checksums, prior state and compatibility graph. Refuse stale inputs.         |
| Allocate                  | E-controlled intended isolated project/ports/DB roles/queues/objects/output/browser profiles, approved budgets and named operator; one heavy slot initially.                                                                |
| Prepare identities        | Verify actual current_user/TLS/role attributes and separate migration credentials. No runtime DDL/history/cross-owner rights; protected secrets absent from logs/evidence.                                                  |
| Migrate clean/prior state | Run accepted immutable owner migration jobs in approved expand/backfill/contract order, providers before dependent consumers and compatible old/new readers/workers. Check exact history/status/live drift and constraints. |
| Replay/failure            | Duplicate/concurrent jobs do not change history/checksums/business effects. Partial failure remains visible; block incompatible readers and execute accepted recovery without reset/db push/false applied status.           |
| Start/roll                | Start immutable runtime without migration and gate real dependencies/business readiness. Verify graceful drain with exit/signal/escalation and original durable operation status; liveness is separate.                     |
| Gateway/apps              | Use deployed digests/served asset hashes and approved DNS/TLS/origin/CSP/session config for real owner journeys and all-app smoke. Test credentials/revocation and direct-owner bypass.                                     |
| Freeze result             | Retain current-source output, normal owner fixes/retests, independent review and latest candidate/actual-target mandatory checks. Any source/config change invalidates affected evidence.                                   |

Provider/consumer sequencing comes from accepted owner contracts, not the ordinal
list or shell businessReady flag. Preserve independent capacity, assignment, work,
financial, custody and entitlement facts. No marker/probe or session demo can
establish these results. No source-owner DB access or private client imports by E.

## Rollback is not a data inverse

Each owner must publish a compatibility matrix for prior/current app, schema,
client/event and worker versions, with irreversible data changes, abort points,
retained pending operations and the permitted rollback or forward-recovery path.
Actually run supported old code against upgraded/restored data when rollback is
chosen. If unsafe, rehearse the documented forward repair on real partial state,
using reviewed immutable artifacts/new migration IDs and retained failure history.
Do not drop financial/audit/privacy records or replay transactions as replacements.
No implemented down/forward executor or full rehearsal exists at this source.

## Existing commands and bounded meaning

```sh
node scripts/check-migrations.mjs --base-ref b47390c8ce04b2674e9222918bcd4e03fa5aed24
pnpm acceptance:run
pnpm verify:release
pnpm acceptance:gateway
node scripts/run-integration-tests.mjs
```

Only the first ran locally:21migration source/layout/ownership/append-only guard
PASS, no DB execution. verify:release aliases disposable foundation acceptance,
not production readiness. Integration requires built artifacts and a genuine
owned CW_CONTEXT_FILE and may reset fixture schemas; never point it at accepted
historic/staging/live data. Service migrate:deploy scripts exist but require the
separately provisioned migration identity and do not create an immutable release
job by themselves. Production deployment commands remain unavailable/unapproved.
