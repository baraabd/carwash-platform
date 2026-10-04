# C006 — Customer care packages, package details and price breakdown

Status: React port of the approved care (package) step, the price breakdown sheet and Home's
package-details sheet, driven by the in-memory draft and deterministic fixtures. This document does
**not** claim a pricing service, a catalog service, persistence or production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`
  (`serviceView()`, `bill()`, `cost()`, `serviceInfo()`, `bookingFooter()`, the `service` change
  handler and the `price-breakdown`, `services-info`, `start-service`, `book-step`, `back`, `next`
  actions; the `PACKAGES`, `V` and `EXTRAS` constants).
- The file is unchanged by C006 and stays byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL. Route: `#/book/1`.

## Scope

| Area | Location |
| --- | --- |
| Care step and its components | `apps/customer-web/src/features/booking/care/**` |
| Care-step commands (pure) | `apps/customer-web/src/state/careStep.ts` |
| Price breakdown view model (pure) | `features/booking/priceBreakdown.ts` |
| Price breakdown sheet | `features/booking/BookingFooter.tsx` |
| Home package-details sheet | `features/home/components/HomePackages.tsx`, `homeViewModel.ts` |
| Package catalog and the one calculation | `apps/customer-web/src/fixtures/customerCatalogFixture.ts` |
| Care scenario | `apps/customer-web/src/fixtures/customerCareScenarios.ts` |
| Acceptance | `scripts/c006/browser-acceptance.mjs`, `tests/unit/c006-customer-care-packages.test.mjs`, `.github/workflows/c006-customer-care-packages.yml` |

Steps 3–7 are still the C002 mount points.

## Package data (exactly the reference's `PACKAGES`)

| id | Name | Summary | Price (ل.س) | Minutes | Label | Features | Includes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `exterior` | لمعة سريعة | غسيل خارجي | 500 | 35 | EVERYDAY CLEAN | غسيل الهيكل · تنظيف الزجاج · تجفيف يدوي | — |
| `complete` | نظافة متكاملة | داخلي + خارجي | 900 | 60 | INSIDE & OUT | غسيل خارجي · شفط الأتربة · تنظيف المقصورة | — |
| `premium` | عناية استثنائية | عناية بالتفاصيل | 1500 | 95 | SIGNATURE CARE | تنظيف متكامل · عناية بالتفاصيل · تلميع الإطارات | wheels add-on |

The reference has no "recommended" badge and no promotional copy; none was added. The fixtures C003
introduced already matched the reference; C006 adds the features, labels and included add-ons to
the same objects, so there is still one package representation. A unit test compares the fixtures
with the reference's literal constants.

## Selection behaviour

- Three options in the order above, as native radios in a labelled `radiogroup`; the whole card is
  the hit area. Exactly one is selected; `exterior` is the default for a new draft.
- Each card shows the price **including the surcharge of the chosen vehicle size** and the duration
  including the size's extra minutes. The context line names the car and says so
  («الأسعار تشمل حجم سيارتك»); «تغيير» returns to the vehicle step.
- Selecting a package updates the selected card, the footer total and the duration. It **does not**
  move to the next step — that stays an explicit «تحديد المكان».
- Selecting a package changes nothing else in the draft, with one rule from the reference: add-ons
  the new package already includes are dropped, so they are never listed or charged twice. They are
  not silently re-added when the customer switches back.
- **Next** («تحديد المكان») validates nothing on this step and goes to `#/book/2`.
- **Header back** («الخطوة السابقة») returns to `#/book/0`. The draft is kept.

## Pricing calculation

One pure function, `illustrativeCost(draft)` in the catalog fixture, mirrors the reference's
`cost()`:

```text
total   = package price + vehicle-size surcharge + chargeable add-ons
minutes = package minutes + vehicle-size minutes + chargeable add-on minutes
chargeable add-ons = the draft's add-ons, de-duplicated, minus those the package includes
```

- Surcharges: سيدان 0, كروس أوفر +200, دفع رباعي +350, بيك أب +250 (minutes 0 / 10 / 20 / 15).
- All amounts are whole Syrian pounds; there is no fractional arithmetic.
- Components and view models never add figures up themselves (enforced by a unit test).
  `illustrativeDraftTotal` and `illustrativeDraftMinutes`, used since C003/C004, are now thin
  wrappers over the same calculation.
- These are illustrative figures copied from the prototype. They are not a quote and nothing is
  charged. A payable amount will come from the Pricing service; package definitions from Catalog.

## Price breakdown («السعر، بكل وضوح.»)

