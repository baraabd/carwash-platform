# P03-C5 — operator-web: production port of the approved technician prototype

Status: **IMPLEMENTED against fixture doubles; INTEGRATION_PENDING** (real-service
journeys run in the P03-C integration candidate; gateway routes are a Lane E request).
Base: `main@a14997a20b85341a24f17e7878d2a188eea3fe36`. Interfaces: `P03-C-interfaces.md` (C5).
Reference (immutable): `design/reference/approved/washgo-technician-interactive.html`
(122636 bytes, sha256 `d330aa74…455efc`). No dependency was added.

## 1. Port method

- **CSS verbatim.** The reference `<style>` block is split, unchanged, at its own comment
  boundaries into `src/styles/01-reference-base.css`, `02-reference-sheets-motion.css`,
  `03-reference-compact.css`. The visual suite asserts the concatenation equals the
  reference block byte for byte; Vite ships it without minification (`cssMinify: false`;
  the built CSS is byte-identical). These files and `index.html` (verbatim SVG sprite) are
  deliberately not run through Prettier.
- **Markup verbatim.** Render functions are typed string templates producing the same DOM,
  classes, ids, `data-action`/`data-*` attributes, ARIA, SVG and Arabic copy. Inline
  `style="…"` attributes become `data-style` and are applied through the CSSOM
  (`dom.ts::applyInlineStyles`) because the production CSP is `style-src 'self'`.
- **Behaviour verbatim**: history push/pop, `html[data-view]`/`html[data-motion]`,
  `--dock` + ResizeObserver, sheet focus trap/return and outside-click close, ripple,
  450 ms `primary()` lock, reveal/slider with reduced-motion jump, zoom bounds, focus restore
  via `data-focus`, `loadLocalPhoto` rules (JPEG/PNG/WebP, 20 B–10 MiB, decode, ≤40 M px,
  white-backed JPEG ≤1000 px @ .76, data URL ≤ 850000).
- **State** comes only from the server. localStorage key `washgo-operator-preferences-v1`
  holds `{motion, taskFilter, collectionFilter}` only (asserted by the journey suite).

| Reference function | Port |
| --- | --- |
| `$`, `$$`, `escape`, `I`, inline styles | `src/dom.ts` |
| `money`, `digitValue`, `validCash` | `src/money.ts` (BigInt minor units) |
| `STAGES`, `PHASES`, `CHECKS`, `stageIndex`, `collected`, `outstanding`, `activeWork`, `total`, `checkList` | `src/model.ts` |
| `brand`, `plate`, `car`, `status`, `paymentLabel`, `paymentPill`, `jobCard`, `renderStepper`, `heading`, `paymentSummary` | `src/views/common.ts` |
| `renderHeader`, `renderNav`, `renderHome`, `renderTasks`, `renderCollections`, `renderProfile` | `src/views/screens.ts` |
| `details`, `mapMarkup`, `route`, `photoMarkup`, `photos`, `wash`, `comparison`, `handoff`, `completed`, `renderTask`, `renderTaskDock` | `src/views/task.ts` |
| `showGuide`, `showBreakdown`, `showHistory`, `resultSheet`, `photoOptions`, `showCash`, `showIssue`, `closeTaskSheet`, notifications/menu/contact/message/arrival/finish/before-view sheets | `src/views/sheets.ts` |
| `nav`, `render`, `refresh`, `updateDock`, `toast`, `showSheet`, `closeSheet`, `primary`, `transition`, `reveal`, `setCompare`, `stopReveal`, click/input/change/popstate/visibility/resize handlers | `src/app.ts` |
| `loadLocalPhoto` + Media upload | `src/media.ts` |
| (new) API client, closed parsers, types | `src/api/client.ts`, `parse.ts`, `types.ts`, `operator-api.ts` |
| (new) pending-design copy | `src/copy.ts` |

## 2. Server mapping

Stage mapping (C4): OFFERED offer → `assigned`; `ACCEPTED/EN_ROUTE/ARRIVED/IN_SERVICE/DOCUMENTING/FINISHED/CLOSED`
→ `accepted/route/before/wash/after/handoff/closed`; `RELEASED` → closed + «أُعيد للإدارة»;
`WITHDRAWN/CANCELLED` are not the technician's work and disappear. The job key is the booking id
(stable across offer → task). `/me/jobs` carries task summaries; every listed task is read from
`/me/tasks/:id`; booking details from `/bookings/:id` (404 → no details, never guessed).

