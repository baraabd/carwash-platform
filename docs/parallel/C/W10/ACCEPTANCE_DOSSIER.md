# W10-C acceptance dossier — BLOCK / NO-GO

Task W10-C; phase ENTRY_BLOCKED / PROPOSAL_ONLY; exact-RC execution NOT_STARTED. Recommendation to E/release owner: **BLOCK full release**. This is an unsigned source-bound readiness assessment, not signed exact-RC acceptance. No RC has been supplied. Parent is NOT_STARTED / INTEGRATION_PENDING, never DONE. The conditional seven-day target changes no gate.

## Inspected source and release identity

Observed main/proposal parent `8bfa805d033cb29373c33886bf71bce4885a2f67`; exact tree in [source observation](SOURCE_OBSERVATION.json). PR #81 merged externally at `8ce37e5502cd105c788946968d94fdb6cc4ba1b8`; zero open PRs at initial refresh. C014 #41 remains merged at `69d81a83a3409d0693272efeb19ebeb9805750f5`, session demo only; no duplicate work. Main is an analysis source, **not BASE_W10 or an RC**. Diff from inspected W09 parent consists only of W09 proposal packets/specifications; no functional fix is inferred from those merges.

[Accepted registry](../../../../architecture/parallel-contract-release.json) still records BASE_W02 null and acceptedNextWaveContracts empty. [E W09 freeze requests](../../E/W09/RC_AND_W10_REQUESTS.md) explicitly declare BASE_W10, RC and production execution set absent. Existing packages are contracts 0.0.2, event-contracts 0.0.2 and empty api-clients 0.0.1, not accepted W10 business clients.

| Required immutable release field | Current value | Closure owner |
| --- | --- | --- |
| Verified BASE_W10; RC source/tree; latest target/head/candidate/result refs | UNAVAILABLE | E after actual predecessor acceptance and independent review |
| Published/pulled application, worker and migration image repository digests; provenance/SBOM | UNAVAILABLE | E and artifact owners |
| Environment identity/topology, config/secret references, accepted contract versions | UNAVAILABLE | E; actual input owners |
| Exact final mandatory and affected gate list/commands | W01 foundation manifest exists; final full-product list UNAVAILABLE | E, all affected owners |
| W09 reproduced fixes, actual drill results, restore/rollback, device and staff sign-offs | Proposal packets only | E and responsible source/operations owners |
| Named release authority, independent reviewers, operating roster and contact references | UNAVAILABLE | Actual release/operations authority |

No operational name, endpoint, policy, SQL query, credential or timing budget is guessed.

## C service and feature evidence index

Paths below are relative to repository root and bound to inspected source. All outcome rows are **BLOCKED_NOT_RUN** for final RC. `src/app.module.ts` of each C service declares BUSINESS_READY=false; each Prisma schema contains only ServiceMarker. Migration inventory/checksums are in SOURCE_OBSERVATION.json. Those technical migrations do not implement product records or prove final upgrade/compatibility. No deployment record establishes a business-ready C artifact.

| Feature/invariant | Source/authority anchor | Required final proof; current residual |
| --- | --- | --- |
| Operator shell, home/readiness, tasks, collections, profile, task stages/dialogs | apps/operator-web/src/index.ts and server.mjs; approved TECH reference and W01 inventory | Technical boot only, ready endpoint503. Real authenticated UI, all inventory states, production/English decisions, final build/typecheck and canonical pixels absent |
| Private upload, byte validation/quarantine/scan/finalize; later customer/operator/reviewer access | services/media/src/app.module.ts; services/media/prisma/schema.prisma | Actual owned records/object store and current object grants, revocation, expiry, cross-user denial, retention/deletion evidence absent |
| Worker approval/expiry/suspension, team/shift/van/equipment; foreground Work | services/workforce/src/app.module.ts; services/workforce/prisma/schema.prisma | Current eligibility and Work persistence/authorization, resource maintenance and atomic state/replay proof absent; no payroll/marketplace extension |
| Capacity holds/limits/expiry, shift/resources and reschedule | services/scheduling/src/app.module.ts; services/scheduling/prisma/schema.prisma | Actual exclusion/uniqueness constraints, concurrent requests, historic migration upgrade and durable hold/release/recovery absent |
| Guest/optional plate, immutable snapshot, booking orchestration/cancel/restore/compensation | services/booking/src/app.module.ts; prisma/schema.prisma; domain/lifecycle.ts | Pure historical transition prototype is unconnected; real HTTP/DB/producer contracts, operation fingerprints/replay and recovery absent |
| Assignment/reassignment/exclusive acceptance and current grants | services/dispatch/src/app.module.ts; services/dispatch/prisma/schema.prisma | Actual assignment revisions, single winner, revocation/reassignment, crash/replay/dead-letter proof absent |
| Payment/Wallet/Subscription/promotions and cash handover | B-owned producers; A/D approved consumers; C operational projections | No accepted live business clients. Exact-money financial confirmation/custody/entitlement proof and accepted Paymera disposition absent |
| Operational ownership, rollback/reconciliation, incident handling | E W09 requests; C W09 runbooks | No named authorized staff/contact records, populated backup or measured restore; proposed runbooks cannot stand in for actual teach-back |

