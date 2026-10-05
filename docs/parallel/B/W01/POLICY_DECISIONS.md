# Business, provider and privacy decisions

Status: **open decision register**, not an approved policy. No owner response was
received to the Paymera/Wallet choices presented during preparation. An unanswered
question is not approval. Existing UI/F001 requirements remain in force.

| ID   | Exact decision required                                                                                                                                                                                | Decision owner / dependency                                 | Current status and affected gate                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| B-01 | Accept full `BASE_W01`, owner registry, bootstrap lease exact paths/expiry, W02 schema versions and test-resource allocations                                                                          | E                                                           | Missing published registry; dependent writes/barrier blocked                                                             |
| B-02 | Is Paymera required for initial full launch, explicitly deferred, or excluded? If required, does it service an existing method or require an exact owner-approved UI change?                           | Product owner + provider owner                              | OPEN; no fourth method and no silent exclusion; full-launch scope gate blocked                                           |
| B-03 | Supported settlement/display currencies, minor-unit exponent per currency, denomination conversions, max amount and effective policy revision                                                          | Business/accounting owner + providers                       | OPEN; SYP/SAR demo values are not policy; W02 price acceptance blocked                                                   |
| B-04 | Real package/add-on rates by vehicle category; included add-ons; zone/travel fees; tax/invoice treatment; quantity and rounding order/tie rule                                                         | Business/accounting owner                                   | OPEN; no invented prices, zero tax, two-decimal assumption or helper-derived rounding                                    |
| B-05 | Quote TTL, price-change honouring, revocation conditions, idempotency replay/tombstone lifetime and maximum command deadline                                                                           | Business owner + E/B                                        | OPEN; no numerical defaults promoted to production                                                                       |
| B-06 | Cancellation windows, no-show/completed-work rules, partial refunds, charges, refund authority/approval separation, unknown-outcome handling                                                           | Business/accounting owner                                   | OPEN; Billing/Booking W03–W05 acceptance blocked                                                                         |
| B-07 | Custody holder: individual technician, team, or both? Recipient treasury/company identity, handover frequency, thresholds, shortage/overage handling, collection/correction/acceptance grants          | Business/accounting owner + C/E                             | Technician/team cash custody required by reference; exact model OPEN; W04 acceptance blocked                             |
| B-08 | Required Wallet balances/holds and purpose; customer stored value/funding/withdrawal included or explicitly outside initial scope                                                                      | Product/accounting owner                                    | Internal custody is required; other holders/purposes OPEN. Wallet name creates no customer cash product                  |
| B-09 | Customer wash plans, price, entitlement units/expiry, reserve/consume trigger, freeze/cancel/renewal/refund; remaining approved subscription inventory                                                 | Product/accounting owner                                    | Customer subscriptions present in inventory; exact policies OPEN. No provider plans, payroll or automatic debit approved |
| B-10 | Promotion eligibility, dates/timezone, stacking, max uses/budget, per-owner limits, include/exclude rules and reservation/redemption timing                                                            | Product/accounting owner                                    | Required promotions present in inventory; limits OPEN; quote calculation is not redemption                               |
| B-11 | Actual merchant agreements/account IDs, payment verification and refund protocol documents, a usable provider test environment, and designated responsible contacts                                    | Provider/business owner                                     | Not supplied; W05/full electronic-payment launch acceptance blocked                                                      |
| B-12 | Export/deletion intake and fulfillment ownership, requester verification, permitted financial export fields, retention categories/authority/durations, anonymization rules, legal hold/backup handling | Privacy/business owner with appropriate policy review + D/E | OPEN; no legal retention period invented; no deletion of posted journal history                                          |
| B-13 | Aleppo coverage/hours and employment/operating model needed for finance fees, collection authority and settlement                                                                                      | Business owner + A/C                                        | Real inputs OPEN; company-team assumption is not confirmed policy                                                        |
| B-14 | Exact production data/copy/states replacing SAR/Riyadh/Card examples and any missing financial/English states                                                                                          | Design/product owner + A/C/D                                | Locked references unchanged; no unapproved screen/copy change                                                            |
| B-15 | Guest capability expiry/revocation, finance-resource ownership, account claim/transfer and revised guest Booking event contract                                                                        | E + A/C                                                     | Current Identity/event vocabulary cannot represent this; W02 prerequisite                                                |

## Recording a resolution

For each item record the exact answer, approver identity, source/link, effective
revision/date, approved affected actors/UI, acceptance evidence and any expiry.
Do not paste merchant secrets, credentials, real account numbers or customer data
into this register. A contact may be named only when genuinely supplied.

E must publish accepted values/contracts at the barrier. Drafts may use clearly
marked test policies in isolated tests; those fixtures never enable production
and never close real provider or integrated journey acceptance. Missing applicable
policy fails closed as configuration unavailable, not as a silently zero fee/tax
or accepted default currency.

## Privacy requirements owned by B

- Receive an authenticated/scoped request reference from the D/E-owned intake;
  B verifies resource ownership/authority again before fulfilling finance work.
- Define export contents and redaction for Billing payments/refunds/posting
  references, approved Wallet custody records and Subscription entitlements.
  Export must not disclose another customer, technician, merchant secret or proof
  without explicit object authorization. Audit generation/download/revocation.
- Separate requester-facing deletion acknowledgement from actual domain erasure,
  pseudonymization, restriction, legal hold and backup lifecycle. Report precise
  outcomes; intake success does not promise completed deletion.
- Immutable financial history and reconciliation references remain intact; apply
  only approved anonymization of permitted identity/contact fields. Retention
  periods and jurisdiction are unresolved, not engineering guesses.
- B supplies domain requirements to D/Media/Identity. No shared database reads,
  unsigned anonymous export links or posted-ledger deletion scripts.

## Launch implication

W01-B cannot be `DONE` while its base/contracts and required decisions remain
unaccepted. Provider access and policy decisions remain visible full-launch
blockers. A narrower release requires an explicit scope decision; this packet
does not grant one. The 5–7 day target is conditional, not an acceptance waiver.
