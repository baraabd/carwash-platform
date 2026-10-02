# C008 — Customer location / address picker / illustrative map

Status: React port of the approved location step (`#/book/2`), its address sheet and its
illustrative map, driven by the in-memory draft and deterministic fixtures. This document does
**not** claim a Location service, address storage, geocoding, serviceability checks or production
readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`
  (`locationView()`, `addressSheet('booking')`, `renderAddressSheet()`, `mapMarkup()`, `mapSVG()`,
  `initMap()`, `geolocate()`, `sampleAddress()`, the `address-form` submit handler, the
  `sample-address`, `sheet-sample`, `map-zoom`, `geolocate` and `address-sheet` actions,
  `validate(2)`).
- The file is unchanged by C008 and stays byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL.

## Scope

| Area | Location |
| --- | --- |
| Step screen | `apps/customer-web/src/features/booking/location/LocationStep.tsx` |
| Map card and sample shortcuts | `features/booking/location/components/LocationCard.tsx` |
| Address sheet | `features/booking/location/components/AddressSheet.tsx` |
| Illustrative map (pin, pan, zoom, keys) | `features/booking/location/components/IllustrativeMap.tsx` |
| Device-location request | `features/booking/location/deviceLocation.ts` |
| View model (pure) | `features/booking/location/locationViewModel.ts` |
| Commands and rules (pure) | `apps/customer-web/src/state/locationStep.ts` |
| Map drawing (verbatim) | `apps/customer-web/src/shared/art/mapMarkup.ts`, `IllustrativeMapArt.tsx` |
| Scenarios | `apps/customer-web/src/fixtures/customerLocationScenarios.ts` |
| Acceptance | `scripts/c008/browser-acceptance.mjs`, `tests/unit/c008-customer-location.test.mjs`, `.github/workflows/c008-customer-location.yml` |

Journey: Vehicle → Care → **Location** → Time. No step was added, merged or renumbered; the
time step (`#/book/3`) is still its C002 placeholder.

## The step

- Heading «أين نأتي لسيارتك؟», the map card, the two sample shortcuts («المنزل», «العمل») and
  the tip. An access note, when the draft has one, is shown under the tip.
- The card shows «حدد مكان السيارة» until the draft has an address, then the address label and
  the address. It opens the address sheet.
- A sample shortcut fills the draft with one of the reference's two demonstration addresses,
  clears the access note, marks the shortcut and confirms with «عنوان توضيحي مختار. يمكنك تعديله.».
- «اختيار الموعد» needs an address of at least four characters (after trimming). Otherwise the
  customer stays on the step with «حدد مكان السيارة أو أدخل عنوانًا واضحًا قبل المتابعة.», which
  receives focus. Choosing a place clears the message.
- Header back returns to the care step; the draft is kept. The footer total and duration come
  from the one pricing calculation (C006) and do not depend on the place.

## The address sheet

Title «مكان سيارتك، بكل بساطة.». It edits a temporary copy of the draft's location:

| Field | Rule |
| --- | --- |
| «العنوان بالتفصيل» | required; trimmed; at least 4, at most 160 characters |
| «اسم العنوان» | optional; trimmed; at most 30; empty becomes «مكان الغسيل» |
| «ملاحظة الوصول» | optional; trimmed; at most 160 |
| «احفظ العنوان على جهازي للحجز القادم.» | a preference kept in the draft (see below) |

- «اعتماد هذا المكان» validates and copies the values into the draft, closes the sheet and confirms
  with «تم تحديد مكان الغسيل.». A short address shows «أدخل عنوانًا من أربعة أحرف على الأقل.» and
  focuses the field.
- Closing the sheet any other way discards what was typed or pinned; the draft is unchanged.
- «منزل تجريبي» / «عمل تجريبي» refill the sheet with a sample address and redraw the map.

### "Save the address" is a preference, not a saved address

