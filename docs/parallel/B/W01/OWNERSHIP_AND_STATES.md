# Financial ownership and state proposal

Status: unaccepted W01-B proposal. F001 ownership is authoritative; transition
names below are candidate contracts, not implemented endpoints or approved policy.

## Facts that must remain independent

| Owner              | Authoritative fact                                                 | Cannot infer                                        |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------- |
| Catalog            | Published definitions/compatibility/duration revision              | Price, capacity or payment                          |
| Pricing            | Immutable quote with server expiry and policy revisions            | Capacity hold, Booking or promotion redemption      |
| Scheduling         | Active/expired/committed capacity hold                             | Paid state or work assignment                       |
| Booking            | Durable orchestration and historical snapshots                     | Payment, custody or entitlement authority           |
| Dispatch/Workforce | Current eligible assignment/work execution                         | Receipt, custody settlement or technician earnings  |
| Billing            | Obligation, verified receipt/refund and balanced posting           | Restored capacity or treasury handover              |
| Wallet             | Approved actor's custody/balance/hold backed by Billing references | A second ledger or fourth checkout rail             |
| Subscription       | Entitlement availability/reserve/consume/release                   | Automatic payment or occupied-slot rebooking        |
| Reporting          | Event-derived read projection with revision/as-of time             | Current authoritative balance or financial approval |

## Candidate transitions and rejection boundaries

| Aggregate          | Candidate transitions                                                          | Required guard/effect                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalog definition | draft → published revision → retired                                           | Approved publisher; expected revision; existing quotes/history never rewritten                                                             |
| Price version      | draft → published revision → superseded                                        | Approved money/policy data; publish audit/outbox; old quote validity follows explicit policy                                               |
| Quote              | issued → expired or revoked                                                    | Server time; immutable snapshot; revocation policy must be approved; quote issuance reserves no resource                                   |
| Payment obligation | open → verification-pending → verified; mismatch/review branch                 | Authoritative quote/booking refs; amount/currency/recipient exact match; proof is evidence intake only                                     |
| Refund             | requested → reserved → verification-pending → confirmed or definitively failed | Authorized reason/limits; atomic refundable-amount reservation; timeout remains unknown/pending, never releases reservation optimistically |
| Cash receipt       | recorded once → correction by linked reversal                                  | Current assigned collector, permitted work state and approved cash policy; immutable Billing posting/business reference                    |
| Custody            | pending collection reconciliation → held → handover-pending → settled          | Wallet uses Billing references; independent treasury receipt/acceptance; short/over disputes stay explicit                                 |
| Entitlement        | available → reserved → consumed or released                                    | Subscription-local concurrency control; Booking saga key; last entitlement never consumed twice                                            |

Payment states are not forced into a single `PAID` boolean: amount due, verified
receipts, pending refund reservations and confirmed refunds are independently
queryable. Verified money remains recorded if the booking/capacity expires.
Cash collection and company handover are separate auditable operations.

Posted Billing journals are balanced per currency with valid accounts, unique
business-effect references and immutable rows. Corrections use linked reversal
and replacement postings, never edits/deletes. Wallet cannot write or read
Billing tables; it reconciles posting references through accepted APIs/events.
No payroll, customer funding/withdrawal, exchange conversion, marketplace payout
or automatic recurring debit is introduced by these proposed states.

## Distributed recovery

Each producer persists business mutation, idempotency receipt and outbox in one
local transaction. Each consumer commits inbox and owned state before ACK.
Same event ID with a conflicting fingerprint is quarantined; out-of-order
aggregate revisions cannot overwrite newer state. A gap triggers an authorized
owner-state refresh, not guessing from reporting data.

Booking owns the durable saga/deadlines. Scheduling releases capacity, Dispatch
releases assignment, Subscription releases entitlement, Wallet releases approved
holds and Billing verifies/refunds/reverses money through their own commands.
Each compensation has a stable child key, fingerprint and recorded outcome.

When verified payment arrives after capacity expires, Billing records the money
once. Booking records an exception and follows an approved refund/reallocation
decision; no payment event resurrects capacity automatically. Any approved new
allocation must ask Scheduling for current capacity under a new operation.
Absent policy leaves manual-review/refund-pending, not a fabricated success.

Unknown write outcome after timeout is resolved with the same key/request or an
authorized status read. A new key is not a safe retry. No exactly-once broker or
cross-service transaction guarantee is claimed.

## Authorization and privacy

Use current Identity role/session revocation and object-level checks, extending
grants through E. Guest capabilities must be bounded to their owned resources;
no body/header supplied owner is trusted. A technician may collect approved
assigned-job cash but cannot verify external settlement or approve their own
treasury handover. Exact grants/separation/holder model remain decision items.

Private proof media is referenced by Media object ID with upload, processing and
later access authorization. Neither permanent public URLs nor proof/contact/
plate data belongs in financial events, logs or metrics. Authorized export and
deletion intake are separate from fulfillment. No financial history is deleted
to satisfy an undefined privacy policy; retention/anonymization awaits the
recorded policy in `POLICY_DECISIONS.md`.
