# C004 — Customer vehicle selection (booking step 1 of 7)

Status: React port of the approved vehicle step, driven by an in-memory draft and deterministic
fixtures. This document does **not** claim persistence, backend integration or production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`
  (`bookingView()`, `vehicleView()`, `bookingFooter()`, `validate()`, `next()`).
- The file is unchanged by C004 and stays byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL. Route: `#/book/0`.

## Scope

| Area | Location |
| --- | --- |
| Vehicle step and its components | `apps/customer-web/src/features/booking/vehicle/**` |
| Journey label, counter and seven-segment progress | `features/booking/BookingProgress.tsx`, `bookingFlow.ts` |
| Booking action bar (assurance, total, Next) | `features/booking/BookingFooter.tsx` |
| Step view model (pure) | `features/booking/vehicle/vehicleViewModel.ts` |
| Vehicle-step commands (pure) | `apps/customer-web/src/state/vehicleStep.ts` |
| Plate normalisation and validation (pure) | `apps/customer-web/src/state/bookingDraft.ts` |
| Booking scenarios | `apps/customer-web/src/fixtures/customerBookingScenarios.ts` |
| Booking header exit sheet | `apps/customer-web/src/app/BookingExitNotice.tsx` |
| Acceptance | `scripts/c004/**`, `tests/unit/c004-customer-vehicle.test.mjs`, `.github/workflows/c004-customer-vehicle.yml` |

Steps 2–7 are still the C002 mount points. C004 does not implement them.

## Behaviour (as in the reference)

- **Sizes:** four options in the approved order — سيدان (base price), كروس أوفر (+200), دفع رباعي (+350),
  بيك أب (+250). Exactly one is selected; سيدان is the default for a new draft.
- **Selecting a size** updates the stage artwork and name, the selected card and the footer total and
  duration. It clears the optional car name and colour (a different car) and keeps the plate.
- **Plate** is optional. It is shown live on the stage as it is typed.
- **Next («اختيار العناية»)** validates on activation only. An unacceptable plate keeps the customer on
  the step, shows «اكتب أرقام اللوحة وحروفها فقط، أو اتركها فارغة.», marks the field invalid and moves
  focus to it. Typing again clears the message. Otherwise the draft advances to `#/book/1`.
  Enter in the plate field does the same as Next. Next is never disabled.
- **Header back («الخطوة السابقة»)** on this first step leaves the journey for Home; the draft is kept.
- **Header exit** opens «نكمل الغسلة لاحقًا؟»; «حفظ والخروج» keeps the draft and returns Home, where C003
  offers to continue it.
- **Save preference** («احفظ السيارة على جهازي للحجز القادم.») is recorded in the draft only.

## Plate normalisation and validation

Both live in `state/bookingDraft.ts`; components never inspect the value.

- `normalizePlateInput`: Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits become Latin digits;
  the result is capped at 20 characters. Letters, spaces and hyphens are kept exactly as typed —
  nothing is trimmed, upper-cased or reordered. The function is pure and locale-independent.
- `isPlateAcceptable`: empty is acceptable (optional). Otherwise 2–20 characters from Latin letters,
  Arabic letters (ء–ي), digits, whitespace and hyphen, with at least one digit.
- Spaces alone are **not** "left blank" and are refused, as in the reference. (C003 trimmed before
  validating; that was a deviation and is corrected here. It also applies to the entry guard that
  sends a resumed or repeated draft back to step 0.)
- The input shows the customer's own typing; the stored and displayed-on-stage plate is the
  normalised one. After a size change or a refused Next the field is redrawn from the stored plate.

## Draft semantics

The step edits only the local unsent draft held by the in-memory session:

- no booking is created, no request is sent, no browser storage is written;
- the order list is never touched (asserted by identity in unit tests and by request/storage
  counters in the browser acceptance);
- every booking route records the step being edited, so Home's «أكمل» returns to it;
- a reload starts again from the selected fixture scenario — the draft is not durable.

