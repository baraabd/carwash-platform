# W05 lifecycle, financial recovery and producer sequence

**PROPOSED / NOT_ACCEPTED.** Source:
`3ce756cd39a9b0c1013043cee0ca1bb183466da7`. No coordinator/provider implementation
is introduced. The named children below define boundaries to review before coding.

## Independent authorities

| Fact                                                                | Authoritative owner                   | Must remain separate                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Booking lifecycle and orchestration                                 | C Booking                             | Capacity, dispatch assignment, work execution and payment/custody.                                                                        |
| Held/confirmed/released capacity                                    | C Scheduling                          | Late money cannot recreate an expired reservation.                                                                                        |
| Assignment/work grant/revision                                      | C Dispatch/Workforce                  | Reassignment invalidates the old grant; assignment is not collection or settlement.                                                       |
| Received merchant credit, obligation allocation, posting and refund | B Billing                             | Proof approval, request acknowledgement, unmatched credit, allocation, final settlement and returned money.                               |
| Cash custody/balance                                                | B Wallet plus approved custody actors | Customer collection receipt, operator custody transfer, treasury reconciliation and work completion.                                      |
| Entitlement reservation/consumption/release                         | B Subscription                        | Entitlement reservations differ from Wallet balance holds; separate lifecycle and financial dispositions, no silent loss on compensation. |
| Private proof/work media                                            | C Media                               | Upload receipt, scanning/processing and authorized later byte access.                                                                     |
| Support/reconciliation projections                                  | D services/admin                      | Observation/action request is not a new authoritative business write.                                                                     |

The merged B/W04 packet proposes preserving independently verified own-merchant
credit even when amount/currency/reference/Booking state prevents allocation.
That candidate must distinguish `receivedCredit` from `allocationResult`; a wrong
merchant, invalid signature or unproven finality establishes no own verified
receipt. Mismatched credit cannot disappear just because the booking was cancelled.
Its reconciliation/refund/disposition requires the approved B policy.

## Commands and crash windows

Each distributed operation needs owner-local transactional business mutation,
durable operation receipt and outbox. Consumers use explicit deduplication,
business constraints and revision checks; DB receipt uniqueness violations must
not catch unrelated constraint errors and ACK unfinished work. Publish retry
budgets, dead-letter/escalation behavior, reconciliation cadence and measurable
convergence limits before the test. No timing numbers are guessed here.

Idempotency scope includes authenticated actor/merchant, operation type and key;
canonical fingerprint includes all effectful IDs, Money and expected revisions.
Same-key concurrent replay returns one durable result; changed payload conflicts.
Different keys cannot bypass one-credit allocation or remaining-refund constraints.
Do not permanently cache an authorization denial as a successful receipt. Replay
and status lookup recheck current authority without reexecuting the money effect.
Unknown outcome retains the original operation/provider key and reconciliation
handle across process restart; never generate a new charge/refund because a
response was lost. Retention and tombstones must outlive approved retry/replay
windows without erasing financial history.

Test crashes before and after each DB commit, outbox publish/confirm, mark-sent,
consumer mutation/receipt/ACK, provider dispatch and final-result persistence.
After publish-confirm/mark-sent failure replay must be harmless. After external
acceptance/local timeout use independent lookup and the original key. If lookup
or an approved manual route is unavailable, the result stays UNKNOWN/BLOCKED,
with reserved refund allowance and an actionable reconciliation record.

## Competing operations and compensation

| Trigger/race                                    | Required invariant and reviewed transition                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expiry × paid notification                      | Billing preserves verified credit; C rejects resurrection of expired capacity. B/C/product decide unmatched-credit disposition, new reservation/rebooking and refund policy explicitly.                                                                                                       |
| Cancel × payment arrival × reassignment         | C commits a versioned lifecycle fence/operation receipt; Scheduling/Dispatch reject stale commands. B associates credit with the immutable obligation and approved financial disposition. All orderings converge to explicit owner facts without duplicate charge/refund or entitlement loss. |
| Cancel × start/completion                       | Product/C/B define terminal precedence, effective server time, work quiescence and any cancellation fee. Work completion alone never marks money received. No arbitrary last-writer-wins rule.                                                                                                |
| Refund × refund, including different keys       | B atomically reserves remaining refundable allowance against original postings; concurrent partial/full requests cannot exceed it. Dispatch acknowledgement is not returned money; UNKNOWN retains allowance until definitive reconciliation.                                                 |
| Refund finality × delayed paid/reversal message | Original charge/refund/reversal identities and owner revisions determine disposition. Stale notification cannot undo immutable postings or trigger a second refund. Conflicting verified facts enter reconciliation.                                                                          |
| Reschedule × price change/expiry/cancel         | Revalidate current quote/availability and approve the financial amendment. Snapshot/history stays immutable. Slot swap/release order, failed replacement behavior and additional payment/refund are explicit owner policies, not accepted defaults.                                           |
| Cancel/reassign × proof/reviewer action         | Proof remains purpose-bound and privately accessible only under current grants. CAS/current lifecycle fence prevents an obsolete review from allocating money under an expired plan. Independently verified credit remains traceable.                                                         |
| Cancel/recovery × entitlement                   | Persist reserve/consume/release identities and owner receipts independently. Retry/restart cannot double-consume, leak a reservation or erase a consumed benefit. Release versus consume evidence/nullability needs B review.                                                                 |

