# P03-D3: admin live operations and cash finance console

Parent task: P03-D, "admin live operations and cash finance operations".
Parent status: **INTEGRATION_PENDING**.

This child is the console half of P03-D. It carries the unreviewed **P02-D2**
operations console (commit `feat(admin-web): operations console for booking
discovery and technician review (P02-D2, wip)`, plus its uncommitted browser
suite and document; see `P02-D2_ADMIN_OPERATIONS_CONSOLE.md`). It extends that
console to three staff roles:

- **operations**: live operations;
- **finance**: cash and payments;
- **super-admin**: both.

It is not production-ready and not deployed. On `main` none of its owner reads
or commands are reachable, because the Gateway routes are missing
(CR-D-P02-01, CR-D-P03-02, CR-D-P03-06). All browser evidence is
**candidate-tree** evidence.

## Scope

| Path | Change |
| --- | --- |
| `apps/admin-web/src/domain/access.ts` | Six capabilities and four screens; finance and super-admin added |
| `apps/admin-web/src/domain/assignment.ts` | Which Dispatch command each status allows; offer target validation |
| `apps/admin-web/src/domain/finance.ts` | Exact money formatting and parsing (integer minor units, never float, never rounded); reconciliation validation |
| `apps/admin-web/src/api/kpis.ts` | Reporting operations and cash KPIs (P03-D1) |
| `apps/admin-web/src/api/live.ts` | Booking read; Dispatch reads and `offer`/`reassign`/`unassign`; Communications delivery state |
| `apps/admin-web/src/api/finance.ts` | Billing obligation read and attempt reconciliation |
| `apps/admin-web/src/api/http.ts` | `412` maps to `CONFLICT` (stale `expectedRevision`); success results carry the request's correlation id |
| `apps/admin-web/src/ui/dashboard-screen.ts` | The approved "لوحة التحكم" (dashboard) screen, fed by Reporting KPIs |
| `apps/admin-web/src/ui/booking-detail.ts` | Booking detail with one section per owner, plus Dispatch commands |
| `apps/admin-web/src/ui/bookings-screen.ts` | Live technician column from Dispatch (one read per zone on the page) |
| `apps/admin-web/src/ui/payments-screen.ts` | The approved "المدفوعات" (payments) screen: cash KPIs, obligation lookup, reconciliation |
| `apps/admin-web/src/index.ts`, `index.html`, `src/ui/i18n.ts`, `src/production.css` | Routing, role gating of the navigation, both sections, copy, and CSP-safe KPI colours |
| `apps/admin-web/test/live-finance.test.mjs` | Unit tests for the new rules |
| `tests/production/D/admin-live-finance.browser.mjs` | Three-role browser journeys on real services |
| `tests/production/D/admin-operations.browser.mjs` | P02-D2 suite updated: operations now lands on the dashboard; the detail dialog is owner-sectioned |
| `docs/production/D/P03_CANDIDATE_GATEWAY.patch` | The exact Gateway change requested in CR-D-P02-01, CR-D-P03-02 and CR-D-P03-06, used only to build the candidate |

No dependency, lockfile, shared package, Gateway, Identity or another lane's
service is changed.

## Who decides what

| Surface | Owner (source) | Mutation |
| --- | --- | --- |
| Dashboard KPI cards and panels | Reporting `kpis/operations` (derived, with freshness) | none |
| Bookings list | Reporting projection (P02-D1) | none |
| Technician column (live) | **Dispatch** `GET assignments?zoneId&from&to` | none |
| Detail: booking | **Booking** `GET bookings/:id`. Contact and address are not kept or shown | none |
| Detail: live assignment | **Dispatch** `GET bookings/:id/assignment` | **Dispatch** `offer`, `reassign`, `unassign` (`operations.dispatch`) |
| Detail: notifications | **Communications** staff read (P03-D2) | none |
| Detail: derived history | Reporting holds and assignment milestones | none |
| Payments cards and state table | Reporting `kpis/cash` (derived, with freshness) | none |
| Obligation and attempts | **Billing** `GET obligations/:id` | **Billing** `payment-attempts/:id/reconciliation` (`billing.reconcile`) |

