# W09-E backup, restore and reconciliation proposal

**BLOCKED_NOT_RUN.** No backup has been created/restored and no recovery duration,
data-loss value or operational recovery has been measured by this packet.
Accepted BASE_W09, intended isolated infrastructure, authorized representative
historic data, backup/storage/provider access, current security/privacy decisions
and previously approved RPO/RTO are required. Current sources explicitly disclaim
backup/PITR/production proof (`docs/adr/0006-postgres-data-sovereignty.md`).

## Consistency contract before backup

Independent owner DB snapshots are not a shared business transaction. Approve a
source-backed consistent-cut protocol: accepted quiescence/journal-watermark/
reconciliation strategy, producer/consumer ingress and outbound gates, in-flight
original receipts, per-owner cut/timestamp/checkpoint and tolerated skew, broker
inbox/outbox/pending/DLQ state, private object versions/checksums and external
merchant query/reference cut. Keep unresolved committed/UNKNOWN operations durable.
Choose the protocol for actual intended infrastructure; do not assume simultaneous
dumps, DB shutdown or clocks alone establish cross-service business consistency.

| Retained backup member      | Required independent record                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every19 owner DB            | Backup ID/digest, prior source/schema/migration checksums, exact cut/journal watermark, owner restorer identity and independent expected facts. Gateway/admin have no business DB.                          |
| Durable messaging/work      | Original event/idempotency IDs and payload fingerprint, inbox/outbox/checkpoints, current assignment/lease/fencing, pending/exhausted/DLQ dispositions and accepted replay policy.                          |
| Media/object store          | Authorized bytes/version/checksum plus subject/order/attempt/purpose, quarantine/scan/finalization/deletion/retention/legal-category state and storage restore identity.                                    |
| External financial boundary | Genuine original provider operation/query/verification/refund references and independent per-currency totals/UNKNOWN exposure; secrets remain protected references.                                         |
| Security/privacy            | Current revocation/authVersion/session/OTP/refresh consumption and approved key/pepper/CSRF/rate-budget policy, deletion/suppression/retention decisions, audit/purge rights and privacy task/result links. |
| Artifact/configuration      | Accepted app/worker/migration-job digests, configuration/secret-reference revision, compatibility and exact authorized environment allocation.                                                              |

Test actual backup completeness, checksum/corruption/missing members, authorized and
forbidden access, protected storage/encryption/retention under approved policy.
A retained file or manifest alone is not recovery acceptance. No raw private dump,
credentials, signed links or provider payload may enter generic CI artifacts.

## Isolated restore order and durable oracles

1. Allocate the separate approved restore environment and verify isolation. Gate
   ingress, consumers and external effects; use only owned project/roles/queues/
   object prefixes/ports/output/browser handles and independent cleanup budget.
2. Pull exact reviewed runtime/migration artifacts and config. Restore the agreed
   owner/database, object/broker set through owner-controlled tools; restore owner
   roles/TLS/privileges without granting runtime migration rights. No E cross-DB SQL.
3. Apply current approved security/privacy decisions to older restored state before
   access: prior grants, logout/suspension/role reduction, consumed OTP/refresh,
   deleted/retained media and suppression cannot be silently resurrected. The exact
   reconciliation/key/session policy remains unapproved; do not invent an epoch.
4. Reconcile authoritative financial/capacity/work/media/entitlement and coordinator
   receipts against independent pre-fault expectations and genuine original
   provider references. Decide each retained UNKNOWN through accepted owner policy.
   Never create replacement charges/refunds/benefits/notifications or automatically
   restore expired capacity. Cash custody, collection, company receipt and settlement
   stay independent; correction lineage and immutable historical snapshots survive.
5. Reconcile transport receipts and current fencing, then rebuild projections from
   approved cuts/generations/freshness/privacy masks. Do not delete inbox receipts to
   force a rebuild or use Support closure as refund settlement. Respect original
   notification identities and approved outbound replay/send boundary.
6. Resume compatible workers, then dependencies/Gateway/apps in the accepted graph.
   Real customers, technicians, finance and admin/support operators validate their
   original operations, current tasks, private bytes and all-app journey outcomes.
7. Measure and retain actual recovery/data-loss results, role/drift/replay/audit
   checks, every discrepancy and cleanup. Any missing drill is NOT_RUN with its
   launch-blocking consequence; no unavailable/constrained run becomes PASS.

## Restore/process incarnation fence: unresolved accepted dependency

The B handoff requires a fresh accepted restore/process-incarnation fence. In the
isolated drill, retain a surviving pre-restore owned worker and attempt finalization
with its old token after restoring older row revisions/lease counters. Prove denial
and original-operation reconciliation; lower restored counters must not revive the
old authority. Killing a process or asserting current row revision alone cannot
close this case. Owners/E must publish the accepted fence semantics before execution;
this proposal assigns no new epoch API, wire field or implementation.

## RPO/RTO definitions: UNSET / UNAPPROVED

Retain approver/profile/hash before execution; define fault clock/start, backup cut,
committed-versus-acknowledged operation set, external financial effects, actual lost
IDs/amounts/entitlements, owner and aggregate recovery criteria, routing/identity/
privacy/media/reconciliation completion and observation window. Compare measured
loss and end-to-end recovery time to agreed limits without lowering them after
failure. pg_isready, file extraction or one restored service is not business recovery.
The generator/host/resource constraint classification and rerun/abort limits must
also be frozen. No number in source timeout/lease/prototype data is an RPO/RTO.

## Retained source risks, not reproduced defects

W08 D3 swallowed cleanup, signal-ignoring DB cancellation, final-lease and batch-tail,
broad duplicate ACK, pressure/readiness and audit mutation grants remain unresolved
real-test requests. Restore must not reintroduce these unsafe states. Worker stop
can escalate SIGKILL; record actual disposition and drain rather than assuming an
awaited stop is graceful. Identity log-write failure can bypass teardown; sequential
observability cleanup can skip later handles; nominal polling timeout can overrun
on an unbounded probe. Register independent recovery before destruction, attempt
all owned cleanup, propagate every failure and retain resources on unsafe teardown.
These observations do not establish executed data loss, leak or restore failure.
