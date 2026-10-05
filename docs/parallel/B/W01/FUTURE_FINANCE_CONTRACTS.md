# W03–W07 financial contract reservations

Status: `PROPOSED_NOT_ACCEPTED`, revision `0.1.0`. These versioned commands/events
are declarative next-wave design proposals only. They add no source, published
package, endpoint, migration, payment or real-money permission. E publishes the
accepted versions per barrier; B-01 through B-15 still apply. Structural command
schemas are in `future-finance-contracts.schema.json` with explicit references to
the W02 candidate types; W01-B does not demand their implementation now.

All mutating commands use the W02 verified-actor/operation/key fingerprint,
durable terminal outcome, exact minor-unit Money and UTC rules. The caller cannot
forge body ownership. Sensitive grants/current authorization fail closed;
response timeout stays unknown. Referenced Money/currency/amount is independently
checked against owner state, never trusted merely because schema-valid.

ProofSubmitCommand requires at least a nonempty transaction hint or a private
Media object reference, matching the approved either-or proof intake. Neither
qualifies as received money. Empty submissions are rejected. PaymentIntentCommand
is the external electronic-payment proposal; cash uses its own receipt flow.
Normalize a transaction hint consistently with the approved reference; when
present it must satisfy its 4–64 character Arabic/Latin/digit/space/underscore/
hyphen rule. An image-only submission must reference an existing owned, processed
Media object. Schema validity cannot prove that object exists or is authorized.

