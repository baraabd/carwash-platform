# P02-D2: admin operations console (booking discovery and technician review)

Parent task: P02-D. Parent status: **INTEGRATION_PENDING**.

This child is the consumer half. It ports the approved admin reference's
shell, "الحجوزات" (bookings) screen and "الفنيون" (technicians) screen into
`apps/admin-web`, and wires them to their owners through the Gateway. It is
not production-ready and not deployed. On `main` it cannot reach its reads,
because the Gateway routes are missing (CR-D-P02-01).

## Scope

| Path | Change |
| --- | --- |
| `apps/admin-web/index.html` | Reference shell and both screens, modal and toast; ids and accessible names added |
| `apps/admin-web/vite.config.ts` | Loads the reference `<style>` block at build time, byte-for-byte, after checking the registered SHA-256; CSS is not minified |
| `apps/admin-web/src/production.css` | Only rules the reference lacks, using its own tokens |
| `apps/admin-web/src/domain/*` | Pure rules: capabilities, discovery windows, decision validation |
| `apps/admin-web/src/api/*` | Same-origin Gateway client with typed failures, strict response readers, session/sign-in, review decision |
| `apps/admin-web/src/ui/*` | Shell (navigation, language, focus-trapped modal, toast), both screens, sign-in |
| `apps/admin-web/server.mjs` | CSP gains `connect-src 'self'`; nothing else changes (still `FOUNDATION_NOT_READY`, see below) |
| `apps/admin-web/test/console.test.mjs` | Unit tests on the TypeScript sources (Node type stripping) |
| `tests/production/D/admin-operations.browser.mjs` | Real-service Chromium journeys, accessibility and visual evidence |
| `docs/production/D/P02_CANDIDATE_GATEWAY.patch` | The exact Gateway change requested in CR-D-P02-01, used only to build the candidate |

No dependency, lockfile, shared package, Gateway or another lane's service is
changed. The console is written in TypeScript and the DOM without React: the
React dependencies are still pending at E (CR-D-P01-02). This also keeps the
markup a direct port of the reference instead of a re-rendering.

## Who decides what

| Surface | Source | Mutation |
| --- | --- | --- |
| Booking list, filters and detail | Reporting projection (P02-D1) through the requested `admin.operations.*` routes | none |
| Freshness strip | The same response's per-source `freshness` | none |
| Technician table and eligible count | Reporting Workforce-eligibility projection | none |
| Verification decision | Workforce, through the published `admin.review` route (`verification.review`, Idempotency-Key) | Workforce only |
| Sign-in and session | Identity, through the published auth routes (HttpOnly cookies, double-submit CSRF) | Identity only |

The console stores nothing as the source of truth. After a decision it shows
Workforce's own answer (`status`, `validUntil` or reason, `version`).
`localStorage` holds only the language preference.

### Permission gates (presentation; owners enforce again)

| Role | Bookings | Technicians table | Review decisions |
| --- | --- | --- | --- |
| `operations` (`operations.dispatch`) | yes | yes | no: the panel says so, and the Gateway returns 403 |
| `reviewer` (`verification.review`) | no: "forbidden" state, and the Gateway returns 403 | yes | yes |
| customer, technician, guest | the whole console shows "not allowed"; every Gateway read is 403 | | |

### States

Every read renders exactly one of: loading (`aria-busy`), rows, empty,
unauthenticated (sign-in), forbidden, rate-limited, malformed answer (nothing
shown), or unavailable (with retry).

A decision whose answer is lost (timeout, network failure, 5xx) is
**UNKNOWN_OUTCOME**. It is never shown as success. The controls lock to the
same decision, and only "resend the same decision" is offered, with the same
Idempotency-Key. Workforce then answers with the real state: a 409 for a case
that is no longer pending is shown as "an earlier decision may have been
recorded".

## Declared differences from the approved reference

The reference CSS is shipped unchanged. These are the production differences,
each forced by real data, security or a missing owner capability. None is a
restyle.

