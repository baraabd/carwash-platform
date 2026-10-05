# W04-A — customer cash journey entry proposal

Task: **W04-A**, Lane A. Implementation and parent acceptance: **BLOCKED**.
This is an authorized lane-local proposal child, not the implemented cash journey.

Observed target: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`, tree
`9f04d674056041bbc810a62e4cc7f275c32581b8`. No accepted `BASE_W04` is published.
Branch: `proposal/w04-A-cash-journey`. The branch starts at the observed target
only to submit this proposal; it is not an implementation base or wave promotion.

## Current source and entry boundary

- C014 PR #41 is merged at `69d81a83a3409d0693272efeb19ebeb9805750f5`.
  Do not reopen its completed session-demo slice or create a duplicate.
- W03 PRs #51–55 are merged. Their delta from
  `82e7402ed9ab6cc4f565f423441cd0655f2d627a` is 29 added lane-local documents/specifications,
  4,280 insertions, zero runtime/schema/migration/shared/workflow changes.
  A's PR #53 is merged at `4c558931b598436b25547036474fa28be5c0b137`;
  A's packets are present. The registry's `requested-not-received` A entry is stale.
- The contract registry still records W01 `INTEGRATION_PENDING`, `BASE_W02: null`,
  no `BASE_W03`/`BASE_W04`, and no accepted next-wave business contracts.
  Shared HTTP contracts remain Identity v1 and Gateway v1 routing only;
  business API clients still export nothing. Merged requests do not freeze schemas.
- Orders is a placeholder. Tracking and payment are C014 session handoffs;
  reload does not recover an order. Relevant service schemas are marker-only.
  Operator/admin are technical boot applications with `businessReady: false`.
- Current instruction ends E's bootstrap product writes. Permanent A ownership
  applies now; stale conditional leases do not restore E permission. Missing
  accepted contracts/base still block the dependent product writes separately.
- Production tracking/receipt/error copy, current Work/location ownership,
  financial/custody actors and transitions, currency precision and real market
  inputs need explicit accepted records. Preserve all existing approved references.

## Proposed dependency queue — no child is accepted or started here

Each provider first proves its own real DB/HTTP/Identity/constraints and published
contract conformance. E then gates a consumer against already merged providers on
a fresh target/head candidate. These are requested child boundaries, not permission
for A to implement peers or E to edit their product source.

| Requested child      | Owner and prerequisite                                             | Exit evidence before consumers                                                                                                                         |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W04-PREDECESSORS     | E and A–D; complete missing W01/W02/W03 policy/contracts/providers | Actual guest/member authorization, owned customer snapshots, quote/hold and durable Booking/cash obligation; accepted source-bound bases               |
| W04-C-DISPATCH       | C; accepted Booking/Scheduling and current Workforce grant         | Real assignment attempts/authority, eligibility, rejection/reassignment/fencing and release                                                            |
| W04-C-WORK-BINDING   | C; merged real Dispatch authority                                  | Fenced Work identity/purpose, cancellation and unavailable-worker recovery; no assumed assignment ownership                                            |
| W04-C-EVIDENCE       | C Media; merged Work-purpose binding                               | Private reserve/upload/scan/finalize/read grants, same Work attempt/angle, revocation and missing-media behavior                                       |
| W04-C-WORK-EXECUTION | C; merged binding/evidence and accepted prerequisite policy        | Operator acceptance/arrival/start/completion, restart recovery and unpaid follow-up; real execution facts                                              |
| W04-D-UPDATES        | D; accepted owner events                                           | Durable Communications delivery and Reporting copies, integrity/dedup/gap/catch-up; copies do not authorize financial commands                         |
| W04-B-CASH           | B Billing; merged Work facts and approved financial policy         | Authorized collection/receipt/corrections, current collector grants and durable unknown-outcome lookup                                                 |
| W04-B-CUSTODY        | B Wallet; merged Billing postings and approved custody allocation  | Handover/reconciliation with independent company evidence and Billing treasury references; no second ledger                                            |
| W04-D-ADMIN-CASH     | D; merged providers/public clients                                 | Actual scoped assignment/finance/reconciliation app commands and complete affected admin journey, verified against real owners                         |
| W04-C-OPERATOR-CASH  | C; merged providers/public clients and required admin flow         | Actual assigned acceptance/arrival/evidence/completion/cash app journey, verified against real owners and available admin consumer                     |
| W04-A-CUSTOMER-CASH  | A; all needed providers/public clients and peer consumers merged   | Orders/tracking/completion/cash receipt through all three actual applications, recovery, authorization, visual and accessibility cases                 |
| W04-E-BARRIER        | E plus eligible independent reviewer; all children above           | Latest target/head candidate, mandatory/affected gates, unchanged refs, authorized merge and actual resulting-target checks before publishing BASE_W05 |

If finance policy requires another prerequisite, split the provider further and
publish a new common accepted base. Never make two indivisible PRs require each
other's unmerged runtime. Keep W04-A parent `INTEGRATION_PENDING` once provider
implementation starts, until every task-required combined-source case passes.
If financial closure requires a receipt, split Work facts → Billing cash provider
→ Work financial-closure consumer. Declare every required subscriber binding
before producer activation, including consumers whose application follows later.
E defines the exact scope/gates for each consumer child before coding: a narrow
admin/operator acceptance proves its entire affected real app-to-owner journey;
it does not claim the parent three-app drill. The final customer/integration child
requires the already merged peer consumers and every full three-app case before
its merge. If an owner needs a further UI prerequisite, split that child explicitly.

## Packet index

- [Customer surfaces and authoritative facts](CUSTOMER_CASH_SURFACES.md).
- [W04 acceptance specifications](../../../../tests/parallel/A/W04/ACCEPTANCE_SPECIFICATIONS.md): proposed cases, all unexecuted.
- [W05 contract requests](W05_CONTRACT_REQUESTS.md): electronic payment and rescheduling, not accepted wire contracts.
- [Source observation](source-observation.json): immutable source and actual diagnostic results.
- [Resumable checkpoint](CHECKPOINT.md): exact commands, evidence limits and next action.

Status for Baraa: تنفيذ رحلة الكاش الحقيقية محجوب لغياب BASE_W04 والعقود والمزوّدين المقبولين.
هذه الحزمة مقترحات وخرائط واختبارات قبول غير منفّذة؛ دمجها لا يثبت اكتمال رحلة الكاش.