| Wave / candidate V1 command                                      | Owner, input and authoritative result                                                                                                                                                                           | Events / recovery / consumers                                                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W03 `pricing.quote-bind.v1`                                      | Pricing receives quote/Booking refs, expected quote/policy revisions and authorized owner delegation; verifies current validity and records immutable binding outcome                                           | `pricing.quote-bound.v1`; same-key binding replay; lifetime/one-booking binding policy needs B-05; C consumes real merged Pricing                                         |
| W03 `billing.obligation-create.v1`                               | Billing receives Binding/Booking refs and authorized owner delegation; reads accepted authoritative quote/binding; computes fixed Money internally, persists obligation and posting refs as applicable          | `billing.obligation-opened.v1`; no client total; C coordinates real Scheduling/Booking; duplicate Booking reference cannot create another charge                          |
| W04 `billing.cash-record.v1`                                     | Billing receives obligation/assignment refs, expected revision and declared collected Money; independently verifies assignment/grant/work rule and exact approved amount policy; returns receipt/posting refs   | `billing.cash-recorded.v1`; stable business collection ref; C/D show cash receipt separately from work/custody                                                            |
| W04 `billing.cash-reverse.v1`                                    | Billing receives receipt, expected revision and approved correction reason; creates authorized linked reversal, never edits the old posting                                                                     | `billing.cash-reversed.v1`; C/D reconcile historical receipts and Wallet effects through contracts                                                                        |
| W04 `wallet.custody-handover.v1`                                 | Wallet receives approved holder/recipient, receipt/posting refs, expected revision and declared Money; validates owned reconciled custody and records pending transfer                                          | `wallet.custody-handover-pending.v1`; approved holder model B-07; outage/reordering leaves pending, no second ledger                                                      |
| W04 `wallet.custody-accept.v1`                                   | Wallet receives handover ref/revision and independent treasury receipt evidence ref; current treasury grant and discrepancy policy; Billing posts required authority through a durable coordination step        | `wallet.custody-settled.v1` only after accepted receipt/posting references reconcile; unknown stays pending; a holder cannot authorize its own receipt by default         |
| W05 `billing.payment-intent.v1`                                  | Billing receives obligation/ref/revision and an approved method; derives recipient/amount, gets provider intent under actual accepted adapter, returns honest pending/protocol data                             | `billing.payment-intent-created.v1`; provider auth/idempotency/query/recovery must be genuine. Paymera mapping B-02 unresolved; no fourth method invented                 |
| W05 `billing.proof-submit.v1`                                    | Billing receives obligation, provider transaction hint and optional owned private Media object ref; verifies evidence-object authorization; returns review case, never paid                                     | `billing.proof-review-requested.v1`; duplicate evidence/reference handling and Media access are contracted; A/C/D display pending review                                  |
| W05 `billing.settlement-verify.v1`                               | Internal authorized verifier receives obligation, provider+merchant+external transaction, immutable independent evidence ref and observed Money; matches final eligible receipt/status and records posting once | `billing.payment-verified.v1`; screenshot/client result not authoritative; replay/conflict/quarantine; C handles late settlement without resurrecting capacity            |
| W05 `billing.refund-reserve.v1`                                  | Billing receives verified payment, expected revision, requested Money, approved reason and optional support decision ref; atomically reserves allowable remaining refund and returns operation/status           | `billing.refund-reserved.v1`; concurrent requests cannot exceed allowance; unknown provider outcome keeps reservation; D does not write ledger                            |
| W05 `billing.refund-resolve.v1`                                  | Internal authorized verifier receives refund, independent provider/bank evidence and confirmed/definitively-failed status; confirms linked reversal or releases reserved allowance                              | `billing.refund-confirmed.v1` or `billing.refund-failed.v1`; evidence-linked exact amount/ref; pending is not terminal failure; authorized real refund execution separate |
| W06 `wallet.hold-reserve.v1`                                     | Wallet receives approved balance holder/purpose, Booking/ref/revision and Money; checks Billing-backed available state and records hold                                                                         | `wallet.hold-reserved.v1`; no unapproved funding/withdrawal product; C coordinates reserve/consume/release with stable keys                                               |
| W06 `wallet.hold-resolve.v1`                                     | Wallet receives hold/ref/revision and consume/release request with required Billing posting refs; applies one allowed transition                                                                                | `wallet.hold-consumed.v1` / `wallet.hold-released.v1`; reconcile before completion; unknown never credits spendable balance optimistically                                |
| W06 `subscription.entitlement-reserve.v1`                        | Subscription receives owned subscription/Booking refs, expected revision and permitted entitlement units; atomically reserves against current plan/state                                                        | `subscription.entitlement-reserved.v1`; last-unit race safe; C consumes/releases through saga; units/expiry B-09                                                          |
| W06 `subscription.entitlement-resolve.v1`                        | Subscription receives reservation/revision and consume/release under approved trigger; result references Booking/policy                                                                                         | `subscription.entitlement-consumed.v1` / `subscription.entitlement-released.v1`; no duplicate consumption; renewal does not book a slot/debit automatically               |
| W07 `pricing.promotion-publish.v1`                               | Pricing receives expected revision and approved immutable PromotionPolicy ref; verifies actual policy and persists promotion                                                                                    | `pricing.promotion-published.v1`; discount/reservation/redemption limits/compensation part of accepted B-10 policy; D/C/A consumers after real producer                   |
| W07 `billing.privacy-fulfill.v1`, Wallet/Subscription equivalent | Each owner receives authenticated intake ref, subject-resource authority, export/delete/anonymize request and approved policy ref; returns exact audited fulfillment state                                      | Owner-specific fulfillment event with nonpersonal refs; intake is not fulfillment; retention/posted history/legal holds enforced, B-12                                    |

## Shared response and event requirements

Every result needs `schemaVersion`, immutable resource IDs, `aggregateVersion`,
policy revision, current state, immutable related refs and evaluation timestamp.
Money appears only when relevant and always carries accepted currency/policy.
Read/status endpoints are scoped to verified object owner or accepted grant;
wrong-owner reads are non-enumerating. Publishing proof/contact/plate fields or
merchant secrets in event broadcasts is forbidden.

Events use the exact existing V1 envelope documented in the W02 packet. Proposed
data keys are aggregate ID/revision, causal Booking/obligation/receipt/posting
refs, approved policy revision and financial amount only if an accepted consumer
needs it. E resolves exact payload schemas/ACLs before publication. A table name
or proposed event here cannot be counted as a published schema.

Providers commit state/receipt/Outbox together; consumers commit Inbox/state
before ACK. Unique business refs and event fingerprints prevent duplicate effects;
revision gaps trigger authorized read reconciliation. Booking owns cross-service
compensation deadlines; each owner controls its release/refund/correction.

Provider-first child PR acceptance requires real owned DB/HTTP/authorization and
contract evidence; all consuming full journeys pass on real merged providers
before those consumer PRs merge. None of the schemas in this proposal substitutes
for B-02/B-11 provider protocol documents or authorizes live money/refunds.