Opened from the footer total on every ported booking step (vehicle and care). It shows the
reference's bill «السعر، بدون مفاجآت.»:

1. the package and its base price;
2. «حجم السيارة · <size>» with the surcharge, or «ضمن السعر» for the smallest size;
3. one line per chargeable add-on the draft already carries;
4. «الوصول إلى الموقع — ضمن سعر التجربة»;
5. «الإجمالي».

followed by «أسعار توضيحية. لا تحصيل أو رسوم فعلية.» and «متابعة الحجز», which only closes the sheet.

## Package details («لكل سيارة، عناية مناسبة.»)

The reference's package-details surface is the bottom sheet opened by Home's «تفاصيل الباقات». It
lists all three packages for a sedan — name, price, features, estimated minutes — each with
«اختيار هذه الباقة». Choosing one behaves exactly like a Home package card: the package is
preselected and the journey starts at the **vehicle** step (`#/book/0`); the flow never skips it.
Closing the sheet starts nothing. The care step itself has no per-package details control in the
reference, so none was added.

## Add-ons (C007) — shown, not selectable

The reference's care step has a row «لمسة إضافية؟» that opens the add-ons sheet. Selecting add-ons
is C007. C006 renders the row and, when a draft already carries add-ons (a returning or repeated
draft), shows their names and amount and includes them in the total and the bill, because hiding
them would misstate the price. The row is `aria-disabled` with `data-deferred-to="C007"`.

## Draft semantics

The step edits only the local unsent draft held by the in-memory session: no booking is created,
nothing is reserved or charged, no request is sent and no browser storage is written. The order list
and the garage are never touched (asserted by identity in unit tests and by request, storage and
order checks in the browser acceptance). A reload starts again from the selected fixture scenario.

## Deterministic scenarios

Selected with `#/book/1?scenario=<id>`; unknown ids fall back to the empty default.

| Scenario | Care step shows |
| --- | --- |
| `home-empty` (default) | سيدان, `exterior` selected, 500 / 35 |
| `booking-vehicle-prefilled` | بيك أب «هايلكس», `complete` selected, prices +250 |
| `home-returning-customer` | كروس أوفر, `premium` selected, one add-on in the row and the total |
| `garage-vehicle-chosen` | saved car «سيارة العائلة», prices +200 |
| `booking-care-with-extras` (new) | دفع رباعي, `complete`, two add-ons, one of which `premium` includes |

## Accessibility

- Packages: native radios in a labelled group — one tab stop, arrow keys move the selection, Space
  selects, the checked state is exposed; a visible focus ring surrounds the focused card.
- The footer total is a button labelled with the current amount; it opens a native modal dialog.
  The page behind is inert, Escape closes, and focus returns to the control that opened it. The
  same holds for the Home package-details sheet.
- The live total is announced politely (`aria-live` on the amount).
- Progress exposes «الخطوة 2 من 7» with the current and completed steps.
- No click-only containers; focus can leave the page after the last control.

This is evidence for the tested behaviour, not an accessibility certification.

## Parity methodology

`scripts/c006/browser-acceptance.mjs` uses the C004 helpers unchanged: candidate and approved HTML
in the same Chromium build under the F010 rendering contract, failing on any difference in element
count, geometry (>0.5px), computed style, visible text, title, scroll position or full-page pixels
(allowed diff ratio 0).

- 9 states × 320/390/430/768/1024/1440: care default, prefilled draft, returning customer, saved
  vehicle, draft with add-ons, another package selected, price breakdown on the care step, price
  breakdown on the vehicle step, and Home's package-details sheet.
- The same inputs are then applied to both pages and the observable state compared after every
  step: every package, size-dependent prices, the included add-on rule, arrow keys, the breakdown
  before and after a change, «تغيير», header back, and the three Home entries compared at the care
  step.

Booking pages run with the reference's storage writes refused (its own "this session only" state),
as in C004/C005; the Home sheet is compared with the reference's normal storage, as in C003. One
zero-unit spelling in `background-image` is normalised. No tolerance was raised.

## Deferred

- Selecting add-ons and the add-ons sheet → C007.
- Location, time, contact, payment, review → C008–C012.
- Real quotes, promotions, coupons, subscriptions → Pricing/Subscription services, not a frontend sprint.

## Known limitations

- The draft is not durable across a reload.
- Prices and durations are illustrative fixtures, not service data.
- The reference debounces Next for 350ms; the port relies on the route change instead.
- The 300ms slide transition between routes is shell-level and still not ported.
- English/LTR is not part of the approved customer reference.
- Evidence covers the tested Chromium build and fixtures only.