Mutation rules: every mutation carries a fresh-per-intent `Idempotency-Key` that is reused for
every retry of the same intent; task routes carry `expectedRevision` (C4 rows for `notes`,
`accept`, `decline` have none). Success is shown only after a 2xx and a re-read. Errors branch on
`error.code` + `error.reason` (Dispatch `412 REVISION_CONFLICT`; Workforce
`409 CONFLICT/REVISION_CONFLICT`; `TASK_NOT_FOUND`/`TASK_CLOSED` → task removed with a toast).

### All 46 reference actions

| Action | Disposition | Server mapping / reason |
| --- | --- | --- |
| `home`, `tasks`, `collections`, `profile` | ported | navigation only |
| `open-job` | ported | key = booking id |
| `close-sheet` | ported | — |
| `guide` | **removed (PR-01/PR-04/PR-08)** | prototype walkthrough (ADR 0004) |
| `notifications` | ported | lists unclosed server jobs; no push service exists |
| `task-menu` | ported | `help` row only when a task exists |
| `ready` | production-mapped | `PUT /api/operator/availability {status, expectedRevision}` |
| `motion` | ported | localStorage preference |
| `task-filter`, `filter-active`, `collection-filter` | ported | localStorage filter |
| `primary` | production-mapped | assigned → `POST offers/:id/accept`; accepted → `depart`; route → arrival sheet; before → `start`; wash → `document`; after → finish sheet; handoff → cash / handoff sheet |
| `arrived-confirm` | production-mapped | `POST tasks/:id/arrive` (manual confirmation, no GPS claim) |
| `finish-wash-confirm` | production-mapped | `POST tasks/:id/finish` |
| `close-job-confirm` | production-mapped | `POST tasks/:id/close {collection:{outcome:'NOT_CASH'}}` |
| `contact` | ported | name/car/area from Booking; phone is parsed but not shown (no approved call UI) |
| `demo-contact` | **removed (PR-17)** | simulated call |
| `message-preview` | ported | preview only, never sent |
| `breakdown` | production-mapped | Booking lines/total (D2, D3) |
| `history` | production-mapped | Dispatch `history[]` (C4 vocabulary) |
| `zoom-in`, `zoom-out` | ported | illustrative map |
| `photo-options` | ported | — |
| `demo-photo-one`, `demo-photos` | **removed (PR-14)** | illustrations can never be evidence |
| `delete-photo` | production-mapped | `DELETE tasks/:id/evidence/:phase/:slot` |
| `check` | production-mapped | `PUT tasks/:id/checklist/:code {checked}` |
| `before-view`, `result-preview`, `reveal` | ported | server evidence via short-lived `read-url` |
| `cash-dialog` | ported | — |
| `cash-confirm` | production-mapped | handoff: `POST close {CASH_COLLECTED, amount}`; closed: `POST cash-collection {amount}` — exact Booking Money |
| `defer` | production-mapped | assigned: `POST offers/:id/decline {reason:'OTHER', note}`; accepted: `POST tasks/:id/release {reason}` (DEV-01) |
| `cash-issue` | production-mapped | `POST close {CASH_NOT_COLLECTED, reason}` (DEV-02) |
| `payment-followup` | production-mapped | `POST tasks/:id/notes {kind:'PAYMENT_FOLLOW_UP'}` |
| `help` | production-mapped | `POST tasks/:id/notes {kind:'HELP'}` |
| `save-issue` | production-mapped | per mode above; 3–500 chars validated as in the reference |
| `privacy` | **removed (PR-09)** | describes the local prototype only |
| `feedback`, `feedback-save`, `feedback-download` | **removed (PR-10)** | design-approval notes |
| `reset`, `reset-confirm` | **removed (PR-11)** | trial reset |

Non-click handlers: compare-range input, cash input/checkbox, condition note (`PUT condition-note`
on `change`, draft kept in memory), `[data-upload]` (Media flow), `visibilitychange`/`online`
(re-read + resolve pending), `popstate`, `resize`, ResizeObserver, reduced-motion change.

