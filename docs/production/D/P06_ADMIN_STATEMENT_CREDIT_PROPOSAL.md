# Admin statement-credit modal proposal — not approved


The existing Admin modal has an outcome and observed amount but no independent
statement selection. F1's original `PAID` and audit assertions remain unchanged;
the app still receives `PROVIDER_CREDIT_REQUIRED` for direct manual `MATCHED`.

The test-only `statement-credit-review.mjs` helper captures the original modal,
then a separate proposal with a selected pending credit and masked merchant,
reference, statement evidence, date and review status. The proposed action reads
“اعتماد القيد وتخصيصه”. The selected record is created through Billing HTTP by a
different Finance account; it is not approved or allocated during this preview.
The helper disables submission, asserts no mutation request occurred, restores
the original DOM and leaves the original acceptance journey in force.

Canonical browser artifacts will contain `statement-credit-candidate.png`,
`statement-credit-proposal-candidate.png` and the proposal entry in
`browser-report.json`. These are review evidence, not design baselines or a green
financial journey. A decision on the visible selection/evidence interaction is
still required before the production app adopts it. The approved implementation
must retain explicit mismatch errors and frozen same-key recovery after uncertainty.

The backend now supplies a published read-only selector at
`GET /internal/v1/billing/payment-attempts/:attemptId/statement-credit`, exposed
through the Finance-only Gateway alias. It resolves exactly one independent,
pending statement record using the owner's current reference, merchant, amount
and obligation facts. The response carries the exact credit/obligation revisions,
masked account and reference, shortened evidence fingerprint and recorded times.
An absent, ambiguous, mismatched, consumed or self-recorded credit is refused.
Reading creates no approval, allocation, receipt, audit entry or journal; the
later explicit command rechecks every invariant. These backend capabilities do
not activate the unapproved modal or satisfy its pending browser journey.
