# P06-C1 — operator-web: technician prototype scope closure

Status: **carried into P06-CLOSE-07** (`P06-CLOSE-07-technician-execution-media.md`), which holds
the current evidence, the real-service results and the blockers.
Authored on `main@66aa752`; carried unchanged in substance onto `main@a84b5ee`.
Reference (immutable, unchanged): `design/reference/approved/washgo-technician-interactive.html`.
Builds on P03-C5 (`P03-C5-operator-web.md`); nothing there is re-decided here. No dependency added.

## 1. Crosswalk: 5 views, 6 phases, 21 sheets, 46 actions

`docs/production/C/P06-C-technician-crosswalk.json` maps every reference surface to a disposition
(`ported`, `production-mapped`, `removed`) and, when production-mapped, to the requested operator
gateway route(s) and the owning service. `tests/production/C/operator-web-crosswalk.test.mjs`
checks it mechanically against the reference file, the app source, the gateway route table
(`support/operator-gateway.mjs`, CR-P03-C5) and the built `dist/`:

| Family | Reference source of truth | Check |
| --- | --- | --- |
| 5 views | app `VIEWS` (`home`, `tasks`, `collections`, `profile`, `task`) | every read is a routed gateway path |
| 6 phases | reference `PHASES` array | identical order/text; each entered by a routed command the app calls |
| 21 sheets | 18 `showSheet` call sites − the shared issue call + its 4 modes | title present in the reference; removed → absent from `dist`; kept → rendered by the app (copy edit needs a `PC-` id); every server route routed and called |
| 46 actions | literal `data-action` values + template-built `primary`/`collections` | crosswalk set equals the reference set; removed → absent from `dist`; kept → handled by the app |
| trial tooling | — | `dist` JS/HTML contain no `washgo-technician-approval-v1`, `prototype-bar`, `design-footer`, «تجريبي/تجريبية/محليًا», reset copy or `Math.random`; at most one storage key |

Removed (unchanged from P03-C5, owner decisions PR-01..17): `guide`, `privacy`, `feedback*`,
`reset*`, `demo-contact`, `demo-photo-one`, `demo-photos`. There is no development tooling in the
production build to exclude: the prototype's trial reset/demo simulation was never ported.
The stylesheet keeps the reference's `.prototype-bar`/`.design-footer` rules byte for byte (unused).

## 2. Production behaviour added

| Id | Change | Why |
| --- | --- | --- |
| PB-01 | Background re-read every 30 s while the page is visible (`backgroundRead` in `app.ts`). Skipped while a sheet is open, a mutation/photo is in flight, an UNKNOWN intent is pending or a text field is focused. Hidden pages do not poll; `visibilitychange` re-reads. | A reassignment, withdrawal, eligibility flag or new offer by operations must reach an open app without a technician action. The reference had no server. |
| PB-02 | Read sequencing (`readSeq`): only the newest started read may replace screen state. | PB-01 makes concurrent reads possible; an older read must never overwrite a newer one (e.g. the re-read after a confirmed mutation). |
| PB-03 | `409 OFFER_NOT_LIVE` / `OFFER_EXPIRED` are "task gone" (lost-task toast, job removed), not a generic refusal. | Dispatch's real refusal for an offer withdrawn/expired before acceptance (assignment race). Previously the lost toast was overwritten by «رفض الخادم…». |
| PB-04 | A field task with `attentionReason: RESOURCE_INELIGIBLE` shows `PENDING.attention` in the existing `#storage-warning` bar on the task view only. A connection state outranks it. The task still advances (Dispatch flags, never cancels). | Revoked eligibility (Workforce suspension relayed to Dispatch) was parsed but invisible. |

PB-04 copy is **PENDING OWNER COPY (TI-D03 extension)**, rendered with an existing reference
component only; no new visual element was introduced.

## 3. Restored invariant (main regression) — already on main

Superseded: main fixed this independently in `1e44ffb` ("restore approved CSS separator byte"), so
P06-CLOSE-07 carries no CSS change. History, for the record: `cf7cf41` ("remove trailing blank line from operator CSS reference") deleted the blank line between
the reference's `@media print` block and the compact block from `02-reference-sheets-motion.css`
to satisfy `git diff --check`. The concatenated port CSS then differed from the reference `<style>`
by one byte and `operator-web-visual.test.mjs` failed at its first assertion on main. The blank line
now opens `03-reference-compact.css` instead: the concatenation is again byte-identical and
`git diff --check` passes. No reference file, hash or threshold was touched.

## 4. Evidence

| Command | Scope | Result at authoring |
| --- | --- | --- |
| `pnpm --filter @carwash/operator-web run typecheck` / `build` / `test:runtime` | app | pass / pass / pass |
| `node --test tests/production/C/operator-web-crosswalk.test.mjs` | static: reference + src + dist + route table | 5 of 5 |
| `node --test tests/production/C/operator-web-field-changes.test.mjs` | Chromium + harness + fixture doubles | 3 of 3 |
| `node --test tests/production/C/operator-web-journey.test.mjs` | Chromium + harness + fixture doubles | 10 of 10 |
| `node --test tests/production/C/operator-web-a11y.test.mjs` | axe + keyboard + motion | 3 pass, 1 todo (contrast blocker, unchanged) |
| `node --test tests/production/C/operator-web-visual.test.mjs` | 6 widths × 46 screens vs reference | see P06-CLOSE-07 |
| `node scripts/check-design-reference.mjs`, `node scripts/check-boundaries.mjs` | guards | pass |

Fixture doubles are not services. Real Workforce/Dispatch/Booking/Media behaviour of the same
scenarios is child C2.

## 5. Not proven / blockers

- **B-P06-C-01 (Lane B + E):** a Billing cash receipt from the technician app. `billing.v1`
  `recordCashCollection` needs `obligationId` + obligation `expectedRevision`, which no technician
  read exposes, and Billing's production `WorkAuthority` is still `UnpublishedWorkAuthority` (503).
  The app's cash declaration stays a Dispatch fact, labelled as not a receipt.
- **Lane E:** CR-P03-C5 operator gateway routes unpublished (the harness stands in); ESLint type-aware
  block for `apps/operator-web/src/**/*.ts`.
- **Owner design:** English/LTR (TI-D01), login (TI-D02), pending-state copy incl. PB-04 (TI-D03),
  contrast debt beyond TI-D13, TI-D05/06/08, PC-01..50, DEV-01..03.
- No production readiness is claimed; `/health/ready` stays 503.
