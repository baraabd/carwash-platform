# W04-C — Cash drill and execution acceptance specification

Every step/case below is **BLOCKED_NOT_RUN**; no actual drill/provider/browser/money test executed. [Checkpoint](../../../../docs/parallel/C/W04/CHECKPOINT.md) records absent base/contracts/resources. Use E-allocated real owned PostgreSQL, RabbitMQ, storage/scanner, Identity/guest/admin and actual A/B/C/D app/provider builds from accepted common source. Synthetic private records are test data, never fake authority/providers. Require positive authorized controls for denials; absent endpoints/universal denial cannot pass.

## Coordinated real guest/optional-plate drill

Record authoritative refs/revisions and redacted evidence, not invented identifiers. All real apps must share the same accepted operation/Booking/assignment/Work/receipt/custody relationships.

| Step | Actual command/journey and assertion |
| --- | --- |
| 1 Customer | A's unchanged seven screens create guest cash order with missing optional plate; real Pricing/hold/Booking/Billing obligation confirm accepted server facts; no fake payment success |
| 2 Admin | D dispatches actual Booking/reservation to eligible technician/resources; record current admin actor/scope/reason/assignment fence |
| 3 Technician | C accepts one current offer, travels and asserts arrival; no illustrative map or operator button claims GPS verification |
| 4 Before | Reserve/upload/finalize/scan/process actual private before image for same Work/assignment; quarantine cannot satisfy start evidence |
| 5 Work | Start under current eligibility/assignment/reservation/policy; complete exact approved checklist snapshot/revision |
| 6 After | Persist clean private after image; comparison reads authorized actual before/after objects, no seeded illustration |
| 7 Delivery | Explicit finish and delivery persist Work/audit/outbox while payment/custody remain separate; unpaid collection still visible under approved policy |
| 8 Cash | Explicit collection invokes B-authoritative amount/remaining due and current permitted late-collector authority; persist one Billing receipt/posting outcome |
| 9 Handover | Operator requests Wallet custody handover for exact receipt allocations/approved holder/recipient; company custody remains pending/unsettled |
| 10 Treasury | Distinct authorized company/admin acknowledgment records independent evidence and actual Billing treasury settlement; Wallet reconciles refs before settled |
| 11 Three apps | A receipt/progress, C task/collection/custody and D dispatch/finance/Reporting show shared IDs, independent states and freshness; no triple-counting revenue |
| 12 Restart | Restart actual owners/replay events/reload apps; stable business IDs/outcomes/snapshots persist, no repeated collection/settlement or optimistic fallback |

## Required negative, race, recovery and UI cases

| Case | Action and required outcome / evidence |
| --- | --- |
| DISP-01 | Race two acceptors across processes; unique active task assignment and CAS/fence admit one winner. Reject stale/foreign offer and overlapping approved resource/active Work; real DB constraints and actual HTTP |
| DISP-02 | Reassign/release while old actor issues Work command. Prove accepted execution-authority/quiescence protocol, stale attempt fences and durable recovery; no two authorized concurrent executors |
| AUTH-01 | Revoke eligibility mid-flow, suspend/revoke session, change reservation/resource grants. Sensitive transitions fail or follow approved safe in-flight policy; current direct-owner/Gateway/CSRF/delegation tests, not header trust |
| WORK-01 | Retry every travel/arrive/start/checklist/finish/deliver command concurrently and after lost reply/restart. Same key/body replays once; changed body conflicts, new-key logical duplicate cannot repeat business effect |
| WORK-02 | Skip phase, stale Work/checklist/assignment revision, missing required checklist or before/after evidence, pending/rejected/revoked Media. Completion refuses with valid positive control; audit/history/outbox atomic |
| MEDIA-01 | Interrupt reservation/upload/finalize/scan and reconnect after reply loss. Actual bytes survive/reconcile safely or remain unavailable; duplicate finalize stable, no local preview used as completed evidence |
| MEDIA-02 | Other operator/customer guesses Work/object and reads metadata/photos or attempts finalize/attach. Wrong case/purpose/audience/expired grant denies; actual same-owner read control and real storage/scanner |
| CASH-01 | Retry cash same-key/equivalent body, changed amount/receipt fingerprint and new-key duplicate collection business ref. One B receipt/posting; authoritative current amount/revisions, no float or browser total override |
| CASH-02 | Cash command after delivery/reassignment/revocation/offline reconnect, partial/short/over/mixed-currency assertions. Accepted B policy/current late-collector authority applies; historical assignment alone grants no unrestricted money command |
| CUST-01 | Request twice/overlapping receipt allocations or duplicate handover under new key. Same cash cannot be handed over twice; approved holder/purpose/recipient validation; request remains pending |
| CUST-02 | Self-acknowledgment, wrong/out-of-scope/stale admin, absent treasury evidence, short/over mismatch, unavailable Billing settlement. No false settled flag; real independent treasury and B-backed Wallet positive control |
| FIN-REC-01 | Crash before/after B collection or treasury effect/ack/local commit and Wallet request/reconciliation. Stable original operation lookup/replay; immutable postings/receipts and pending/disputed recovery, no double settlement |
| MQ-01 | Broker outage at business commit; relay crash before publish/after confirm; consumer crash before commit/after commit before ACK; duplicate/hash conflict/old/gap/reversal-first/settlement-first events. Actual outbox/inbox effect/reconciliation evidence |
| DB-01 | Fresh/upgrade append-only migrations, constraints/schema drift, real restart durability and foreign runtime/migration-role denial; original marker history preserved |
| ADMIN-01 | Actual scoped admin-created Booking uses W03 quote/hold/ownership/idempotency with separate actor/beneficiary/reason. Dispatch/reassign still validates current authority; denied role/out-of-market/mismatch/replay tests |
| LOC-01 | Workforce foreground update requires actual active Work/assignment/consent and accepted timestamp/accuracy/sequence policy. Stale/reassigned/terminal/revoked/permission-denied update refuses; location does not advance Work |
| LOC-02 | Real customer's scoped live view shows current/stale/offline/unavailable accurately. Another customer/technician/out-of-scope admin cannot read private location; no permission yields no fabricated marker or public fleet/history |
| GEO-01 | Real configured Geo routing/contact controls preserve task scope and manual fallback. Missing provider/stale route shows unavailable/stale, not demo ETA/GPS verification; optional plate presentation unchanged |
| UI-01 | All six execution phases and keyboard sheets/focus return/back controls, normal/reduced motion, capture/upload comparison/retry, camera denial and reconnect errors; real provider browser traces plus pinned Linux reference/candidate/diff, no reference/tolerance change |
| UI-02 | Approved English LTR and Arabic RTL for required states, explicit operator build/typecheck and A/D affected journeys; missing production/English design remains blocked. Windows/device interactions separate from canonical Linux pixels |
| PROJ-01 | Delivery while unpaid, cash recorded while custody pending, independent treasury reconciliation then settled, source outage/gap/lag. Actual A/C/D read projections preserve distinct authoritative state, checkpoints and totals |

Each executed step/case requires exact base/target/head/tree/contracts/policies, actual provider/app builds, migration IDs, commands/exit results, redacted DB/HTTP/storage/broker/browser artifacts, allocated run identity, owned handles and cleanup. E's latest-target candidate/all mandatory CI/independent review/actual resulting-main gates remain required. No fixture, skipped case or missing app/cash producer closes Day 3. No live money/production exercise or W05 implementation is authorized by this plan.
