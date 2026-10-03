# C009 — Customer saved addresses / address book / shared address editor

Status: React port of the approved saved-address experience — the account screen's entry, the
«عناويني المحفوظة» sheet, the address editor shared with the location step, and the saved-address
chips of the booking journey — driven by the in-memory session and deterministic fixtures. This
document does **not** claim a Customer or Location service, durable storage, an account system or
production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`. Unchanged by
  C009 and byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL.

## Source → implementation → test

| Reference | Implementation | Tests |
| --- | --- | --- |
| `accountView()` | `features/account/AccountRoute.tsx`, `accountViewModel.ts`, `account.css` | unit "account view", "account host"; browser `account-*` states |
| action `addresses`, `savedAddressesSheet()` | `features/account/components/AddressBookSheet.tsx` (list view) | browser `book-list-*`; unit "account view" |
| actions `add-address`, `edit-address`, `addressSheet('account', id)` | `AddressBookSheet` (editor view) + `widgets/address-editor/AddressEditor.tsx` | browser `book-add-form`, `book-edit-form-long-text`, account interaction cases |
| `renderAddressSheet()`, `mapMarkup()`, `initMap()`, `geolocate()` | `widgets/address-editor/**` (moved from C008's location feature) | all C008 tests, plus C009 "shared editor" |
| `address-form` submit, account branch | `state/savedAddresses.ts` `submitAccountAddress` | unit add / validation / bounds / edit |
| `saveAddress(data, id)` | `state/savedAddresses.ts` `saveAddressRecord` | unit duplicate / collision / capacity / unknown ids |
| actions `delete-address`, `delete-address-confirm` | `AddressBookSheet` (delete view), `deleteSavedAddress` | browser `book-delete-confirm`, delete steps; unit "delete" |
| `locationView()` chips, action `saved-address` | `features/booking/location` `SavedAddressChips`, `chooseSavedAddress` | browser `location-chips`, `location-chip-selected`; unit "step chip(s)" |
| `renderAddressSheet()` chips, action `sheet-saved-address` | `AddressEditorForm` chips, `applySavedAddressToSheet` | browser `booking-editor-*`; unit "editor chip" |
| `start()` address prefill | `state/bookingEntry.ts` `startBooking` → `prefillAddressFromBook` | unit "prefill"; browser "public entry, booking prefill" |
| `confirmOrder()` → `saveAddress(d)` | **not implemented** (inspected only) — see "Deferred confirmation" | unit "save preference" proves it is not called |

## Ownership

- **Owned and compared full-page:** the account screen's presentation, the saved-addresses sheet in
  its three views, the address editor in both contexts, and the location step with chips.
- **Host boundary:** on the account screen only «عناويني» (opens the sheet) and «سياراتي» (existing
  garage navigation) do anything. The profile row, the profile edit button and the seven rows of
  the second group (payment codes, payment tour, motion, help, privacy, export, reset) are rendered
  exactly as approved, carry `aria-disabled="true"` and `data-deferred="account"`, and are bound to
  nothing. They belong to the sprints that own those capabilities. So this is pixel parity of the
  account screen and behavioural parity of its address surface — **not** full account parity.
- No route was added: the address book is a sheet on `#/account`, as in the reference. The seven
  booking steps and their routes are unchanged; `#/book/3` is still its placeholder (C010).

## Model

A saved address is `{ id, label, address, locationNote, place }`. `place` is the C008 illustrative
point (`{kind, x, y, label}`, positions in the 700×500 drawing) or `null` — never coordinates.

The session gained `addresses` and `addressSequence`. A new record gets `ADR-<n>` from the
sequence, which only grows, so ids are deterministic and never reused. Nothing uses array indexes,
the clock, random values or the address text as identity (the reference's `uid()` uses the clock
and `Math.random()`; ids are not shown, so this is not observable).

Three things are kept apart and never share a nested object (unit-tested):

| Thing | Changed by |
| --- | --- |
| Address book (`state.addresses`) | account «حفظ العنوان» and «حذف العنوان» only |
| Booking draft (`state.draft`) | step chip, booking editor «اعتماد هذا المكان», C008 commands |
| Editor values (component state) | typing, map, sample chips, saved chips, location answer |

## Save rules (the reference's `saveAddress`)

- The form trims; the address needs at least 4 and at most 160 characters; the access note at most
  160; the label at most 30.
- Two different label fallbacks exist in the source and both are kept: the **form** turns an empty
  label into «مكان الغسيل»; the **save helper** turns one into «عنوان محفوظ» (reachable only from
  booking confirmation, which sends the draft straight to the helper).
- The helper looks for the requested id first, then for a record with the same trimmed address,
  and only then inserts.
  - Adding an address that already exists updates that record (label, note, pin) — no duplicate.
  - Editing record A to record B's address updates A and leaves B alone. Two records may then hold
    the same address; nothing is merged or removed. There is no global uniqueness rule.
  - Records keep their id and their position in the list.
- Capacity is 20. Updating, and adding an address that matches an existing one, still work when
  the book is full.

### Deliberate differences from the reference

1. **Full book.** The reference refuses the 21st record, shows «وصلت إلى حد 20 عنوانًا محفوظًا.» and
   then immediately replaces it with «تم حفظ العنوان.» although nothing was stored. The port leaves
   the state unchanged, returns to the list and shows only the capacity notice. Tested on both
   pages: everything but the notice matches.
2. **Stale target.** The reference's helper, given an id that no longer exists, falls through and
   inserts or overwrites by address. The port answers `missing` and changes nothing. Not reachable
   through the interface.
3. **Save preference and a saved chip in the booking editor.** The reference does not track the
   tick in its temporary values, so redrawing the sheet for a saved chip restores the tick to what
   it was when the sheet opened; an untick made before the chip is lost. The port keeps the
   customer's choice. The parity run therefore does not untick before a chip; the candidate-only
   run asserts the kept choice.
4. **Record ids** are `ADR-<n>` instead of clock/random strings (not observable).

## Account add, edit, delete

One sheet moves between three views, as the reference does:

- **List** «عناويني المحفوظة»: each record with edit and delete buttons named after its label, or
  the empty text; «إضافة عنوان».
- **Editor** «مكان سيارتك، بكل بساطة.»: the shared form without saved chips and without the save
  preference; its button is «حفظ العنوان». Add starts empty with label «المنزل»; edit starts from a
  copy of the record. A refused save keeps the editor open, shows the message and focuses the
  field. A valid save returns to the list and confirms with «تم حفظ العنوان.».
- **Delete** «حذف هذا العنوان؟»: «حذف العنوان» removes the record, returns to the list and confirms
  with «تم حذف العنوان.»; «رجوع» returns without deleting. Nothing is deleted on the first tap.

Closing the sheet or pressing Escape from any view discards whatever was not saved.

An account edit or delete never rewrites a past order, and never rewrites a draft that already
copied the address (unit and browser tested).

## Location step and booking editor

- Chips above the map card when the book is not empty; none when it is empty.
- A chip copies address, label, note and a cloned pin into the draft, clears the step's message
  and marks itself. It does not advance, save, create an order, raise a notice or touch the price,
  and it leaves the save preference as it was.
- A chip is marked when the draft's address text equals the record's — the reference's rule. The
  draft stores no selected-address id.
- Inside the booking editor the same chips fill the **temporary** values and redraw the map on the
  record's pin. The draft changes only with «اعتماد هذا المكان»; closing discards.

## Booking prefill and deferred confirmation

`startBooking` (Home's call to action and the package cards) gives a draft **with no address** the
first saved address, as `start()` does. A written, resumed or repeat-derived address is never
replaced, and prefill is a start command only — no view or route visit runs it.

Save timing, which C009 does not change:

| Action | Effect |
| --- | --- |
| Account «حفظ العنوان» | updates the address book of this session |
| Booking «اعتماد هذا المكان» | updates the unsent draft only |
| `draft.saveAddress` | a preference for confirmation |

In the reference, `confirmOrder()` calls `saveAddress(d)` when the preference is on. Confirmation
is not implemented. `saveAddressRecord(state, data, null)` is the integration point for the sprint
that ports it; a unit test asserts that nothing calls it for a draft today — not Apply, Next, Exit
or Resume.

## Shared editor extraction

C008's editor lived in `features/booking/location`. Both the account and the booking journey now
need it, so it moved — not copied — to `widgets/address-editor/` (the layer C005's vehicle editor
established):

| Moved | To |
| --- | --- |
| `components/AddressSheet.tsx` | `widgets/address-editor/AddressEditor.tsx` (`AddressEditorForm`, `AddressEditorSheet`) |
| `components/IllustrativeMap.tsx` | `widgets/address-editor/IllustrativeMap.tsx` (unchanged) |
| `deviceLocation.ts` | `widgets/address-editor/deviceLocation.ts` (unchanged) |
| editor and map rules of `location.css` | `widgets/address-editor/address-editor.css` |

The widget imports only `state` and `shared`. The form takes `context: 'booking' | 'account'`,
initial values and callbacks; domain commands stay in `state/`. Map drawing bytes, pan/zoom/keyboard
rules, validation and the C008 privacy boundary are unchanged, and every C008 test still runs
against the moved files.

Each opening of the account editor is a new mount (`key` = an opening counter), and a
device-location answer is dropped unless the editor that asked is still mounted. So an answer that
arrives after close, reopen or a switch to another record cannot change a newer editor or raise a
stale notice (browser-tested with a delayed stub).

`shared/Sheet.tsx` gained an optional `contentKey`: when one open sheet changes view it returns to
its top and, if the focused control left with the old view, takes focus itself so focus never
falls out of the dialog. Sheets that do not pass it behave exactly as before.

## Session-only storage and privacy

- "Saved" means held in the memory of the current page session. Records survive in-app navigation
  and are gone after a reload, which starts again from the selected fixture. Both are tested.
- No `localStorage`, `sessionStorage`, IndexedDB, cookie, request, service, table or message. The
  browser run asserts 0 requests after load, 0 storage entries and an empty cookie.
- Approved copy that speaks of the device — «احفظ العنوان على جهازي للحجز القادم.», «بيانات تجريبية
  على جهازك», «ملف محلي بسيط» — is kept verbatim, as in earlier sprints: it is the approved wording
  of the reference running with storage unavailable, and no screen claims a completed durable save.
- Fixtures use synthetic addresses only and hold no coordinate-like number.
- Labels, addresses and notes are rendered as text. A fixture record and a typed value containing
  markup are shown literally; no element is created.
- Scenario ids go through the own-property allowlist (`__proto__`, `constructor`, `toString`
  rejected).
- Geolocation is unchanged from C008: opt-in from «موقعي الحالي» only, coordinates reduced to
  in/out of range inside the callback and dropped. Account add/edit/delete makes no location call
  (the browser run counts them). The reference's range discrepancy (centre numbers are Riyadh's,
  labelled Damascus) is still documented in `C008_LOCATION_MAP.md` and still not changed.

## Deterministic scenarios

Selected with `?scenario=<id>`; anything unknown falls back to `home-empty` (empty book).

| Scenario | Address book |
| --- | --- |
| `home-empty` | empty |
| `addresses-one` | one record |
| `addresses-three` | home; a long address with note and off-centre pin; a markup-like label with no pin |
| `addresses-full` | 20 records |
| `addresses-draft-from-book` | three records; the draft already uses the second |

## Earlier assertions changed

| File | Old meaning | Superseded by | Replacement |
| --- | --- | --- | --- |
| `tests/unit/c008-…test.mjs` "save-address" | the session has no `addresses` collection | C009 adds the address book | applying a booking place leaves `state.addresses` identical (and still adds no key) |
| same, "scope" | no saved-address identifiers exist in C008 sources | C009 implements them | the time-step half of the test is kept; saved-address behaviour is covered by the C009 unit file |
| same, privacy / architecture / safety / copy | read the editor from `features/booking/location/**` | the editor moved to `widgets/address-editor/**` | the same checks read the new paths; the widget files are added to the checked set |
| `scripts/c008/browser-acceptance.mjs` | comment "no saved-address UI leaked" | — | comment only; the assertion (no chips for an empty book) is unchanged |

No visual, map, validation, pricing, navigation or geolocation check of C008 was removed, and no
tolerance was changed.

One shared correction: the `help` icon in `shared/Icon.tsx` did not match the reference's `i-help`
path. It had only been used by an unported placeholder header, so no earlier comparison saw it;
the account screen shows it and the pixel comparison found the 7-pixel difference. The path is now
the reference's.

## Accessibility

- The account rows are native buttons; «عناويني» announces a dialog. Deferred controls say they are
  disabled.
- The sheet is a native modal dialog in every view: background inert, Tab stays inside with a
  visible ring on each stop, Escape closes, focus returns to the row that opened it, and scrolling
  is unlocked. Every input has a label and ids stay unique.
- Focus stays inside the sheet across list → edit → list → delete → list, including after the
  focused delete button disappears with its record. Reopening right after closing is not disturbed
  by the earlier close.
- Edit and delete buttons carry the record's label in their name; notices are `role="status"`,
  validation `role="alert"`.
- Sheet buttons and account rows are at least 44×44 CSS px at 320 and 1440.

This is evidence for the tested behaviour, not an accessibility certification.

## Parity methodology

`scripts/c009/browser-acceptance.mjs` uses the C004 helpers unchanged: candidate and approved HTML
in the same Chromium build under the F010 rendering contract, failing on any difference in element
count, geometry (>0.5px), computed style, visible text, title, scroll position or full-page pixels
(allowed diff ratio 0, channel threshold 8 — the inherited values).

- 13 states × 320/390/430/768/1024/1440, plus 2 states at 390×560: account with an empty and a
  populated book; list empty, populated and full; add form; edit form with long text; invalid
  form; delete confirmation; location chips; chip selected; booking editor with chips and with a
  chip chosen.
- Interaction parity, same input on both pages, state compared after every step: the account
  lifecycle; validation; duplicate; id-first collision; samples and map in the account editor;
  update at capacity; step chips; editor chips with discard and apply; booking apply.
- Reference navigation uses the prototype's own routes (`#book/3`); the port's use `#/book/3`. The
  prototype ignores a Next within 350 ms of an accepted Next, so the run waits out that interval
  on the reference page's own clock before each further Next (the C008 repair's approach, restated
  locally rather than imported). No timeout was raised and no click is retried.

The reference runs with its storage writes refused (its own "this session only" state), as in
C004–C008. "0 differing pixels" is the comparator's result under that contract on the tested
build; it is not a claim about every device or renderer.

## Deferred

- Booking confirmation and the save it performs when `draft.saveAddress` is on.
- Time step → C010; contact, payment, review → later sprints.
- Profile editing, payment codes, payment tour, motion setting, help, privacy sheet, export, reset.
- Real address storage, validation, service area, geocoding → Customer/Location services.

## Known limitations

- Saved addresses do not survive a reload.
- Account parity is limited to presentation plus the address surface (see Ownership).
- The three deliberate behavioural differences listed above.
- English/LTR is not part of the approved customer reference.
- Evidence covers the tested Chromium build and fixtures only.