The footer therefore says «محفوظ لهذه الجلسة» and the exit sheet «التخزين غير متاح. المسودة تبقى لهذه
الجلسة فقط.» — the reference's own wording for a session without device storage.

## Deterministic states

Selected with `#/book/0?scenario=<id>`; unknown ids fall back to the empty default.

| Scenario | Vehicle step shows |
| --- | --- |
| `home-empty` (default) | سيدان selected, no plate, 500 ل.س / 35 دقيقة |
| `booking-vehicle-prefilled` | بيك أب, name «هايلكس», colour «أبيض», plate «4821 ب ج», save preference off |
| `booking-vehicle-invalid-plate` | كروس أوفر with a stored plate that has no digit |
| `home-returning-customer` | كروس أوفر with a premium package and an extra in the footer total |

A repeat-derived draft (C003) is prefilled the same way when it is routed through step 0.

## Accessibility

- Sizes are native radios inside labels in a labelled `radiogroup`: one tab stop, arrow keys move the
  selection, the checked state is exposed without custom key handling.
- The plate input is labelled by its `<label>`, described by its help text and, when refused, by the
  error (`role="alert"`, `aria-invalid="true"`). The message is also sent to the polite live region.
- Every interactive element is a button, link or input with a visible focus ring; no click-only
  containers; focus can leave the page after the last control.
- The step heading receives focus after in-app navigation; on a fresh load the skip link stays the
  first stop.
- On a short viewport (on-screen keyboard) the action bar is released into the flow while a text
  field has focus, as in the reference.

This is evidence for the tested behaviour, not an accessibility certification.

## Deferred ownership

Rendered exactly as approved, marked `aria-disabled="true"` with `data-deferred-to`, no action yet:

| Control | Owner |
| --- | --- |
| «اسم السيارة ولونها» — opens the shared vehicle editor sheet | C005 (garage / saved vehicles) |
| Footer total «السعر الحالي» — opens the price breakdown sheet | C006 (care packages / pricing display) |

Not rendered because the state does not exist yet: the saved-car chips above the stage (they appear
only when the garage holds cars — C005).

Prices and durations are illustrative fixture figures mirrored from the prototype; production
amounts come from a Pricing quote and vehicle records from the Vehicle service.

## Shell corrections made for parity

Visible on the vehicle step and therefore fixed here, all towards the reference:

- booking header title is 14px and its subtitle 10px;
- the skip link is the reference's underlined brand-green link;
- form controls get the same focus ring as buttons and links;
- on step 0 the header back control is «الخطوة السابقة» and goes Home. Steps 2–7 keep the C002
  history-back control until their own sprints port them.

## Browser parity

`scripts/c004/browser-acceptance.mjs` uses the C003 methodology: the candidate and the approved HTML
in the same Chromium build under the F010 rendering contract, failing on any difference in element
count, geometry (>0.5px), computed style, visible text, title, scroll position or full-page pixels
(allowed diff ratio 0).

- 5 states × 320/390/430/768/1024/1440: default, prefilled, returning customer, another size
  selected, and the refused-plate error state.
- The same inputs are then applied to both pages and their observable state compared after every
  step: each size, each digit system, the refused plates, error clearing, the save preference, and
  arrow-key selection.
- Next, Enter, Back and Exit must lead where the reference leads.

The reference is opened with its storage writes refused. That is the prototype's own approved
"this session only" state and the truthful counterpart of the in-memory candidate; the reference
file itself is not modified. One zero-unit spelling in `background-image` is normalised, exactly as
in the C003 acceptance.

## Known limitations

- The draft is not durable across a reload.
- The two deferred controls above perform no action yet.
- The reference debounces Next for 350ms; the port relies on the route change instead.
- The 300ms slide transition between routes is shell-level and still not ported.
- English/LTR is not part of the approved customer reference.
- Evidence covers the tested Chromium build and fixtures only.
