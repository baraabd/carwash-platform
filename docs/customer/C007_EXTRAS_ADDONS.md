# C007 — Customer extras / add-ons selection

Status: React port of the approved add-ons sheet of the care step, driven by the in-memory draft
and deterministic fixtures. This document does **not** claim a pricing service, a catalog service,
persistence or production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`
  (`extrasSheet()`, the `extra` change handler, the `extras-sheet` and `apply-extras` actions, the
  `EXTRAS` and `PACKAGES` constants, `cost()` and `bill()`).
- The file is unchanged by C007 and stays byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL.

## Flow placement — a sheet, not a route

In the approved HTML the add-ons are **not** a booking step. `FLOW` has seven entries (vehicle, care,
location, time, contact, payment, review) and none is "extras". The add-ons are a bottom sheet,
`extrasSheet()`, opened with `showSheet('لمسات إضافية، على ذوقك.', …)` from the row «لمسة إضافية؟» on
the care step (`#/book/1`).

C007 therefore adds **no route** and renumbers nothing: `app/routes.ts` and `bookingFlow.ts` are
untouched, and the journey stays Vehicle → Care → Location. A unit test asserts both.

## Scope

| Area | Location |
| --- | --- |
| Add-ons sheet | `apps/customer-web/src/features/booking/care/components/ExtrasSheet.tsx` |
| Sheet view model (pure) | `features/booking/care/extrasViewModel.ts` |
| Add-on commands (pure) | `apps/customer-web/src/state/extrasStep.ts` |
| Add-on catalog (hints, icons, order) | `apps/customer-web/src/fixtures/customerCatalogFixture.ts` |
| Row that opens the sheet | `features/booking/care/components/CarePackageList.tsx`, `CareStep.tsx` |
| Acceptance | `scripts/c007/browser-acceptance.mjs`, `tests/unit/c007-customer-extras.test.mjs`, `.github/workflows/c007-customer-extras.yml` |

## Add-on catalog (exactly the reference's `EXTRAS`)

| id | Name | Hint | Price (ل.س) | Minutes | Icon |
| --- | --- | --- | --- | --- | --- |
| `seats` | تنظيف المقاعد | عناية إضافية بالقماش | 350 | 20 | seat |
| `wheels` | تلميع الإطارات | لمسة أخيرة أجمل | 150 | 10 | wheel |
| `fresh` | تعطير المقصورة | رائحة خفيفة ومنعشة | 100 | 5 | leaf |

Three add-ons, in this order. No quantities, no notes, no fourth add-on: the reference has none.
C006 already held names, prices and minutes; C007 adds the hint, the icon and the display order to
the same objects. A unit test compares the catalog with the reference's `EXTRAS` literal.

The only package that includes an add-on is `premium`, which includes `wheels`.

## Sheet behaviour

- Title «لمسات إضافية، على ذوقك.», intro «لا إضافات محددة مسبقًا. يمكنك المتابعة دون أي إضافة.».
- Each add-on is a row with icon, name, hint, `+<price>` and a tick box. Nothing is ticked for a new
  draft.
- **Ticking or unticking takes effect immediately.** The sheet total «الإجمالي مع اختياراتك» and the
  booking footer (total and duration) update live. There is no cancel: closing the sheet with the
  close button or Escape keeps the ticked add-ons, as in the reference.
- «حفظ الاختيارات» closes the sheet and confirms with the notice «تم تحديث الإضافات والسعر.». It changes
  no draft data — the choices are already in the draft.
- The care step's row then lists the chosen add-ons and their amount (`+<sum> ل.س`).

### An add-on the package already includes

Shown exactly as in the reference: the row has the `included` look, its box is **ticked and
disabled**, and the price reads «ضمن الباقة» instead of an amount. It cannot be toggled and is never
charged. With `premium` selected this is `wheels`.

### Package change

| Step | Reference behaviour, as ported |
| --- | --- |
| Customer ticks `wheels` on `complete` | `wheels` is in the draft and charged (+150) |
| Switches to `premium` | `wheels` is **removed from the draft**; the sheet shows it ticked, disabled, «ضمن الباقة»; it is not charged |
| Switches back to `complete` | `wheels` is **not restored**; the box is empty and can be ticked again |

Other chosen add-ons are kept through package changes. This rule shipped with C006
(`selectCarePackage`); C007 adds the sheet-side behaviour and tests the whole transition.

## Pricing and duration

