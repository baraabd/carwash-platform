# C011 — Customer contact details / technician note

Status: React port of the approved contact step (`#/book/4`; `#book/4` in the prototype), driven by
the in-memory draft and deterministic fixtures. It does **not** authenticate anyone, create an
account, verify a number, send a message or call, or write the account profile.

**Delivery history:** C011 was developed stacked on C010, from the C010 head
`8995b36f5f1bbee34228c28e4b565f34b8b7ba31`. Its PR #34 (reviewed head
`714dfb36bfbdad4c79465f7bc296116880cf9940`) was merged into `feat/C010-scheduling-time-selection`
(merge `1f874fc`) rather than `main`, after C010 itself had reached `main` through PR #33. A
separate integration PR (`integrate/C011-main`) promotes that reviewed result to `main` without
changing the implementation.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`, unchanged.
- Language/direction: Arabic / RTL; the number field is LTR inside the RTL page, as in the reference.

## Source → behaviour → implementation → test

| Reference | Behaviour | Implementation | Test |
| --- | --- | --- | --- |
| `contactView()`, `field()` | heading, two required fields, hint, demo button, note disclosure, privacy note | `features/booking/contact/ContactStep.tsx`, `contact.css` | browser visual states |
| input handler (`name`/`phone`/`note`) | value stored as typed, capped 60 / 24 / 300; that field's error removed | `state/contactStep.ts` `editContactField`; component clears the field's message | unit "typing"; browser "editing clears only its own message" |
| `phoneOK()`, `digits()` | optional `+`, 8–15 digits after Arabic-Indic/Eastern digits → Latin and removal of spaces, `()` and `-` | `state/bookingDraft.ts` `isContactPhoneAcceptable` (single rule, also used by the entry guard) | unit "phone rule"; browser phone cases |
| `validate(4)` | name ≥ 2 after trimming; then number; messages in that order | `isContactNameAcceptable`, `validateContact`, `submitContactStep` | unit, browser refusals |
| `next()` failure path | stays, shows messages, focuses the first invalid field | component effect after render | browser focus checks |
| action `demo-contact` | sets `سامر التجريبي` / `0900000000`, clears all messages, notice | `fillDemoContact` | unit, browser |
| `render()` after refusal / demo | the note disclosure is redrawn closed | `<details key={redraws}>` | browser "a refused Next closes…" |
| `start()` | empty name/number filled from the profile, typed values never replaced | unchanged C003 `startBooking` | unit "prefill" |
| `guardStep()` | step > 4 needs valid contact; earlier steps first | `resolveBookingEntryStep` (now via the shared rules) | unit "guard" |
| `profileSheet()` | inspected only: the account editor, with an optional number | **not implemented** (deferred account control) | — |
| `confirmOrder()` | inspected only: copies name/number into the profile on confirmation | **not implemented** | unit: Next writes no profile |

## Data model

| Reference | Draft field | Meaning |
| --- | --- | --- |
| `name` | `contactName` | booking name, as typed |
| `phone` | `contactPhone` | contact number, as typed (digits not converted) |
| `note` | `note` | note for the technician, multiline, optional |

`note` is **not** `locationNote` (the address access note from C008); a unit and a browser test show
neither overwrites the other. Typing writes the draft directly (no separate save); limits are
enforced in the command as well as by `maxlength`. Validation reads a cleaned copy and never
rewrites the typed value: leading zeroes, spaces, parentheses, a leading `+` and Arabic digits stay
as typed.

## Validation timing

- On **Next** only. Errors: «أدخل اسمًا من حرفين على الأقل.» and «أدخل رقمًا تجريبيًا من 8 إلى 15 رقمًا.»
  The first invalid field (name, then number) receives focus and is scrolled into view; each field
  carries `aria-invalid` and, while it has a message, `aria-describedby`.
- **Editing a field removes that field's message at once**, as the reference does. That says nothing
  about the new value; the next Next checks again.
- The number check is a demo format check, not reachability, ownership or E.164 validity. No country
  is assumed, no prefix is forced and no phone library is added.

## Disclosure, demo fill and prefill

- «ملاحظة للفني — اختياري» is a native `details`. Collapsing never clears the text. As in the
  reference, a refused Next or the demo fill redraws the step and the disclosure comes back closed.
- The demo fill changes only name and number, clears both messages and shows its notice; the note,
  appointment, vehicle, package, extras, address and payment stay. It sends nothing and writes no
  profile.
- Start fills an empty name/number from the profile; it never overwrites typed values and is not
  repeated on render. A repeat copies the order's details into the new draft; editing them never
  changes the order.

## C010 integration

C010 remains the authority for appointments and the clock. The contact step neither reads the
clock nor touches the day, time or list expansion. The entry guard keeps its order: a missing
address returns to location and a missing or expired appointment to the time step, even with valid
contact details. Back goes to the real time step with the appointment intact; valid Next goes to
`#/book/5`, still the C012 placeholder.

## Differences from the reference

- **Focus after the demo fill.** The reference's redraw drops focus to the page; the port keeps it on
  the button. The parity run leaves that one focus target out of the compared state and asserts the
  port's behaviour separately.
- **Route-entry focus** on a first page load stays on the skip link (the port's C003 decision).

## Privacy

Session memory only: no storage, cookie, request, analytics, SMS, call, email or calendar action,
no verification flag and no profile write. Values are rendered as text and are not put in URLs.
Fixtures and evidence use synthetic names and numbers only. The approved note «يُحفظ الحجز في هذا
المتصفح فقط» is kept verbatim under the established session-only interpretation; nothing here claims
a durable save.

## Earlier assertions changed

| Old invariant | New owner | Replacement |
| --- | --- | --- |
| C008 unit: contact (C011) is not ported | C011 | payment (C012) is not ported |
| C010 unit: contact (C011) is not ported | C011 | payment (C012) is not ported |
| C010 browser: `#/book/4` shows the deferred footer | C011 | `#/book/4` renders the contact form with the booking footer |

No map, address-book, scheduling, pricing or privacy check was removed and no tolerance changed.

## Evidence conditions

`scripts/c011/browser-acceptance.mjs` uses the C004 helpers under the F010 rendering contract and the
contract's fixed instant, under which the fixtures' appointment (2026-09-21 10:00) is offered.
Reference routes are `#book/N`, port routes `#/book/N`; the prototype's 350 ms Next guard is waited
out on its own performance clock. Local heavy tasks run one at a time with one preview server whose
served bundle is checked against the build.

## Deferred

Payment (C012), review and confirmation, the account profile editor, authentication and OTP.

## Known limitations

- The draft, including contact details, does not survive a reload.
- The C011 workflow also runs the C002–C010 browser suites. That was added while the PR was
  stacked (the main/develop-filtered workflows did not run then); on `main` it is redundant with
  those workflows but harmless.