### Media flow
Local processing (reference rules) → WebCrypto SHA-256 → `POST media/uploads` (key) → presigned
`PUT` with the signed headers (`content-type`, `x-amz-checksum-sha256`) → `finalize` (key;
`UPLOAD_MISSING` → re-PUT) → `PUT tasks/:id/evidence/:phase/:slot` (key + revision). A failed PUT
asks `upload-url` on the same reservation. Re-selecting the same image reuses the same reservation
and keys (in memory). Thumbnails use `read-url` (memory only, refreshed before expiry).

### Cash and collections
Booking Money (`amountMinor` string, `scale`) is compared with BigInt; ASCII/Arabic/Persian digits
and separators as in the reference; wrong, partial, over and fractional amounts are blocked; the
declared Money is exactly the booking total. Collections figures use only Dispatch collection
declarations and Booking totals; labels stay «قيمة الطلب… ليست أرباح الفني». A declaration is not a
Billing receipt: the Billing cash-receipt call (PR #111, unpublished) is a **pending integration**.

## 3. Declared visual differences

The visual suite applies these to the raw reference DOM, records each region, and then requires 0
changed pixels. Definitions: `tests/production/C/support/operator-declared-differences.mjs`.

**Production removals (PR)**: PR-01 trial banner `.prototype-bar`; PR-03 «جدول تجريبي»; PR-04 home
walkthrough panel; PR-05 design footers; PR-06 profile demo team line and «حساب عرض» pill; PR-07
profile storage row; PR-08/09/10/11 profile guide/privacy/feedback/reset; PR-12 «بيانات العميل
توضيحية»; PR-13 illustrative ETA/distance metrics (`.route-stats`, card keeps spacing with the
reference `mt` utility); PR-14 demo photo buttons; PR-15 «تم حفظ ملخص التجربة…» note; PR-16
notifications demo note; PR-17 simulated call and demo-data note; `<noscript>` prototype notice
(invisible); meta description.

**Copy edits (PC)** — trial/local qualifiers that would be false in production (PENDING OWNER COPY
review): PC-01 plate «تجريبية»; PC-04 «بيانات تجريبية»; PC-05..07 aria labels; PC-08 «في العرض»;
PC-09 «استراحة تجريبية»; PC-10 «جدول العرض»→«جدولك»; PC-11/12 tasks; PC-13..16 collections;
PC-17 «محفوظة محليًا»; PC-18 «للتجربة»; PC-19 contact label; PC-20/21 route; PC-22 photo label;
PC-23/24 photo/condition notes; PC-25 comparison caption; PC-26/27 released; PC-28 closed dock hint;
PC-30 handoff note; PC-32..34 completion; PC-35/36 sheet titles/menu; PC-37 «الإجمالي التوضيحي»;
PC-38/39 history; PC-40..42 result/photo sheets; PC-43..47 arrival/cash sheet; PC-48..50 issue sheet;
toasts with «تجريبيًا/محليًا» trimmed the same way.

**Data gaps (D)**: D1 booking reference (first 8 hex of the id); D2 service/add-on names → reference
labels «الخدمة»/«الإضافات», service detail omitted, add-on reminder shortened; D5 seed-id icon rule
→ spark; D7 distance/ETA removed; D8 technician name (avatar shows the reference user icon, greeting
«مرحبًا», profile title «حسابي»); D9 wallets never shown verified (no Billing projection); D10 Booking
refuses details before acceptance and after release (degraded card/details; strict-C3 screens
compared with a declared mask band, CR-requested screens compared unmasked); vehicle type `large`
uses the SUV art; plate `null` omits the plate and its hint; a job not on today shows its weekday
instead of «اليوم» (PENDING).

**Deviations needing an owner decision (DEV)**: DEV-01 the reference handles `defer` at the accepted
stage but shows the control only when assigned; the same control is shown on the accepted dock so
C4 `release` is reachable. DEV-02 C4 records the cash outcome inside `close`, so «تسجيل التحصيل» and
«لم أستلم المبلغ» close the task in one server step; the reference's intermediate
"cash recorded, not yet closed" state is no longer reachable. DEV-03 the notification dot shows only
when an unclosed job exists.

## 4. Production states pending owner design (TI-D03)

Rendered only with existing components (`#storage-warning` bar, `#toast`), texts in `src/copy.ts`:
loading, offline, UNKNOWN outcome, unauthenticated (no login screen, TI-D02), forbidden, load
error, revision conflict, task lost (reassigned/withdrawn), server refusal, upload rejected,
booking unavailable before acceptance, busy.

## 5. Offline / UNKNOWN policy

- A timeout, network failure, malformed 2xx or retryable refusal is **UNKNOWN**, never success.
- The intent (request bytes + key) stays in memory; the app re-reads, shows the pending state, and
  resends the identical request with the same key after 1.5 s, 4 s, 10 s, then on `online`,
  `visibilitychange` or when the user presses the same control (same task revision).
- A definitive answer for that key resolves it (server replay of the stored outcome).
- Limits: intents are memory-only; a reload drops them, then the server state is re-read and the
  user acts again (stage routes are revision-fenced; `notes` has no fence, so a duplicate note is
  possible after a reload — documented, not hidden). Uploads resume only when the same image is
  selected again.
- Observed in tests: Chromium itself transparently resends a request whose reused keep-alive socket
  drops; the fault harness uses a 1 s window so the application-level path is exercised.

## 6. Evidence

| Command | Scope | Result at authoring |
| --- | --- | --- |
| `pnpm --filter @carwash/operator-web run typecheck` / `build` / `test:runtime` | app | pass / pass / 3 of 3 |
| `node --test tests/production/C/operator-web-journey.test.mjs` | Chromium + harness + **fixture doubles** | 9 of 9 |
| `node --test tests/production/C/operator-web-a11y.test.mjs` | Chromium + fixture doubles; axe + keyboard + motion | 3 pass, 1 **todo = blocker** (§7) |
| `node --test tests/production/C/operator-web-visual.test.mjs` | reference vs candidate, 6 widths, 46 screens (276 captures) | see `.acceptance/production-C/operator-web/visual/visual-summary.json` |
| `node scripts/production/C/operator-web-acceptance.mjs` | all of the above with exact source record | `.acceptance/production-C/operator-web/acceptance.json` |
| `node scripts/check-design-reference.mjs`, `node scripts/check-boundaries.mjs` | guards | pass |

The journeys and visual comparisons run against **fixture doubles** of identity, workforce,
dispatch, booking and media (`tests/production/C/support/operator-api-fixture.mjs`), aligned with
the provider facts of the P03-C candidate, through a **harness** of the requested gateway routes
(`operator-gateway.mjs`, which serves the built dist with the production CSP). Real-service
journeys run in the P03-C integration candidate by pointing the harness upstreams at the services.
Visual captures use software rasterisation (`--disable-gpu`, measured: GPU raster made two loads of
the same page differ by 2–3 anti-aliased pixels); reference and candidate always share the flags.

## 7. Not proven / open

- **Accessibility blocker (TI-D13 extension):** axe finds serious color-contrast on elements beyond
  the registered `.design-footer` debt (e.g. `.brand small`, plate labels, muted headings, stepper
  labels). Each node renders with the same tag, class, colours, size and weight in the unmodified
  reference, i.e. it is inherited from the byte-identical CSS; the port introduces none. Fixing it
  is a visible change: owner decision required. Recorded as a `todo` test, not a pass.
- ESLint: the repository config lints `apps/operator-web/src/**/*.ts` without a TypeScript parser
  (written for the JS-compatible bootstrap); the port was linted with the services' type-aware
  block added in a temporary config. Lane E must extend `eslint.config.mjs` (out of this scope).
- No real gateway, Identity session, Dispatch/Booking/Workforce/Media service, object store, CSP
  deployment, or Billing receipt was exercised. No production readiness is claimed:
  `/health/ready` stays 503.
- English/LTR (TI-D01), real maps/geo (TI-D11), notifications, phone call UI, login (TI-D02),
  payment execution policy for pending wallets (TI-D05) remain open.
- Fonts are system fonts of the test host; parity is for this browser/OS, not all devices.
