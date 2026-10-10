# P04-D2: admin payment verification, mismatch, refunds and booking exceptions (console)

Parent task: P04-D. Parent status: **INTEGRATION_PENDING**.

This child is the console half of P04-D. It consumes Support's exception
cases (P04-D1, PR #126) through the Gateway routes requested in CR-D-P04-04.
On `main` none of those routes exist, so all browser evidence is
**candidate-tree** evidence. It is not production-ready and not deployed.

## What changed for staff

| Who | Where | What |
| --- | --- | --- |
| finance | Payments → obligation | Each attempt offers **"فتح حالة مراجعة"** (still under review in Billing) or **"دفع متأخر"** (any other attempt). An obligation with money received offers **"طلب استرداد"**. The P03 direct reconciliation without a reason is removed: every payment decision now has a reason, a note and evidence. |
| finance | Case dialog | Approve match, reject mismatch, mark unknown, accept a late payment, refund (needs a second finance reviewer), or close without action. Amounts are exact minor units; extra decimals are refused, never rounded. |
| finance (second reviewer) | Disputes → case | Approve or reject a refund proposal, with a note. The proposer never sees these controls, and Support and the database refuse them anyway. |
| operations | Booking detail | **"إلغاء الحجز"** and **"إعادة الجدولة"** open a case. A reschedule window is entered in Damascus time and sent as exact UTC instants. |
| support desk | Disputes | Reads every queue; decides nothing. |
| everyone with a case | Disputes ("مركز النزاعات") | Queue, oldest first, filtered to the viewer's desk; open or all statuses. |

What a case shows:
- Support's record: kind, status, summary, who opened it and when.
- The owner's state when the case was opened, and the owner's state **now**, read live as the viewer.
- Every decision, with its reason, evidence, amount or window, the four-eyes approval and the **owner's answer**.
- The audit trail, with correlation ids.

"Paid", "refunded" or "cancelled" are shown only as the owner's answer.

## Command safety

- One `Idempotency-Key` per intended opening, decision or approval.
- A lost answer (timeout, reset, 5xx) is **UNKNOWN**. The form locks to the same request, and only **"إعادة إرسال الأمر نفسه للمالك"** is offered, with the same key. Support replays, and the owner acts at most once (X2).
- A decision whose owner answer is unknown, or blocked because the owner's command is unpublished, can be resent from the case. The resend uses Support's frozen owner command.
- The Gateway reports every owner `409` as `CONFLICT` and drops the owner's code (CR-D-P04-04). On `CONFLICT`, the console:
  - when opening a case: looks up the open case for the subject and shows it;
  - when deciding: shows "a new decision must wait until the current one is settled".

## Declared differences from the approved reference

The reference CSS ships unchanged. P02-D2 and P03-D3 differences still apply.

| Id | Where | Difference | Reason |
| --- | --- | --- | --- |
| D4-SD-01 | Disputes header and table | Same `page-head`, `card panel table-wrap` and the six columns. Rows are Support cases. "القضية" is a short case reference, not `DSP-204`. "الحجز" is the booking, or "مطالبة" plus the obligation for payment cases | Real data; payment cases have no booking reference in Billing |
| D4-SD-02 | "السبب" column | The case kind ("مراجعة دفع", "طلب استرداد", "دفع متأخر", "إلغاء حجز", "إعادة جدولة") | Support's kinds |
| D4-SD-03 | "الأولوية" column | Derived from the status only: outcome unknown or refused by the owner = عالية; finished = منخفضة; otherwise متوسطة | Support stores no priority; nothing is invented |
| D4-SD-04 | "الحالة" column | Support's status in words, including "بانتظار المالك" (owner command unpublished) and "النتيجة غير معروفة" | Real states |
| D4-SD-05 | Disputes toolbar | A `toolbar` with a kind and an open/all filter, as on the reference bookings screen | A queue needs a filter; the reference toolbar style is reused |
| D4-SD-06 | Case dialog | Reference modal with owner-labelled sections: case, owner state then, owner state now, decisions, decision form, audit | The reference has no case design |
| D4-SD-07 | Payments third card | Restored to the reference label **"طلبات استرداد"**, fed by open refund cases. P03 showed "مدفوع" there (D3-SD-09) | A source now exists |
| D4-SD-08 | Every modal | The modal body scrolls inside the viewport and is keyboard-reachable. Initial focus still goes to the first control | A case dialog can be taller than the screen; WCAG 1.4.10 and axe `scrollable-region-focusable`. Reference forms are short, so their rendering is unchanged |
| D4-SD-09 | Navigation | "النزاعات" is enabled for finance, operations and the support desk | Support's read grants |

## Evidence

The candidate tree is built from:
- `origin/main` `c65db70`;
- #126 (P04-D1) and this branch;
- one local commit applying `P03_CANDIDATE_GATEWAY.patch`;
- one local commit applying `P04_CANDIDATE_GATEWAY.patch`.

The exact heads, the tree and the results are in the PR and in `evidence/p04-d2/`.

| Family | Result |
| --- | --- |
| admin-web unit tests (`apps/admin-web/test/*.test.mjs`, Node type stripping) | see PR |
| X1–X5 (`admin-exceptions.browser.mjs`) | see PR |
| Dialog accessibility (case, booking case, support desk case) | see PR |
| Disputes page accessibility | **FAILED**: `.page-head p` contrast 4.43:1, from the approved reference (CR-D-P03-09, owner decision) |
| V1 disputes screenshots at 390, 768 and 1440 px | see PR |
| P03 and P02 console journeys on the same candidate | see PR |

Two harness changes follow `main`; neither touches another lane's code.
- **Workforce eligibility.** Since #112, Dispatch checks Workforce eligibility before every offer. The P03 operations journeys now use Lane C's declared Workforce double, `tests/production/C/support/dispatch-workforce-double.mjs`, unchanged.
- **Billing helper grant (CR-D-P04-05).** Proven refused first, then applied by the suites.

## Not proven here (blockers)

- CR-D-P04-04 and the open P02/P03 Gateway requests: no admin route on `main`.
- CR-D-P04-01 (#125) and CR-D-P04-03: refunds, cancellations and reschedules stop at "بانتظار المالك".
- CR-D-P04-06: the finance queue lists only attempts someone opened a case for.
- CR-D-P03-09: the reference contrast.
- No device matrix, screen reader, low-bandwidth test or production fonts. Chromium only, on one Windows host.

## Rollback

Redeploy the previous admin-web bundle. There is no server state in the console.
