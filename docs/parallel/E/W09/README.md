# W09-E operational rehearsal entry proposal

Parent **NOT_STARTED / ENTRY_BLOCKED**. Child **W09-E-OPERATIONS-PROPOSAL /
DRAFT_REVIEW_PENDING**. All **34** required drill families are **BLOCKED_NOT_RUN**.
This packet is source-backed E-local analysis/proposals under the task's explicit
missing-base exception. It does not deploy, restore, accept an operating team,
freeze an accepted release candidate or publish BASE_W10.

Analysis source/current main: `b47390c8ce04b2674e9222918bcd4e03fa5aed24`, tree
`c8a1f2f9e84f6298f1b044a8e8cec2549f33c15f`. This is not accepted BASE_W09.
W08 lane proposals, including PR77, merged externally; no runtime/infrastructure/
tooling source changed. E performed no merge or independent approval. C014 PR41
already merged as a bounded customer session demo; no duplicate branch is created.
The registry still names W01 INTEGRATION_PENDING/BASE_W02:null, accepted next-wave
contracts[] and no published versions. BASE_W09 and agreed recovery targets are absent.

## Deliverables

- [Immutable source, migration inventory and current evidence](SOURCE_OBSERVATION.json).
- [Deployment, migrations and rollback/forward procedure](DEPLOYMENT_MIGRATION_AND_ROLLBACK.md).
- [Backup cut, isolated restore and cross-owner reconciliation](BACKUP_RESTORE_AND_RECONCILIATION.md).
- [Operating roster, actual staged users and incident drills](OPERATING_ROSTER_AND_DRILLS.md).
- [Blocked RC inputs, production command boundary and W10 requests](RC_AND_W10_REQUESTS.md).
- [34 declarative acceptance families](../../../../tests/parallel/E/W09/OPERATIONAL_REHEARSAL_SPEC.md).
- [Resumable checkpoint](CHECKPOINT.md).

## Real foundation evidence and operational gaps

Current main has43/43 successful checks and8/8 workflows. F00937531731909 attempt1
security/CodeQL/aggregate ZIPs match API digests; JSON source/tree/clean/run/attempt
and all steps are verified. Secrets history/source0, dependency advisories0,
scanner regressions6/6; CodeQL retains four warnings/0blocking. Aggregate accepts
29 exact-source records including23 images, explicitly **foundation only**.
Proposal head and any later candidate/target need their own mandatory checks.

Separate owner migration/runtime identities, migration-free startup and disposable
real migration/ACL/messaging/Identity tests exist. Current inventory is19 owners,
21 migrations,15 marker-only schemas and18 non-Identity business-not-ready services.
The populated Identity upgrade preserves a marker sentinel, not historic booking,
ledger, entitlement or media records. Customer is a partial memory-only session
demo; operator/admin are technical boots. There is no accepted full functional/
hardening base or actual product dataset to restore.

CI builds/scans local image IDs, probes isolated technical readiness503 and deletes
them; final repository publication/pull/deployment is unproved. Prisma migration
CLI runs from development dependencies, not an existing immutable runtime migration
job. Drift compares committed migration replay to committed schema, not live DB.
No source-backed backup/PITR/object restore or rollback/forward executor is found.
Collector/TLS/worker scraping, intended topology/access, named recipients/support
coverage, approved RPO/RTO and actual operational participants remain unverified.
Written runbooks and historical CI image counts are not current operational proof.

Only eight new E-local files. Source versions remain contracts0.0.2 /
event-contracts0.0.2 / empty api-clients0.0.1; migrations added[]. No shared/owner/
reference/runtime/configuration change or expired bootstrap lease use. No local
DB/broker/provider/storage/browser/device/staging/deployment/restore/alert/live-money
exercise, new message or production action occurs. Resources allocated[]; heavy
leases[]. The full task remains blocked while independent proposal work is reviewable.