The console stores nothing as a source of truth. After every command it
renders the owner's own answer, and it shows the request's correlation id as
"رقم المتابعة" (follow-up number). `localStorage` holds only the language.

### Roles (presentation gating; Gateway and owners enforce again)

| Role | Dashboard | Bookings and live assignment | Assignment commands | Technicians | Payments | Reconcile |
| --- | --- | --- | --- | --- | --- | --- |
| `operations` | yes | yes | yes | yes | no (disabled and "forbidden"; Gateway 403) | no |
| `finance` | no | no | no | no | yes | yes, with `billing.reconcile` (#109) |
| `super-admin` | yes | yes | yes | yes | yes | yes, but Billing refuses reconciling one's own payment |
| customer, technician, guest | the whole console shows "not allowed"; every admin route returns 403 | | | | | |

### Command safety

- Every Dispatch and Billing command carries an `Idempotency-Key` created once
  per intended change.
- A timeout, network loss or 5xx after a write is **UNKNOWN_OUTCOME**. It is
  never shown as success. The form locks to the same command and target; only
  "إعادة إرسال الأمر نفسه" ("resend the same command") is offered, with the
  same key, so the owner replays and does not act twice (journey O2).
- A stale `expectedRevision` (Dispatch 412, Billing 409/412) is a
  **CONFLICT**. The console re-reads the owner and shows its current state
  instead of retrying.
- Amounts typed by finance are parsed into integer minor units with the
  obligation's currency and scale. Extra decimals are refused, never rounded.
  The console never computes "paid": only Billing's `financialStatus` is shown.

## Declared differences from the approved reference

The reference CSS is shipped unchanged. P02-D2's differences (D2-SD-01..12)
still apply. These are new, each forced by real data, security or a missing
owner capability. None is a restyle.

| Id | Where | Difference | Reason |
| --- | --- | --- | --- |
| D3-SD-01 | Dashboard header | `h1` is "لوحة التحكم" (dashboard); the reference greets "مرحباً أحمد 👋" ("Hello, Ahmad 👋") and shows a fixed date chip | No demo person is shown; Identity holds no display name |
| D3-SD-02 | Dashboard KPI row | Same five `card kpi` cards and icon colours. The labels are today's bookings, assigned jobs, awaiting assignment, median time to assign, and assigned after start | Revenue, active customers and rating have no source yet; these are the KPIs Reporting derives |
| D3-SD-03 | KPI icon colours | Set by `data-tone` in `production.css` with the reference's exact five colours | The CSP forbids the reference's inline styles |
| D3-SD-04 | Dashboard panels | Kept: "حالة الحجوزات" (booking status, derived statuses). Added in the same `card panel` + `mini-list` form: assignment states, and assignment timing (median / 90%), with field stages "غير متاحة بعد" (not available yet). Omitted: revenue chart, service mix, live map, recent bookings, system health, quick actions, pending items | No owner source for the omitted panels; no invented numbers (CR-D-P03-03) |
| D3-SD-05 | Dashboard and payments | A freshness strip, plus a "partial" chip when a source is not FRESH | A projection's age must be visible |
| D3-SD-06 | Bookings table, "الفني" (technician) column | Dispatch's assignment status chip and short resource reference, instead of a technician name | Workforce publishes no name read; Dispatch knows the resource only |
| D3-SD-07 | Booking detail | Reference modal with four owner sections (Booking, live assignment, notifications, derived history), each labelled with its owner | The reference has no booking detail design |
| D3-SD-08 | Assignment commands | Form inside the detail modal: resource id and technician account id, then "إرسال عرض" / "إعادة الإسناد" / "إلغاء الإسناد" (send offer / reassign / unassign) | No approved design; Dispatch has no technician search to pick from (CR-P02-C3 §5) |
| D3-SD-09 | Payments cards | Same three `card simple` cards. Labels: awaiting cash collection, awaiting reconciliation, paid (per Billing) | Monthly total and refund requests have no source; amounts sum per currency, so the cards show counts |
| D3-SD-10 | Payments table | Rows are Billing cash states (state, count, outstanding per currency, oldest since), not individual payments | Billing has no attempt or payment list (CR-D-P03-04 §3) |
| D3-SD-11 | Payments | A lookup card ("رقم المطالبة المرجعي", obligation reference) under the table. "مطابقة اليوم" ("reconcile today") focuses it | The only discovery path until Billing lists attempts |
| D3-SD-12 | Reconciliation dialog | Reference modal with outcome and statement amount | No approved design |
| D3-SD-13 | Navigation | Entries a role cannot open are disabled with a "forbidden" title. "المحافظ" (wallets / custody) stays disabled | Custody is PR #111 (unmerged) and its permissions are ungranted (CR-B-08) |

The English mode follows the reference: only `data-i18n` elements translate;
the English admin design is pending (DESIGN_LOCK §7).

## Evidence

Candidate tree `9d5307e69ec80ec681ff85beeaf7a40753da934c` (tree
`4fbc4219a6487a9ad866a3a61f2c50442b23ef51`). It is built as follows:

- start from `origin/main` `a14997a`;
- merge #110 (`dbc4f33`), #116 (`ed47b27`) and #109 (`86eb45f`);
- merge this branch;
- add one local commit applying `P03_CANDIDATE_GATEWAY.patch`.

The commands, with the acceptance stack from
`node scripts/dev/acceptance-infra.mjs up`:

```
pnpm generate && pnpm build && pnpm --filter @carwash/booking build:tests
node scripts/production/D/run-real-infra.mjs --evidence docs/production/D/evidence/p03-d-candidate-real-infra.json
node scripts/production/D/run-real-infra.mjs --browser --evidence docs/production/D/evidence/p03-d-candidate-browser.json
```

| Family | Result |
| --- | --- |
| Lane D real infrastructure on the candidate (Reporting, Communications, Configuration and inbox suites; migrations, hardening, drift) | **PASSED 75/75** |
| Three-role browser journeys O1, O2, F1, S1, D1 and M1, plus V1 screenshots (`admin-live-finance.browser.mjs`) | **PASSED 7/7** |
| P03 surfaces accessibility: dashboard, booking detail, payments, reconcile dialog | **PASSED** (no serious or critical) |
| P02-D2 journeys J1-J6 and V1 (`admin-operations.browser.mjs`) | **PASSED 7/7** |
| P02-D2 surfaces accessibility | **FAILED**: `.page-head p` contrast is 4.43:1, a defect of the approved reference; owner decision CR-D-P03-09 |
| Owner audit: every Dispatch command (`offer.created`, `assignment.reassigned`, `assignment.unassigned`) and the Billing reconciliation record the staff actor and the correlation id of the console request | **PASSED** (`evidence/p03-d3/browser-report.json`) |
| admin-web unit tests (`apps/admin-web/test/*.test.mjs`) | PASSED 14/14 |
| `pnpm typecheck`, `pnpm test:unit` (558/558 on the branch, 561/561 on the candidate), design lock 12/12, `check-design-reference`, boundaries, ownership, Prettier, Lane E web-runtime gate 12/12, typed ESLint overlay on `apps/admin-web/src` | PASSED |

The browser evidence JSON reports `sourceDirty: true` only because the run
writes its screenshots and reports into `docs/production/D/evidence/` while
it runs. The real-infrastructure run is clean.

## Not proven here (blockers)

- **CR-D-P02-01, CR-D-P03-02, CR-D-P03-06 (Lane E):** Gateway routes, query
  allowlist and `anyPermission`. Until they exist, every console read on
  `main` is 404 and is rendered as "unavailable".
- **#109 (Lane E, open):** `billing.reconcile`. Without it every
  reconciliation is 403 ("not permitted").
- **CR-D-P03-01:** Dispatch and Billing events are unpublished, so the KPIs
  have no live producer.
- **CR-D-P03-03:** field progress (en route, arrived, washing) has no owner
  source.
- **CR-D-P03-04 / #111 / CR-B-08:** custody, handover and settlement screens.
  The "المحافظ" (wallets) entry stays disabled.
- **CR-D-P02-06:** lint coverage for `apps/admin-web/src/**/*.ts`.
- `architecture/implementation-status.json` and `server.mjs` keep
  `foundation-only` (E-owned gates).
- No device matrix, screen-reader session, low-bandwidth test or production
  fonts. Chromium only, on one Windows host.
