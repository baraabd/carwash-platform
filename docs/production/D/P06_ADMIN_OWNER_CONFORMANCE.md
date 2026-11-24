# Admin owner conformance repair — 2026-11-22

This change repairs defects found in exact-head CI and adds current real-owner
checks. It does not certify production readiness or approve a new financial UI.

## Observed failures

The PR147 run on `979d399780f8935382dab402a278ddf5685028ff` is retained:

- [Admin browser job](https://github.com/baraabd/carwash-platform/actions/runs/44997840550/job/137132620119):
  O1/O2 received Dispatch `503 DEPENDENCY_UNAVAILABLE`, owner reason
  `ELIGIBILITY_UNAVAILABLE`. Its stack omitted the required Workforce client.
  F1 received Billing `409 PROVIDER_CREDIT_REQUIRED`. J3 sent no second review
  command after two competing asynchronous Reporting reads.
- [D services job](https://github.com/baraabd/carwash-platform/actions/runs/44997840550/job/137132620309):
  Support's setup needed Booking test/runtime modules and Billing runtime modules
  that the clean job had not built. A partial-setup resource leak hid the failure
  details behind the outer timeout.

## Repairs and verification scope

Admin operation acceptance now starts the actual Workforce service. Dispatch
uses a generated workload credential whose Workforce configuration contains
only its digest and `workforce.capacity.read` scope. Operators, verification,
skills, service area and shifts are created through Workforce HTTP commands.
No fixture declares a resource eligible on Dispatch's behalf.

`admin-owner-http.test.mjs` runs real Gateway, Identity, Workforce and Dispatch
against PostgreSQL and Redis. It checks an approved case's repeated decision
returns 409, one offer exists after same-key replay, and actual suspension or a
Workforce outage cannot be treated as eligible. The Scheduling event is applied
through Dispatch's transactional inbox effect; this is not broker evidence.

The console now ignores an obsolete asynchronous navigation before opening a
review dialog. The browser regression controls only delivery order of two real
Reporting responses and verifies that the later response cannot erase a draft.
The original repeated-decision journey additionally checks the actual 409 HTTP
response before asserting its displayed conflict state.

Support setup records each started resource before starting the next and closes
partial stacks. Its obsolete test-only grant to Billing's private ledger helpers
was removed. The current Billing migration uses owner-rights constraint triggers;
the acceptance suite asserts those helpers remain inaccessible to the runtime
identity while exercising real financial commands.

## Reporting calendar boundary

The old console used browser-local calendar arithmetic. October 2026 in
`Europe/Stockholm` spans 31 days plus 1 hour, which violated the published Reporting
31-day range limit. The current owner contract supports UTC days only; an
approved business-timezone policy remains future work. See
[P01-D1 owner scope](P01-D1_INBOX_INTEGRITY_AND_REPORTING_PROJECTIONS.md) and
[the reconciliation policy](../../parallel/D/W07/REPORTING_RECONCILIATION_PLAN.md).

Queries now use UTC calendar days, Saturday-based weeks and months. Browser
display locale does not choose a financial cutoff. Regression tests execute in
Stockholm, Damascus and New York, including DST, midnight and year boundaries.
The 31-day owner limit is unchanged. Admin console/runtime tests are now mandatory
in the Admin browser acceptance family.

## Evidence and remaining blockers

- Supplemental local PostgreSQL 17.12/Redis 8.0.2: all 3 new real-owner HTTP cases
  passed, no skipped, cancelled or todo tests. Canonical CI uses PostgreSQL 16.
- Support without any helper grant: 5 of 8 cases passed, with clean teardown. H1,
  H3 and H4 still expose the obsolete direct `MATCHED` flow. These failures remain
  mandatory gates; no payment was premarked successful to satisfy them.
- The configured provider adapters do not implement verified queries or live
  notifications. A match must use a selected real merchant-statement credit,
  binding it to the exact attempt and requiring a different Finance approver.
  That owner workflow and the missing visible credit-evidence/selection flow
  are separate work; the latter needs a concrete design decision.
- Pinned Chromium, actual images, broker and final-head canonical CI remain
  required. Local HTTP tests and exact reference hashes cannot replace them.

## Selected statement credit closure

The follow-up owner workflow now accepts one explicit pending statement credit
at `POST /internal/v1/billing/payment-attempts/:attemptId/statement-credit-allocation`.
The protected Gateway alias has `billing.reconcile` and a required idempotency
key. Its closed body contains `creditId`, `expectedCreditRevision`,
`expectedRevision` and an exact `observedAmount` Money value.

Billing locks the provider reference, credit and obligation in that order. It
requires the selected record to be the only active credit for this provider and
reference, belong to a currently configured merchant account, and identify this
exact open claim, current intent, currency and outstanding amount. An ambiguous
reference across merchant accounts is rejected until Finance resolves the
independent records. The recorder, approver and payment beneficiary restrictions
apply before any money movement. Approval, allocation, journals, audit, outbox
and the successful command receipt commit in one database transaction. A failed
binding or failed receipt write leaves the statement pending and money unchanged.

The current payment intent contract does not carry merchant transfer instructions.
The selected credit therefore supplies its immutable, configured merchant
account; this change does not infer a customer-selected payee or invent provider
verification. Production merchant approval/material remains an external gate.

Support's `APPROVE_MATCH` and `ACCEPT_LATE_PAYMENT` decisions require
`statementCredit: { creditId, revision }`. Support freezes that selection inside
its owner request and uses the deciding person's credential. A lost response is
recovered by replaying the exact owner command receipt with the same human actor;
another Finance account is refused without altering the unknown decision. An unrelated `MATCHED`
state cannot prove this selection succeeded. Closed or expired owner claims
remain subject to Billing's existing allocation policy; this change does not
invent a late-payment exception.

Supplemental current-source verification:

- 10 real Billing HTTP/PostgreSQL 17.12 cases passed with zero skips: concurrency,
  idempotency collision, role and four-eyes restrictions, exact reference/amount/
  provider/currency binding, removed merchant, stale revisions, ambiguous
  merchants, transaction rollback and malformed closed input. Identity and
  Pricing are explicit HTTP doubles in this isolated owner suite.
- All 9 Support HTTP/PostgreSQL/Redis cases passed with real Identity, Billing,
  Booking and Support. H1/H3/H4 now use a pending statement recorded through the
  actual owner endpoint by a different Finance account. H3 drops a real response
  after commit and recovers by the frozen key. A new case proves same-recorder and
  wrong-claim selections cannot settle money. Private ledger helper privileges
  remain denied. Booking upstreams and Billing Pricing are declared doubles.
- These local runs are supplemental; canonical PostgreSQL 16 CI remains required.
