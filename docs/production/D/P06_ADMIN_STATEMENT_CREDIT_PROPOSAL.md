# Admin independent statement-credit review — PR #147 repair

Status: **implemented as a bounded correction of the existing finance flow;
final-candidate browser CI required**. This document supersedes the test-only
proposal previously stored at this path. It does not claim an earlier design
approval or production readiness.

## Why the old journey failed

The existing modal offered `MATCHED` and an observed amount without identifying
an independently recorded statement credit. Billing correctly refused that
manual shortcut with `PROVIDER_CREDIT_REQUIRED`; the browser waited for `PAID`
and timed out. The correction uses the already-published owner read and atomic
allocation endpoints. Billing's financial and separation-of-duties checks are
unchanged.

## Current interaction and owner boundaries

Selecting `MATCHED` reads
`GET /api/v1/admin/billing/payment-attempts/:id/statement-credit`.
The form displays the owner's masked merchant/reference, amount, evidence
fingerprint, transaction/recording times and pending-review status. No record is
selected by default. The reviewer must explicitly select it before the action
**اعتماد القيد وتخصيصه** is available to submit successfully. A refresh button
repeats only the read. Missing, ambiguous, stale, mismatched, consumed or
self-recorded credits remain refusals; reading never approves or settles funds.

The single explicit mutation is
`POST /api/v1/admin/billing/payment-attempts/:id/statement-credit-allocation`,
with `creditId`, `expectedCreditRevision`, `expectedRevision` and the exact
`observedAmount`. The amount must match the selected record. Billing rechecks
reference, merchant, beneficiary, reviewer, status and versions, then atomically
writes approval, allocation, journals, audit, outbox and the command receipt.
Only its returned obligation may be displayed as `PAID`.

`MISMATCHED` and `UNKNOWN` retain the existing reconciliation route. Nothing
turns a customer receipt or an administrator's typed amount into proof of money.

## Uncertainty, races and accessibility

While a command is pending, outcome, amount and statement controls are disabled.
An uncertain write preserves the exact selected credit, both revisions, amount,
route and idempotency key. The retry does not look for a different statement or
create a new financial command. A late selector read cannot unfreeze controls,
and a late command response cannot overwrite a newly opened modal.

Arabic and English copy use the existing modal, labels, select, detail-list,
status and focus primitives. The new selector has an explicit label, its read
status is announced, and the original page/dialog axe checks remain strict.
The original reference HTML and its hashes remain unchanged. Browser evidence
captures the actual corrected modal as `statement-credit-candidate.png`.

## Acceptance coverage

- Pure client tests exercise read-only requests, attempt binding, masked facts,
  invalid/consumed/zero-value records and exact allocation bodies with stable keys.
- F1's real-owner browser journey requires explicit selection, rejects invalid
  precision and a mismatched observed amount before any mutation, waits for the
  owner's `PAID`, and requires both `billing.credit.allocated` (`MATCHED`) and
  `billing.credit.approved` (`ALLOCATED`) audit records by the reviewer.
- F2 refuses a missing statement, then loses the first allocation response **after
  the real owner commits**. The retry must send the same route/body/key, produce
  one approval and allocation, and retain exactly two journals (received/allocated).
- S1 retains the mismatch workflow and proves the beneficiary cannot approve
  their own payment even as super-admin.

These suites are included in the `d-admin-browser` acceptance family. Local
build/type/source/client tests are distinct from the required final-candidate
PostgreSQL/Gateway/Identity/Chromium evidence in CI.
