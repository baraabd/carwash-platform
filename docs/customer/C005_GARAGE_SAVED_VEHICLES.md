# C005 — Customer garage, saved vehicles and the shared vehicle editor

Status: React port of the approved garage screen, the vehicle editor sheet and the saved-car
choices of the booking vehicle step, driven by in-memory session state and deterministic fixtures.
This document does **not** claim persistence, backend integration or production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`
  (`garageView()`, `vehicleSheet()`, `saveCar()`, the `vehicle-form` submit handler and the
  `add-car`, `edit-car`, `delete-car-prompt`, `delete-car`, `use-car`, `choose-car`, `fresh-car`
  actions; the saved-car chips in `vehicleView()` and the garage prefill in `start()`).
- The file is unchanged by C005 and stays byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL. Routes: `#/garage`, and the chips and editor on `#/book/0`.

## Scope

| Area | Location |
| --- | --- |
| Garage screen | `apps/customer-web/src/features/garage/**` |
| Shared vehicle editor sheet | `apps/customer-web/src/widgets/vehicle-editor/**` |
| Saved-vehicle model and commands (pure) | `apps/customer-web/src/state/savedVehicles.ts` |
| Saved-car chips and editor entry on the vehicle step | `features/booking/vehicle/**` |
| Garage scenarios | `apps/customer-web/src/fixtures/customerGarageScenarios.ts` |
| Headings, fields, chips shared by screens | `apps/customer-web/src/styles/customer-forms.css` |
| Acceptance | `scripts/c005/browser-acceptance.mjs`, `tests/unit/c005-customer-garage.test.mjs`, `.github/workflows/c005-customer-garage.yml` |

`widgets/` is new: UI composed for more than one feature. A widget may use `shared`, `state` and
`fixtures`; it must not import a feature or the app layer (enforced by a unit test). Features still
never import each other.

## Reference behaviour

### Garage screen

- Heading «سياراتي.» with its eyebrow and description; bottom navigation marks «سياراتي».
- **Empty:** the «مكان خاص لسيارتك.» card and a solid «إضافة سيارة» button.
- **Populated:** one card per saved car in saved order — artwork for its size, its name, its size
  name followed by the colour when given, and the plate or «اللوحة غير مضافة». Each card has
  «احجز لهذه السيارة», edit and delete. The add button becomes outlined.
- The note «الحفظ محلي، وليس حسابًا سحابيًا.» is kept verbatim (see Truth boundaries).

### Vehicle editor («أي سيارة نعتني بها؟»)

One sheet, two contexts. Fields are exactly the reference's: size (four radios), plate with a live
preview, name or model, colour. No field was added.

| | Garage context | Booking context |
| --- | --- | --- |
| Opened by | «إضافة سيارة», edit | «اسم السيارة ولونها», the «أخرى» chip |
| Starts with | blank car, or the saved car | the draft's car, or blank for «أخرى» |
| Extra content | note that past bookings do not change | saved-car chips + «سيارة جديدة»; save checkbox |
| Submit | «حفظ السيارة» → garage | «استخدام هذه السيارة» → draft only |

On submit the values are cleaned as in the reference: name trimmed and capped at 60, colour at 30,
plate trimmed, capped at 20, digits normalised and inner whitespace collapsed to one space. An
unacceptable plate shows «استخدم أرقام اللوحة وحروفها فقط (حتى 20 محرفًا)، أو اتركها فارغة.», keeps
the sheet open and focuses the plate field. Closing the sheet saves nothing.

### Saving, editing, deleting

- **Add:** appended to the garage. A car without a name takes its size name.
- **No duplicates:** saving a car that is already there — same plate and size, or without a plate
  the same name, size and colour — updates that car instead of adding another.
- **Edit:** updates the car in place; id and position are kept.
- **Delete** is supported by the reference and asks first («حذف السيارة المحفوظة؟»). «رجوع» keeps
  the car. Confirming removes it; a draft that used it keeps its details but loses the link.
  Deleting the last car returns to the empty state.
- **Limit:** 30 cars.

### Garage ↔ booking

- «احجز لهذه السيارة» copies the car into the unsent draft and opens `#/book/0`.
- On `#/book/0`, saved cars appear as chips above the stage when the garage is not empty. A chip
  copies the car into the draft and marks itself; picking a size by hand releases it (the plate
  stays, as in C004). «أخرى» opens a blank editor.
- Starting a booking from Home prefills the first saved car **only** when the draft describes no car
  yet; a car the customer already chose or typed is never replaced.
- From the booking editor nothing is written to the garage. The reference adds the car to the garage
  when a booking is confirmed and the save preference is on; confirmation is a later sprint.