The tick is stored as `draft.saveAddress` and nothing else happens: no address record, list or
storage exists in this sprint. Saved-address chips and add/edit/delete (`saved-address`,
`sheet-saved-address`, `savedAddressesSheet`) belong to C009 and are not rendered. A unit test
asserts that submitting the sheet adds no collection to the session.

## The illustrative map

The map is the reference's own drawing (`mapSVG()`), copied byte for byte and asserted so by a
unit test. It is a picture: **no tiles, no map provider, no geocoding or reverse geocoding, no
network request**. Street names in it are part of the artwork.

| Input | Effect (as in the reference) |
| --- | --- |
| Tap / click | pin placed at that point of the drawing, kept inside a 20-unit margin |
| Drag (more than 5px) | pans, at most ±250 / ±190 |
| Two-finger pinch | zooms between 0.7 and 2.2 |
| «تكبير» / «تصغير» buttons, `+` `=` `-` keys | zoom by 0.2 |
| Ctrl + wheel | zooms by 0.1; a plain wheel scrolls the sheet |
| Arrow keys (map focused) | move the pin by 15 units |

A placed pin sets the description to «نقطة مختارة على الخريطة التوضيحية» and is announced
politely. It fills the address with «دمشق، موقع مختار على الخريطة التوضيحية» **only** when the
address is empty or is a sample; an address the customer wrote is kept. No address is ever
derived from the point. Zoom and pan are view state of the open sheet and are not kept.

A place in the draft is `{ kind, x, y, label }` where `x`/`y` are positions in the 700×500
drawing — not latitude/longitude.

## Privacy / geolocation

- The browser location API is called from exactly one place
  (`deviceLocation.ts` → `navigator.geolocation.getCurrentPosition`) and only from the customer's
  tap on «موقعي الحالي». It is not called on page load, when the step renders or when the sheet
  opens; `watchPosition` and `permissions.query` are never used. Unit and browser tests enforce
  this (the browser test counts the calls).
- The request is coarse: `enableHighAccuracy: false`, `timeout: 8000`, `maximumAge: 60000`.
- The coordinates are read inside the callback, passed to `classifyDevicePosition`, reduced to
  **in range / out of range**, and dropped. They are not returned to the component, kept in
  state, written to the draft, shown, logged, put in the URL or a notice, stored or sent. The
  browser test scans the DOM, URL, title, history state, storage and cookies for the supplied
  position and finds nothing.
- Outcomes, with the reference's copy:

| Outcome | What happens |
| --- | --- |
| In range | pin description «موقع داخل نطاق دمشق التقريبي، أكمل العنوان»; notice asks the customer to write the address. The address field is not touched. |
| Out of range | notice only; the sheet is unchanged |
| Permission denied | notice only; manual entry and samples remain |
| Unavailable / timeout | notice only |
| API missing / insecure context | notice only; no request is made |

- An answer that arrives after the sheet was closed is ignored.
- Manual entry always works without granting location.
- Tests never use the machine's real position: Playwright supplies made-up coordinates or the API
  is replaced by a stub.

### Reference discrepancy awaiting an owner decision

The reference calls the accepted range «نطاق دمشق», but the centre it measures from
(`24.7136, 46.6753`) is the coordinate pair of **Riyadh**, with a 65 km radius. A device that is
actually in Damascus is therefore told it is outside the range. The numbers are ported unchanged,
as a named constant in `state/locationStep.ts`, because the reference is frozen and changing who
is "in range" is a product decision. Nothing depends on the outcome besides the pin description
and the notice, and manual entry is unaffected.

## Draft semantics

Choosing a place edits only the local unsent draft held by the in-memory session: no booking, no
order, no saved address, no request, no browser storage. `BookingDraft` gained `place` and
`saveAddress`; a repeat-derived draft takes the order's written address and starts with no pin.
A reload starts again from the selected fixture scenario.

The existing entry guard (C003) still applies: a draft without a usable address cannot be resumed
past this step.

## Deterministic scenarios

