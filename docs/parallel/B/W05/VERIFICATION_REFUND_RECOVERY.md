# W05-B verification, refund and financial recovery proposal

Task: W05-B, Catalog/Pricing/Billing/Wallet/Subscription; bounded proposal work.
Observed immutable source: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`.
Observed tree: `cc3517ec85525c7310fe340397506ef6be3fe0a9`.
Final source reads used `/workspace/scratch/6a9547568741/carwash-w05b-source`.
A's unmerged draft is not a provider dependency. Actual local proposal diagnostics and remote submission are recorded in [CHECKPOINT.md](CHECKPOINT.md); no business build/test, database, broker, browser or provider operation ran. Read-only agent QA is not independent approval.
Every design below is **PROPOSED_NOT_ACCEPTED**; no DTO, event, policy or adapter is frozen here.

## 1. Entry truth and bounded ownership

- [R1] remains W01 `INTEGRATION_PENDING`: BASE_W02 null, no BASE_W03/W04/W05.
- Accepted next-wave contracts and client list are empty; reviewed release source and versions are absent.
- Existing HTTP exports cover Identity and Gateway; Gateway route discovery is not producer implementation.
- Existing events are a non-financial Catalog foundation probe and contract-only Booking confirmation.
- Shared package observations are contracts 0.0.2, event-contracts 0.0.2, api-clients 0.0.1; none is a W05 finance release.
- [R2] explicitly treats the B W04→W05 finance packet as proposed, accepted versions none.
- W04 cash acceptance, approved refunds, merchant/sandbox configuration and recorded Paymera scope remain missing entry evidence.
- Absence in inspected source does not establish absence of privately held provider documentation or an external acceptance record.
- E must publish any actual accepted release with immutable SHA, versions, policy, independent review and target evidence.
- W05-B user scope expires E's bootstrap lease; stale `verified-BASE_W02` conditions do not reauthorize E product writes.
- B permanently owns the five specified service directories and B-local docs/tests/scripts [R3].
- ALL package.json/lockfiles/tsconfig/Dockerfiles/shared contracts/global infrastructure stay E-owned.
- Media/Booking/Scheduling/Dispatch/Workforce belong to C; admin/review/support/reporting/configuration belong to D.
- Customer relationships and app belong to A; current Identity and Gateway belong to E.
- No endpoint, new merchant account, signature algorithm, retry budget, exchange rate or production price is invented.
- Cash/ShamCash/Syriatel are the three approved UI methods; `sham` versus candidate `shamcash` needs published mapping.
- Paymera B-02 remains OPEN: resolve required/deferred/excluded and relation to existing methods; do not add a fourth card.
- Internal Wallet is not automatically customer stored value; no funding/withdrawal/payroll/marketplace/recurring debit is authorized.

## 2. Actual B implementation and predecessor limits

| Owner        | Actual persistence/runtime at inspected source                                 | What it does not prove                                               |
| ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Catalog      | ServiceMarker, FoundationProbe, OutboxMessage; probe/outbox and health runtime | Published packages/add-ons or persistent authoritative quote         |
| Pricing      | ServiceMarker; Prisma/health runtime; BUSINESS_READY false                     | Immutable production quote, prices, approved rounding/tax            |
| Billing      | ServiceMarker; empty application/ports; health runtime; BUSINESS_READY false   | Intent, credit, allocation, receipt, posted journal, refund or audit |
| Wallet       | ServiceMarker; empty business domain; health runtime; BUSINESS_READY false     | Custody, balance, handover, hold or reconciled settlement            |
| Subscription | ServiceMarker; empty business domain; health runtime; BUSINESS_READY false     | Plan activation, entitlement or reversal                             |

Catalog's quote and Billing's ledger are historical pure BigInt helpers [R4], not financial producers.
The ledger validates balanced candidate amounts per currency; it does not authenticate accounts or persist posting.
Its 2–1000 lines, uppercase currency and 1–18 digit positive amounts are helper limits, not approved business policy.
W01–W04 packets and declarative specifications are present, but their merger does not execute their tests.
Do not inherit A's 304 fixture/session diagnostics as B tests or W04 cash acceptance.
Root reported current toolchain verification FAIL 38/40: local Node24.19.0/pnpm11.25.0 versus pins24.21.0/10.32.1.
Use supported tools and genuine allocated isolated resources before any implementation gate; names alone provision nothing.

## 3. Independent financial facts and truthful outstanding

Preserve these dimensions with owner revision, evaluated/as-of time and quality [R2, R5].

- Obligation/approved due: immutable quote, beneficiary, Booking and policy binding; not receipt or collection.
- Intent/recipient/QR instructions: an invitation to pay; not received funds or an authorized Work start.
- Proof/upload/scan/review: evidence intake/access decisions; never independent receipt of money.
- Received merchant credit: authenticated authoritative recipient account, native transaction identity and finality evidence.
- Allocation: separate approved matching of an established credit to an obligation; one credit cannot allocate twice.
- Outstanding: Billing's approved obligation/allocation/correction facts; no subtraction of treasury settlement or browser totals.
- Refund reserved/in-flight/unknown: pending recovery and retained allowance; not refunded money or unpaid reset.
- Confirmed refund/reversal: independently evidenced financial fact with immutable original receipt and linked correction.
- Cash custody/handover/treasury: Wallet/Billing facts distinct from customer collection and service completion.
- Booking/capacity/assignment/Work: C facts; Billing verification does not commit or recreate any of them.

Wrong amount/currency/reference or missing Booking may prevent allocation while genuine merchant credit remains established.
Preserve that credit/evidence identity and explicit unallocated/disputed disposition [R2:148–157].
Wrong merchant or unproven authenticity/finality does not establish this business's received credit.
Do not invent a suspense account, auto-allocation, overpayment refund or conversion; accounting disposition needs approval.
Rejecting proof or denying allocation cannot erase independently observed funds; correcting an error appends history.
Missing/stale owner source is unknown/unavailable, not zero, unpaid, paid, settled or refunded.

## 4. Provider dossiers and ingestion publication requirements

[R6] records limited historical public research, not a current versioned protocol acceptance.
All three dossiers remain DOCUMENTATION_AND_ACCESS_PENDING; root must refresh genuine owner-supplied documentation.
Paymera advertises partner API access, without accepted signature/status/refund/sandbox specification in this source.
ShamCash indexed material had incomplete retrieval; unofficial SDKs/automation are not authoritative provider documentation.
Syriatel advertises merchant QR/history; machine verification/export/refund protocols are unverified here.
Account onboarding/verification is not verification of a specific payment; wallet closure is not merchant transaction refund.
Ask the responsible business/provider owner for the effective merchant agreement, allowed account and authorized access.
Ask for documented native ID namespaces, amount/currency encoding, direction, occurrence time, finality and reversal semantics.
Ask for API/auth/key rotation, webhook signing bytes/headers, replay rules, polling/status and refund/query/idempotency protocols.
Ask whether a genuine sandbox/test merchant exists and which operations are explicitly permitted; never invent one.

For each supported source, publish a separate reviewed capability matrix: ingestion, status lookup, finality, refund and recovery.
Unsupported automation stays visibly unavailable; approved manual evidence cannot substitute for required provider integration.
Callback ingress authenticates the documented provider and intended account, independently of a customer's member JWT.
Verify the exact documented byte sequence before parsing/normalizing; decoding and reserializing JSON can change signed bytes.
Current Gateway parses JSON [R7:52], forwards request.body and JSON.stringify(body) [R8:28]; it preserves no callback raw-byte contract.
Current allowlisted routes/authenticated headers do not publish a provider callback endpoint or signature-header transport [R9].
E must supply bounded raw-byte callback routing/header/encoding/errors and credential isolation; B supplies business verification.
Do not place finance logic in Gateway or bypass authentication through arbitrary forwarded signature/actor headers.
Persist bounded private ingress provenance, native delivery identity, authentication result, hash/parser revision and processing outcome.
Actual raw-byte retention/encryption/redaction/expiry is an approved policy input; never dump payloads/credentials to logs/events.
Polling/import/manual ingestion needs the same authenticated account/reference/finality/matching/uniqueness rules as callbacks.
No provider write, account login, real-money transfer/refund or sandbox operation is authorized by this audit.

## 5. Current grant, private evidence and review boundaries

Existing Identity checks account ACTIVE, session linkage/expiry/revocation and authVersion [R10:380–400].
Existing finance `billing.read`/`billing.refund` and reviewer `verification.review` are broad vocabulary, not accepted new object grants.
E/B/D must freeze object/market/purpose/audience/delegation for submit/review/verify/reserve/approve/execute/reconcile/read.
Initiating actor, beneficiary, reviewer, merchant authority and provider/service identity remain distinct.
Do not infer verifier authority from technician assignment, admin access, role name, reference ID or self-submitted body.
Recheck current authority for review reads/replay and mutation/queued execution under accepted commit-validity semantics.
Revocation after preview/preflight must refuse unauthorized review/approval/execution; cached UI capability is not a grant.
Revocation must not erase factual previously received credit or independently reconcile an external effect as absent.
Approval separation and thresholds require B-06/B-11; a submitter/requester cannot obtain self-approval by switching role.
Manual verification requires approved independent merchant/provider/bank history, not customer proof or return navigation [R6].
Record authorized provenance, parser/checksum, account alias, native reference, amount/currency/direction/finality and reviewer/audit.
C Media owns payment-proof purpose, owner/object/version bindings, upload/finalize/scan/private read/revocation/retention.
Image-only proof requires actual permitted processed object; hint-only intake follows accepted normalization and bounds.
Scan success means a processing/access prerequisite, not payment authenticity; unsafe/foreign/revoked objects stay inaccessible.
Generic events/Reporting exports/customer receipts exclude proof bytes, hint, signed URL, phone/address/plate and merchant secrets.
Guest submit/read/recovery depends on E/A accepted capability/claim/expiry contract; no phone-based financial ownership.

## 6. Deduplication, ordering and durable financial commit

Keep command identity, provider delivery identity, external transaction identity and refund execution identity separate.
The existing proposed external uniqueness is `(provider, recipient merchant, external transaction ID)` [R2:193–196].
Provider environment/account/ID-kind distinctions must be explicitly resolved; test/live or payment/refund namespaces cannot collide silently.
These are release requests, not fabricated accepted native identifiers or a locally forked schema.
A notification delivery/event ID is not automatically the payment transaction ID; one transaction may have valid status updates.
Freeze each provider's stable delivery/revision semantics so a new finality/reversal observation is not discarded as a duplicate credit.
Persist business uniqueness beyond replay-cache lifetime: one credit, one allocation effect, one refund and one compensation identity.
For accepted broker event identity: same bytes/hash is no-op; changed content is quarantined; stale versions cannot regress facts.
For provider status updates: apply the documented transition/version/finality rules, not a generic overwrite-by-arrival-time.
Out-of-order refund/reversal before original payment remains unresolved and repairs from authorized owner evidence.
Scope command key by owner/contract major/current actor-or-delegation/operation/business target; freeze canonical fingerprint.
Bind beneficiary/method/provider/merchant/Money/policy/revisions/evidence/allocation/refund/reason/approval/compensation refs.
Exclude tokens, signed URLs and transport tracing; publish set/order/duplicate semantics rather than private canonicalization.
Same key/meaning replays durable original outcome after current access checks; changed meaning conflicts.
Different keys cannot repeat the same financial business effect; timeouts never justify a replacement payment/refund identity.
Commit applicable state, unique evidence/effect, receipt, journal, audit and Outbox in one Billing transaction [R2:279–288].
Intent/proof creation has no fabricated money posting or refund allowance; consumers commit Inbox/effect/checkpoint before ACK.
Raw SQL balance, immutability, correct accounts/currencies and minimum privileges must survive concurrent commit and replay.
Provisioning regrants runtime UPDATE/DELETE on all tables [R11:98–106]; a one-time REVOKE alone is insufficient.
B owns local schema/new append-only migrations; any shared privilege/provisioner adjustment belongs to E.
Do not blindly copy Catalog final-attempt lease behavior or D broad unique-error→DUPLICATE catches [R12].
These are static adoption risks, not executed W05 failures; prove exhausted-work recovery and winning receipt/hash reconciliation.

## 7. Cancellation, late settlement and durable compensation

C Booking owns cancellation and recovery coordination; Scheduling alone releases/reacquires capacity [R2:211–237].
Billing records eligibility assessment/financial effects under current approved policy, never a serviceAllowed or restored-capacity flag.
Cancel-before-capture can extinguish due only under policy; it cannot refund money that was never collected.
Cancel-after-credit/collection preserves original credit/receipt/custody and creates separately authorized recovery.
Late credit after intent/hold expiry, cancellation or method change records money once and an explicit disposition.
Do not discard financial truth for an expired UI operation, auto-confirm Booking or resurrect the original reservation/assignment.
Publish a durable compensation record with original C operation, payment/obligation/reservation refs, reason/policy and owner child refs.
Each child has a stable business identity and queryable pending/unknown/terminal outcome; restart resumes the same effect.
Local rollback can undo only an uncommitted local transaction; it cannot undo an executed provider refund or peer commit.
Rebooking/reacquisition requires explicit current Catalog/Pricing/Scheduling/Booking acceptance; it is a distinct customer decision.
Compensation exhausted/escalated status stays visible under an assigned owner; deadlines/retry/escalation budgets remain unapproved.

## 8. Refund caps, unknown execution and cash custody

Publish refundable cap derivation from independently verified original captured/collected funds, allocation and approved policy.
For one payment/currency, confirmed refunds + active reserved/in-flight/unknown amounts must not exceed that approved cap.
The cap cannot exceed eligible captured funds; fees, partial/overpayment/dispute/reversal treatment require explicit accounting policy.
Reserve atomically under payment/allowance concurrency; one refund business identity reuses one reservation across retry keys.
Different approved partial refunds can reserve distinct amounts only within the same cumulative bound [R2:159–179].
Persist reservation, immutable original refs, current approval, execution eligibility and stable provider attempt before external send.
Documented idempotency/status lookup controls resumption; a provider that lacks safe retry needs approved reconciliation, not blind resend.
Submission accepted/timeout/disconnect/5xx is pending or UNKNOWN; none proves funds returned or definite failure.
UNKNOWN retains allowance and original operation; elapsed time alone never releases it or permits another refund.
Not-sent cancellation needs durable evidence execution did not begin; terminal-failure release needs documented finality evidence.
Confirmed refund requires independent provider/bank/cash-delivery evidence bound to original payment and exact Money.
Confirmation, linked immutable reversal/receipt, consumed allowance, audit and Outbox commit once; original receipt stays immutable.
Late contradictory provider outcome is quarantined for owned reconciliation, not optimistic release followed by a second debit.
Cash refund recording needs approved payer/payee/current authority, actual delivery evidence, reason/policy and stable business identity.
Refund from holder cash and refund from treasury require explicitly approved custody/settlement effects; neither is inferred here.
Wallet references Billing posting/reversal and owner checkpoints; it cannot edit balances or operate a second financial ledger.
Reassignment does not transfer already held cash; handover declaration is not treasury acceptance [R5:101–128].
Lost Billing response or delayed Wallet projection repairs through original posting/operation refs; no replacement money movement.

## 9. Required acceptance and sequencing

All cases below are **UNEXECUTED** requirements, not a test result or accepted W05 runner.
Prove forged/missing/replayed signature, byte alteration, wrong account/currency/amount/reference/direction/finality.
Prove real received-but-unallocated mismatch separately from unauthenticated/wrong-merchant evidence and approved matching.
Prove duplicate native transaction/delivery IDs, cross-merchant/provider/environment collisions and conflicting evidence.
Prove same-key replay/changed body/different-key same business effect/two-verifier and concurrent partial/full refund races.
Prove revoked reviewer/approver/guest/delegation before read/commit/queued execution and private Media foreign/quarantine/revocation.
Prove cancellation/expiry/method-change races and late/duplicate/reordered credit without capacity resurrection.
Prove crashes before send, after send before reply, after provider success before commit, after local commit/outbox before ACK.
Prove unknown provider outcome retains allowance; restart/query reconciles once; terminal failure/cash delivery evidence resolves correctly.
Prove real owned DB migrations/upgrade/SQL immutability/account bounds/runtime privileges plus real broker Inbox/Outbox delivery.
Prove permitted genuine sandbox verification/refund with redacted evidence; synthetic callbacks remain separately labeled fixtures.
Disabled/untested required provider, absent merchant access or unavailable genuine external evidence blocks applicable launch acceptance.
Sequence E accepted Identity/guest/Gateway/contracts/resources → C narrow Booking/change binding → B obligation/intent authority.
Then C Media payment-proof purpose → B ingestion/review/verified-credit/allocation and refund providers → C cancellation coordinator.
Then D/A/C actual review/recovery/receipt journeys against merged producers; initial narrow provider gates need no future app cycle.
Keep parent INTEGRATION_PENDING until all listed combined-source cases, latest-target candidate and actual resulting-target gates pass.
W06 handoff requests confirmed-posting, Wallet approved credit/hold/capture and Subscription activation/reversal; no W06 implementation.

## 10. Existing diagnostics only

Actual root scripts: `pnpm run build:domain`, then `pnpm run test:domain` [R13].
B-only derived invocation after current-source compilation: `node --test --test-reporter=tap --test-name-pattern='^(quote|ledger):' tests/domain.test.mjs`.
This is not a named W05 gate; excluded Booking/event cases report skips and must be stated as excluded, not accepted.
Domain build writes ignored root/package dist outputs, compiles peer domain helpers, and does not implement any finance producer.
All five B packages lack test:unit; Catalog/Billing lack test:runtime; Pricing/Wallet/Subscription expose foundation test:runtime only.
Their existing nine-case Nest suites cover health/wiring/config and an ephemeral HTTP server, not a real financial DB/provider.
No new tautological unit tests should be created to imply absent payment/refund features passed; this audit ran none.

## Immutable source references

[R1]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/architecture/parallel-contract-release.json#L20
[R2]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/docs/parallel/B/W04/W05_CONTRACT_PACKET.md#L3
[R3]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/architecture/parallel-ownership.json#L17
[R4]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/services/billing/src/domain/ledger.ts#L7
[R5]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/docs/parallel/B/W04/CASH_JOURNEY_AND_DURABILITY.md#L47
[R6]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/docs/parallel/B/W01/PROVIDER_ACCEPTANCE.md#L34
[R7]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/apps/api-gateway/src/index.ts#L51
[R8]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/apps/api-gateway/src/infrastructure/http-client.ts#L23
[R9]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/apps/api-gateway/src/application/gateway.service.ts#L86
[R10]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/services/identity/src/application/identity-auth.service.ts#L380
[R11]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/infra/postgres/provision.sh#L98
[R12]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/docs/parallel/B/W04/CASH_JOURNEY_AND_DURABILITY.md#L139
[R13]: https://github.com/baraabd/carwash-platform/blob/3ce756cd39a9b0c1013043cee0ca1bb183466da7/package.json#L20