A proposed coordinator result carries the lifecycle operation ID, immutable
policy/financial-plan revision, current Booking/Scheduling/Dispatch/Billing/
entitlement revision vector, expected fence and per-owner receipts. States expose
pending, partially compensated, unknown and reconciliation-required outcomes;
request accepted is not cancellation/refund completed. Owner policy defines when
the customer-facing operation is terminal. A frontend timeout never decides it.

Do not require a refund to complete before Booking can record a cancellation
request, or a final cancelled Booking before Billing can expose a refund plan:
freeze a narrow prepare/fence + financial-plan contract first. Whether work must
quiesce before plan/commit and how reservations are held during review remain
explicit B/C/product decisions. Historical A/W04 suggests retaining an old slot
while replacing it; C/B have not accepted that default.

## Proposed child sequencing

All runtime children wait for accepted predecessor bases, cash checkpoint,
current authorization/Media contracts, finance policies and provider dossiers.
Each branches from its accepted common base, not a moving peer feature branch.
If financial proof binding is still absent, accept a narrow real B intent/purpose
binding before C Media proof processing, then B proof-intake/review consumers.
A completed proof review must not be required to create its own Media authority.

| Child boundary            | Writer                                                 | Real gate before accepting consumers                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W05-B-VERIFICATION-CREDIT | B; E narrow machine transport/current grants if needed | Real Billing DB/migrations/constraints, approved provider-derived verification or authorized merchant review, immutable receipt/audit, mismatch/unknown/replay/security. No live Booking dependency just to prove received credit. |
| W05-C-LIFECYCLE-BINDING   | C; B reviewed plan provider                            | Narrow real Booking fence/prepare + Scheduling/Dispatch/work status binding and financial-plan contract. Prove ownership and terminal/revision rules before full cancellation orchestration.                                       |
| W05-B-ALLOCATION-REFUND   | B                                                      | Accepted credit + obligation/financial-plan providers, exact Money/current auth, allocation/allowance/refund state and independent result lookup, real DB/HTTP/provider conformance.                                               |
| W05-C-COMPENSATION        | C with real B providers                                | All race orders and crash windows against real owner DB/HTTP/broker; no capacity resurrection, assignment drift, posting duplication or entitlement loss.                                                                          |
| W05-E-BOUNDARY-CONSUMERS  | E platform; A/C/D app writers                          | Published typed clients/routes, private media/current auth/redaction, actual customer/operator/admin consumers and full affected payment/refund/cash journeys before consumer merge.                                               |
| W05-E-COMBINED-ACCEPTANCE | E serializes; owners resolve their defects             | All 40 families, required providers, cash regression, current target/candidate/all impacted apps, device/visual/security/recovery evidence and eligible independent review.                                                        |

These are proposed named slices, not new automatic tasks or permission to write
outside E. Split further if a provider's tests still require its consumer. A
provider fixture remains labeled and cannot close the consumer journey.

## Causal acceptance and evidence

The evidence bundle records full source/head/target/candidate/result SHA+tree,
ordered parents; published contracts/policies/provider-doc hashes; isolated run
manifest and named actors; redacted provider transaction/operation/receipt IDs;
exact Money and each owner revision; every case outcome and failure artifact;
reference/candidate/diff screenshots and device/a11y observations; reconciliation
telemetry, defects, independent review and owned-handle cleanup.

Record provider-derived merchant evidence separately from LOCAL_FAULT_FIXTURE
inputs and actual DB/broker/HTTP/browser execution. Local faults can prove
recovery against accepted real adapters, but cannot establish external payment
finality. Staging acceptance and operational readiness are separate statuses.

Preserve all mandatory workflows and F009 plan/targeted/static/integration/images/
security/codeql/aggregate gates. All three frontend typecheck/build pairs must
actually execute. A synthetic merge object's existence or a head run with the
same tree is not an executed candidate. Recompute when target/head changes;
obtain eligible independent review; verify unchanged refs; use only the authorized
merge process; check the actual resulting target before publishing BASE_W06.
