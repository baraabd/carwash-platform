# C003 — Customer Home / resume / repeat booking entry

Status: React port of the approved customer Home, driven by deterministic fixtures.
This document does **not** claim backend, persistence or production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html` (`homeView()`).
- The file is unchanged by C003 and stays byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL.

## What C003 owns

| Area | Location |
| --- | --- |
| Home screen and its components | `apps/customer-web/src/features/home/**` |
| Home view model (pure) | `apps/customer-web/src/features/home/homeViewModel.ts` |
| Unsent booking draft and entry guard (pure) | `apps/customer-web/src/state/bookingDraft.ts` |
| Start / resume / repeat / follow commands (pure) | `apps/customer-web/src/state/bookingEntry.ts` |
| In-memory session and navigation intents | `apps/customer-web/src/state/**` |
| Deterministic Home scenarios | `apps/customer-web/src/fixtures/customerHomeScenarios.ts` |
| Illustrative catalog display data | `apps/customer-web/src/fixtures/customerCatalogFixture.ts` |
| Shared primitives extracted for Home | `apps/customer-web/src/shared/**`, `src/styles/customer-shared.css` |
| City notice in the header | `apps/customer-web/src/app/CityNotice.tsx` |
| Acceptance | `scripts/c003/browser-acceptance.mjs`, `tests/unit/c003-customer-home.test.mjs`, `.github/workflows/c003-customer-home.yml` |

## Home states

All states come from the reference; none was invented.

| Scenario (`#/?scenario=<id>`) | What Home shows |
| --- | --- |
| `home-empty` (default) | Hero, benefits, payment preview link, two packages, before/after teaser. No conditional card. |
| `home-active-order` | Adds «غسلتك قيد المتابعة» with the order's stage label and «متابعة»; bookings tab badge shows the in-progress count. |
| `home-repeat-order` | Adds «نكرر نفس الغسلة؟» for the most recent completed order. |
| `home-saved-draft` | Adds «حجزك محفوظ، نكمّله؟» with the package and illustrative total, and «أكمل». |
| `home-returning-customer` | Greeting by name, account initial in the header, and all three cards in the approved order. |

An unknown or missing scenario id falls back to `home-empty`. The C002 route fixture id for `/` is still `home-default`.

## Interactions

| Control | Behaviour | Destination |
| --- | --- | --- |
| «احجز غسلتك», package cards | Marks the local draft as started (package preselected for a card). | `/book/0` |
| «أكمل» | Returns to the step the draft was left at, never past missing input. | `/book/<step>` |
| «نكرر نفس الغسلة؟» | Copies the completed order's choices into the draft with a newly offered slot, shows the approved notice. | `/book/6` (review), or the first step still missing input |
| «متابعة» | Opens tracking for the running order. | `/order/<id>` |
| City control | Opens the approved city notice in a modal bottom sheet. | — |

### Repeat booking rule

Repeating **never creates or submits a booking**. `repeatOrder` returns the order list untouched,
sends no request, and leaves the customer on the review step, where confirmation remains an explicit
action owned by the booking sprints. The finished order's slot is never reused. This is asserted in
both the unit tests and the browser acceptance.

## Truth boundaries

- The session is in memory only: no `localStorage`, no network, no clock, no randomness. A draft does
  not survive a page reload; durable drafts belong to the sprint that introduces real persistence.
- Prices are illustrative fixture figures mirrored from the prototype. Production amounts come from a
  Pricing quote; package definitions come from Catalog; slot availability from Scheduling; order
  state from Booking.
- The offered repeat slot is a fixture stand-in for a Scheduling answer.
- The before/after artwork is an illustration and is labelled «رسوم توضيحية».

## Deferred controls

These are rendered exactly as approved but their behaviour belongs to later sprints. They are marked
`aria-disabled="true"` with `data-deferred-to` and perform no action yet:

| Control | Owner |
| --- | --- |
| «تفاصيل الباقات» (package details sheet) | C006 |
| «جرّب الدفع بطريقتك.» (payment walkthrough) | C012 |
| Before/after teaser (interactive comparison sheet) | before/after sprint |

The payment walkthrough link and the «تجربة تفاعلية» label are prototype demonstration elements. ADR 0004
requires an explicit owner decision before such controls are exposed in production; C003 keeps them
because removing approved UI also requires that decision.

## Shell corrections made for parity

Comparing Home against the reference exposed four shell deviations, corrected here because they are
visible on Home:

- desktop chip copy restored to the approved «تصميم للهاتف · تجربة محلية»;
- `.app` shadow at ≥600px and the bottom navigation shadow at ≥800px now follow the reference cascade;
- navigation icons are 25px and icon stroke is 1.65, as in the reference;
- the city control uses its visible text «دمشق» as its accessible name and 15px icons.

## Verification

`scripts/c003/browser-acceptance.mjs` renders the candidate and the approved HTML in the same Chromium
build under the F010 rendering contract and fails on any of:

- different element count, geometry (>0.5px) or computed style for the Home and shell selectors;
- different visible text, document title, `lang` or `dir`;
- any pixel beyond the F010 channel threshold in a full-page screenshot (allowed diff ratio: 0);
- an interaction leading somewhere other than where the reference goes;
- a request, console error or page error during the run.

It covers 5 scenarios × 320/390/430/768/1024/1440, plus keyboard order, visible focus, the modal
sheet, back/forward/refresh and reduced motion. Reference, candidate and diff screenshots are written
to `C003_EVIDENCE_DIR` and uploaded by the workflow.

Passing these checks is evidence for the tested browser build and fixtures only. It is not a
cross-device visual approval and not an accessibility certification.