Choosing, editing or booking a saved car **never creates a booking**, sends nothing and writes no
browser storage. A saved vehicle is a description of a car, not an order.

## Saved vehicle model

`state/savedVehicles.ts`:

```ts
interface SavedVehicle { id: string; type: VehicleTypeId; name: string; plate: string; color: string }
```

Only the fields the reference has. It is distinct from:

- the booking draft's car fields (`vehicleType`, `carName`, `plate`, `color`, `carId`, `saveVehicle`)
  — `carId` is a link to the saved car the fields were copied from, not ownership;
- the catalog size fixture (names, illustrative surcharge, artwork);
- the view models (`garageViewModel.ts`, `vehicleViewModel.ts`, `vehicleEditorModel.ts`).

Ids are `CAR-<n>` from a session counter, so they are deterministic and never reused after a delete.
Plate normalisation and validation are C004's `normalizePlateInput` and `isPlateAcceptable`; C005
adds no second implementation.

## Deterministic fixtures

Selected with `?scenario=<id>`; unknown ids fall back to the empty default. Sample data only.

| Scenario | Garage |
| --- | --- |
| `home-empty` (default) | empty |
| `garage-one-vehicle` | one named car with plate and colour |
| `garage-three-vehicles` | adds a car without plate or colour and one whose name looks like markup |
| `garage-vehicle-chosen` | three cars, the draft already filled from the first |

## Truth boundaries

- The garage lives in the in-memory session. It is **not persisted**: a reload starts again from the
  selected fixture (asserted in the browser acceptance). No Vehicle or Customer service is called.
- The approved copy says «الحفظ محلي» and «محفوظتان على جهازك». It is kept because changing approved
  copy needs an owner decision; in this build "saved" means "for this session". This wording must be
  reviewed with the owner when real persistence is introduced.
- When the garage is full the reference shows the limit message and then immediately replaces it
  with «السيارة ولوحتها محفوظتان على جهازك.» although nothing was stored. The port shows only the
  limit message, so it never reports a save that did not happen. This is the one deliberate
  behavioural difference in C005.

## Accessibility

- Cards use real buttons; edit and delete are labelled with the car's name.
- The editor and the delete prompt are native modal dialogs: the page behind is inert, Escape
  closes, and focus returns to the control that opened them. Only the open sheet carries the title
  id, so it is unique in the document.
- Sizes are native radios in a labelled `radiogroup`; plate, name and colour are labelled inputs;
  a refused plate is `aria-invalid`, described by the `role="alert"` message, and focused.
- Saved-car chips are buttons in a labelled group and expose `aria-pressed`.
- Names and plates are rendered as text only. A name such as `<img onerror=…>` is shown literally in
  the card, the chip, the stage and the delete prompt and nothing is executed (tested).

This is evidence for the tested behaviour, not an accessibility certification.

## Parity methodology

`scripts/c005/browser-acceptance.mjs` uses the C004 helpers unchanged: candidate and approved HTML
in the same Chromium build under the F010 rendering contract, failing on any difference in element
count, geometry (>0.5px), computed style, visible text, title, scroll position or full-page pixels
(allowed diff ratio 0).

- 10 states × 320/390/430/768/1024/1440: empty, one car, three cars, vehicle step with chips,
  vehicle step with a chosen car, editor add, editor edit, editor refused plate, delete prompt, and
  the booking editor with its chips. Open sheets are compared with the page behind them.
- The same inputs are then applied to both pages and the observable state compared after every
  step: add, unnamed car, digit and whitespace normalisation, live preview, refused and corrected
  plate, duplicate save, edit, close without saving, delete and cancel, last-car delete, book for a
  car, chips, «أخرى», the details row, chips inside the editor, manual selection with an empty
  garage, and the Home CTA prefill.

As in C004 the reference runs with its storage writes refused (its own "this session only" state),
and one zero-unit spelling in `background-image` is normalised. No tolerance was raised.

## Corrections made for parity

- `.main` keeps `min-height: 75svh` from 600px, as in the reference (C002 applied it from 800px).
- `.page-heading p` is 11px below 375px.
- Sheet focus restoration no longer overrides the browser's own: the `close` event arrives as a
  later task and could move focus away from a control the customer had already reached.

## Deferred

- The booking footer's price breakdown sheet → C006 (unchanged from C004).
- Adding the booked car to the garage on confirmation → the booking confirmation sprint.
- The account screen's «N سيارات محفوظة» row → the account sprint.

## Known limitations

- The garage and the draft are not durable across a reload.
- After a save the reference re-renders the garage and restores focus by action name, which is the
  first matching button on the page; the port returns focus to the button that was actually used.
- English/LTR is not part of the approved customer reference.
- Evidence covers the tested Chromium build and fixtures only.