Selected with `?scenario=<id>`; anything unknown falls back to `home-empty`.

| Scenario | Location step shows |
| --- | --- |
| `home-empty` | no place chosen |
| `booking-location-sample-work` | the «العمل» sample, shortcut marked |
| `booking-location-map-point` | a pin away from the centre, save preference off |
| `booking-location-manual-note` | a long typed address, custom label and access note |

All addresses are sample text; no fixture holds a coordinate.

## Accessibility

- The card and the shortcuts are native buttons; the card announces that it opens a dialog and the
  shortcuts expose their pressed state.
- The map is a focusable group whose label explains tap, drag, arrows and zoom; every pointer
  action has a keyboard or button equivalent, and a typed address needs no map at all.
- The sheet is a native modal dialog: background inert, Tab stays inside, Escape closes, focus
  returns to the card. All twelve controls are reachable and show a focus ring; every field has a
  label; ids stay unique.
- Validation messages are `role="alert"`; the refused step moves focus to its message and the
  refused sheet moves focus to the address field. Notices are `role="status"`.
- Sheet buttons, the card, the shortcuts and the next button are at least 44×44 CSS px at 320 and
  1440.
- Customer text (address, label, note) is rendered as text only; a test types markup and checks
  that no element is created and nothing runs.

This is evidence for the tested behaviour, not an accessibility certification.

## Parity methodology

`scripts/c008/browser-acceptance.mjs` uses the C004 helpers unchanged: candidate and approved HTML
in the same Chromium build under the F010 rendering contract, failing on any difference in element
count, geometry (>0.5px), computed style, visible text, title, scroll position or full-page pixels
(allowed diff ratio 0).

- 10 states × 320/390/430/768/1024/1440: the step empty, with a sample, with a map point, with a
  long address and note, with the validation message; the sheet empty, with a pin, with long
  values, with its error, and with the map zoomed, panned and tapped.
- The same inputs are then applied to both pages and the observable state compared after every
  step: shortcuts, typing and submitting, the length rules, map taps, drag, zoom buttons, keys,
  Ctrl+wheel, pinch, the sheet's sample chips, discarding, the refused and accepted Next, and six
  device-location outcomes.
- Candidate-only checks cover what the reference cannot express: the location-call count and the
  exposure scan, the late answer, Back/Next/history/resume, refresh and deep link, keyboard and
  focus, touch targets and reduced motion.

The reference runs with its storage writes refused (its own "this session only" state), as in
C004–C007. No tolerance was raised and no snapshot was regenerated.

## Shared changes

- `shared/Icon.tsx`: five reference icons (`minus`, `target`, `work`, `message`, `expand`).
- `styles/customer-shared.css`: the reference's `--shadow` token.
- `app/CustomerShell.tsx`: the location step uses the ported header and footer slot; and a focused
  text field is scrolled to the middle of its scroller 160 ms after focus, as the reference does.
  The earlier screens already matched the reference without it; the address sheet at 320px does
  not, so the behaviour was added for every field rather than special-cased. C004–C007 parity was
  re-run and is unchanged.

## One deliberate difference from the reference

When «موقعي الحالي» answers "in range", the reference updates the pin's description and its stored
position (the centre) but leaves the drawn pin where it was until the sheet is next redrawn. The
port moves the drawn pin to the centre at once, so the picture never contradicts the stored place.
With the pin already at the centre the two are identical, which is what the parity run compares.

## Deferred

- Saved addresses: chips, list, add, edit, delete, acting on `saveAddress` → C009.
- Time step → C010; contact, payment and review → later sprints.
- Real address validation, service area, geocoding, maps → Location service, with a separate
  privacy review.

## Known limitations

- The draft, including the chosen place, is not durable across a reload.
- The map is an illustration; a pin has no geographic meaning.
- The "in range" check uses the reference's numbers (see the discrepancy above).
- English/LTR is not part of the approved customer reference.
- Evidence covers the tested Chromium build and fixtures only.