C007 adds no arithmetic. Everything goes through C006's single `illustrativeCost(draft)`:

```text
total   = package price + vehicle-size surcharge + chargeable add-ons
minutes = package minutes + vehicle-size minutes + chargeable add-on minutes
chargeable add-ons = the draft's add-ons, de-duplicated, minus those the package includes
```

Two guarantees hold in the calculation itself, independent of what the UI allows:

- an add-on the package includes is never charged, even if a draft still lists it;
- an add-on id that appears more than once is charged once.

The command layer also keeps the draft clean: ticking never stores an id twice, unticking removes
every occurrence, and an included add-on cannot be toggled.

The sheet total, the footer total, the Home "continue" card and the price breakdown all show the
same number. The price breakdown («السعر، بكل وضوح.», C006) lists one line per chargeable add-on and
drops the line when the add-on is unticked or becomes included.

These are illustrative fixture figures copied from the prototype. They are not a quote and nothing
is charged; a payable amount will come from the Pricing service.

## Draft semantics

Ticking an add-on edits only the local unsent draft held by the in-memory session: no booking, no
order, no reservation, no payment, no request, no browser storage. The order list and the garage are
never touched; a repeat-derived draft owns its own copy of the add-ons, so editing them never alters
the past order. A reload starts again from the selected fixture scenario.

## Deterministic scenarios

No new scenario was needed. C007 uses the ones earlier sprints defined:

| Scenario | Add-ons sheet shows |
| --- | --- |
| `home-empty` | nothing ticked |
| `booking-care-with-extras` | `wheels` and `fresh` ticked on `complete` |
| `home-returning-customer` | `seats` ticked, `wheels` included by `premium` |
| `booking-vehicle-prefilled`, `garage-vehicle-chosen` | nothing ticked, other vehicle sizes |

## Accessibility

- Each add-on is a native checkbox inside its label: the whole row is the hit area, Space toggles,
  the ticked state is exposed, and the accessible name carries name, hint and price.
- The included add-on is a ticked, natively disabled checkbox whose label says «ضمن الباقة»; it is
  skipped by Tab. Nothing uses `aria-disabled`, so no control claims to be disabled while it works.
- The sheet is a native modal dialog: the page behind is inert, Tab stays inside, Escape closes, and
  focus returns to the row that opened it. A visible focus ring surrounds the focused row.
- The footer total is announced politely; the confirmation is a `role="status"` notice.
- No element ids are duplicated while the sheet is open.

This is evidence for the tested behaviour, not an accessibility certification.

## Parity methodology

`scripts/c007/browser-acceptance.mjs` uses the C004 helpers unchanged: candidate and approved HTML
in the same Chromium build under the F010 rendering contract, failing on any difference in element
count, geometry (>0.5px), computed style, visible text, title, scroll position or full-page pixels
(allowed diff ratio 0).

- 5 states × 320/390/430/768/1024/1440: sheet with nothing ticked, with two ticked, with an add-on
  included by the package, with all three ticked, and the care step after saving.
- The same inputs are then applied to both pages and the observable state compared after every
  step: tick and untick each add-on, save, the included add-on, the package switch in and out, the
  price breakdown before and after, keyboard ticking, and reopening.

The reference runs with its storage writes refused (its own "this session only" state), as in
C004–C006. One zero-unit spelling in `background-image` is normalised. No tolerance was raised.

## Corrections to earlier tests

C006 shipped the add-ons row inactive and asserted that (`data-deferred-to="C007"`) in its unit test
and browser acceptance. Those two assertions described a temporary state that C007 ends, so they
were replaced: the unit test now checks only what C006 owns (showing and pricing the add-ons a
draft carries) and the browser acceptance checks that the row opens a dialog. No other earlier
assertion was changed.

## One deliberate difference from the reference

After the sheet is closed **without** «حفظ الاختيارات», the reference leaves the row behind it showing
the old add-ons until something else redraws the screen, although the draft and the footer already
changed. The port refreshes the row when the sheet closes, so the row never contradicts the total.
While the sheet is open the row keeps its previous content, exactly as in the reference.

## Deferred

- Location, time, contact, payment, review → C008–C012.
- Real quotes, promotions, coupons, subscriptions → Pricing/Subscription services.

## Known limitations

- The draft is not durable across a reload.
- Prices and durations are illustrative fixtures, not service data.
- English/LTR is not part of the approved customer reference.
- Evidence covers the tested Chromium build and fixtures only.