| Id | Where | Difference | Reason |
| --- | --- | --- | --- |
| D2-SD-01 | Sidebar | Screens this task does not implement keep their entry but are `disabled` (cursor `not-allowed`, title "not implemented yet") | No inferred screens (AGENTS.md); `dashboard` is not the default screen |
| D2-SD-02 | Sign-in | Staff sign-in uses the reference modal and form styles | No approved admin sign-in design exists |
| D2-SD-03 | Bookings table | Customer, vehicle, package, technician and payment cells show "—" (with an explanatory title); the customer cell shows an opaque short reference | These are Booking/Dispatch facts that the projection must not copy (CR-D-P02-05) |
| D2-SD-04 | Bookings toolbar | The status options are the four derived statuses, not "new/confirmed/in progress"; search takes a full booking reference | The projection's honest vocabulary; there is no free-text search over personal data |
| D2-SD-05 | Bookings | A freshness strip appears between the toolbar and the table; a "load more" button appears under it | The projection is not the authority, and its age must be visible; keyset paging |
| D2-SD-06 | Booking detail | The reference modal shows derived detail and slot history, and states that the authoritative read is pending | The reference has no booking detail design |
| D2-SD-07 | Technicians KPIs | The first card reads "مؤهلون حسب الإسقاط" with the projected count; pending-approvals and rating show "—" | "Active now" and ratings have no source yet (Workforce list API, Reviews) |
| D2-SD-08 | "طلبات الانضمام" panel | A case-reference form replaces the list | Workforce has no list or read API for cases (CR-D-P02-04) |
| D2-SD-09 | Review dialog | The reference modal holds the decision form (approve with validity date, or reject/correct with a closed reason) | The reference has no review design |
| D2-SD-10 | "+ حجز يدوي" and "+ إضافة فني" | Rendered but `disabled`, with an explanatory title | No Booking API or Gateway route for these actions |
| D2-SD-11 | Profile and account button | Shows the role and an opaque subject reference instead of a name, and acts as sign-out | Identity holds no display name; no demo person is shown |
| D2-SD-12 | Topbar | The inline flex style moved to the `.topbar-start` class (same declarations) | The CSP forbids inline styles |

The English mode follows the reference exactly: only elements marked
`data-i18n` translate. The English admin design is still pending
(DESIGN_LOCK §7).

## Evidence

### Unit and static (this branch alone)

- `pnpm --filter @carwash/admin-web typecheck` and `build`.
- `node --test apps/admin-web/test/console.test.mjs apps/admin-web/test/runtime.test.mjs`.
- Strict typed ESLint over `apps/admin-web/src` with the repository's
  TypeScript rules, using a local, uncommitted overlay. See CR-D-P02-06: the
  root config gives this path browser globals but no TypeScript parser, so
  `pnpm lint` cannot parse these files until E extends it.

### Browser journeys (candidate tree only)

```
# candidate = origin/main + P02-D1 + P02-D2, with P02_CANDIDATE_GATEWAY.patch applied (uncommitted)
pnpm generate && pnpm build
node scripts/production/D/run-real-infra.mjs --browser --evidence <file>
```

Real: headless Chromium; the built bundle served by `server.mjs`; the Gateway
(with the proposed patch); Identity (OTP delivery captured in-process);
Workforce; Reporting (P02-D1); PostgreSQL; Redis. A test-only ingress puts
`/api/*` and the bundle on one origin, as the deployment ingress would.
Projection rows are written through Reporting's own projector, because no
producer emits the contracts yet.

| Journey | What it proves |
| --- | --- |
| J1 | Sign-in is required; a wrong one-time code is refused; axe on the dialog |
| J2 | Booking discovery: every seeded booking exactly once across pages, derived status chips, the status filter, row detail with slot history, search by reference, the freshness strip, a Reporting outage shown as unavailable with recovery |
| J3 | Review approval through the console: validation before send, Idempotency-Key, Workforce readiness changes, a repeated decision becomes a 409 conflict message |
| J4 | Correction (reject `EVIDENCE_INCOMPLETE`) and technician resubmission; with Workforce down the outcome is UNKNOWN, the decision locks, and the re-send uses the same key and then succeeds |
| J5 | Cross-role denial: customer and technician refused by the console and the Gateway; reviewer refused bookings; operations refused a hand-made review POST with a valid CSRF token |
| J6 | LTR switch and its persistence, reduced motion (no sidebar transition), the mobile menu at 390 px |
| V1 | Reference, candidate and diff PNGs for both screens at 390, 768 and 1440 px |
| A11Y | No serious or critical axe WCAG 2.1 AA violation on sign-in, bookings, booking detail, technicians or the review dialog |

The results, axe output and screenshot hashes are in
`docs/production/D/evidence/p02-d2/`.

**The visual diff is evidence, not a pass.** The candidate shows real
projected rows, while the reference shows illustrative rows and a different
default screen. A pixel threshold here would be meaningless. Review the
triplets against the declared-difference table above.

## Not proven here (blockers)

- CR-D-P02-01: Gateway query and any-of permission support plus the routes.
  Without them, on `main` every operations read is a 404 shown as
  "unavailable".
- CR-D-P02-04: Workforce case list and read.
- CR-D-P02-05: Booking staff read.
- CR-D-P02-06: lint coverage for `apps/admin-web/src/**/*.ts`.
- `architecture/implementation-status.json` (E) still lists admin-web as a
  `technical-boot-shell-only`. E should update it when it accepts this.
- `server.mjs` keeps `stage: foundation-only` / `FOUNDATION_NOT_READY`.
  E-owned gates (`tests/parallel/E/web-runtime.test.mjs`, image probes) pin
  those values, and the app is genuinely not business-ready.
- No device matrix, screen reader session, low-bandwidth test or production
  fonts. Chromium only, on one Windows host.