Full approved Arabic inventory is [TECHNICIAN_INVENTORY](../W01/TECHNICIAN_INVENTORY.md); it bounds all five top-level views, eight prototype stages/six visible phases, dialogs, filters, local photo/comparison and focus/motion states. Registered Arabic TECH/admin/customer HTML is unchanged. Reference state names are not accepted server contracts. Missing approved English LTR, optional-plate empty copy and production recovery/permission states remain visible blockers, never omitted rows. Prototype reset/demo photos/simulated contact are not privileged production operations.

## Representative order and recovery trace — required, not executed

The evidence record must join public authorized IDs/revisions across these independent facts without cross-owner SQL: Booking historical snapshot/saga; Scheduling hold/reservation; Dispatch assignment; Workforce Work/checklist/delivery; Media private object/processing/grants; B financial obligation/payment/cash custody/settlement and Wallet/Subscription holds/entitlement; D projections/communications. Frontend/Gateway navigation/cache never supplies authoritative truth.

For the same original operation IDs, capture pre-action owner reads, authorized command receipt, timeout/UNKNOWN status reconciliation, persisted post-action records, events/outbox/inbox and projection convergence. Repeat after app/service restart, duplicate/out-of-order delivery and approved recovery. Same operation/key/fingerprint must replay the original result; a changed fingerprint conflicts. No manual DB repair or new money operation to settle an unknown response. Work delivered/uncollected is distinct from customer payment, technician custody and company receipt; proof upload is not received money. Late payment cannot resurrect expired capacity. Suspension/revocation and current private-media authority remain effective after restore. No background GPS claim; manual arrival is not tracked movement.

## Evidence binding and decision rules

Use [scope cases](../../../../tests/parallel/C/W10/acceptance-specifications.md). Every executed row needs case ID, full RC/source/tree, image/job digests/config/contracts, exact command/runner version, environment and actual timestamp/duration, actor/device reference, initial data/expected outcome, original IDs/revisions, owner result links, immutable artifact checksums, outcome/residual and independent reviewer identity/signature. Protected evidence remains access-controlled and secret-free; empty fields remain UNAVAILABLE, never inferred PASS.

Existing scripts `pnpm --filter @carwash/operator-web build` and `pnpm --filter @carwash/operator-web typecheck` are real app commands, **not run here**. E must publish the exact final integration executors; none is invented for missing business APIs. Root build/typecheck alone do not cover the operator. Linux canonical reference/candidate/diff uses unchanged F010 fonts/browser/DPR/state/tolerances; separate Windows/actual-phone interaction proves device behavior. A fixture/golden HTML run proves neither deployed UI nor real providers. Historical W09/CI successes cannot transfer silently.

Source/config/artifact/evidence changes require E to reconstruct the latest-target candidate, rerun all mandatory/affected gates and approvals, verify refs unchanged, and verify actual resulting target. Source-local release defects require independently reviewed targeted C child PRs with reproduction and affected test evidence; no defect is invented to justify a product write. Accept only complete exact-RC full-scope proof, closed blockers and eligible independent review. Missing/failed critical evidence yields BLOCK/NO-GO. No automatic next wave, self-approval, merge, production action or live funds.
