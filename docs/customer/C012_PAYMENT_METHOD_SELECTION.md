# C012 — Customer payment method selection

Status: React port of the approved booking payment-choice step (`#/book/5`; `#book/5` in
the prototype). This sprint selects a method only. It does **not** create a payment intent, show a
wallet QR, contact Sham Cash or Syriatel Cash, upload proof, verify funds, collect cash, confirm a
booking or claim production payment readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`.
- Owned reference behavior: `PAYMENT_METHODS`, `methodOf()`, `paymentChoiceView()`, the
  `paymentMethod` change handler, `validate(5)` and the payment rule of `guardStep()`.
- Earlier customer sprints remain authoritative for vehicle, care/extras, location/address,
  scheduling and contact.

## Flow ownership

C012 owns the sixth of the seven booking screens (index 5):

Vehicle → Care → Location → Time → Contact → **Payment** → Review.

Header Back returns to Contact with its values intact. A valid Next enters `#/book/6`. Review
(C013) and booking confirmation (the booking confirmation sprint) remain deferred.

## Source → behavior → implementation → test

| Reference source | Behavior | Implementation | Tests |
| --- | --- | --- | --- |
| `PAYMENT_METHODS` | three methods, source order, names/hints/icons/tones | `PAYMENT_METHODS` in `state/paymentStep.ts`; ids in `PAYMENT_METHOD_IDS` (`state/bookingDraft.ts`) | unit "catalog", "one closed method rule" |
| `methodOf(d)` (`Object.hasOwn`) | unknown ids and prototype keys are no method | `isPaymentMethodId` (`state/bookingDraft.ts`), reused by the selector, Next, the entry guard and `paymentMethodDefinition` | unit "one closed method rule", "unknown or prototype method" |
| `paymentChoiceView()` | heading, hero total, radios, selected note, safety copy, fees disclosure | `features/booking/payment/PaymentStep.tsx`, `payment.css` | browser visuals at six widths + short viewport |
| change handler | select, clear error, announce name and total | `selectPaymentMethod`; total computed from the draft the transition applies to | unit "selecting each method"; browser "switch all approved methods" |
| `validate(5)` | refused Next keeps Payment, shows and announces the approved error, focuses the group | `submitPaymentStep`; `PaymentStep` focus handling | unit "Next with no method"; browser `payment-error` visual and "validation clears" |
| `guardStep()` (`step>5&&!methodOf`) | Review cannot be entered without a known method; earlier prerequisites first | `resolveBookingEntryStep` | unit "guard priority", "entry guard"; browser direct-entry and expired-clock checks |
| `cleanDraft()` | a stored unknown method becomes `null` | `draftFromOrder` in `state/bookingEntry.ts` | unit "repeat never carries an unknown one" |
| `bookingFooter()` | current price, duration, Next label «مراجعة الحجز», price details | shared `BookingFooter` | browser "price details sheet" |

## Exact method catalog

1. `cash` — «كاش بعد الغسيل»
2. `sham` — «شام كاش»
3. `syriatel` — «سيريتل كاش»

A fresh draft keeps `paymentMethod: null`; C012 does not silently default to cash. Selecting a
method updates only the unsent draft (`paymentMethod`, `touched`) and the polite announcement. It
does not change the total or duration and does not touch contact, slot, address, note, garage,
address book or orders. The one existing illustrative calculation (`illustrativeCost`) is used;
no wallet surcharge, market price or conversion rate is introduced.

## Validation and guards

Next with no method stays on Payment and reports «اختر كيف ستدفع قبل متابعة الحجز.». The fieldset
is described by the error and becomes the focus target, matching the reference's non-input
validation target. Selecting a method clears the error. Valid Next moves the draft to step 6
without confirming anything.

The shared booking-entry resolver is the prerequisite authority at `#/book/5` and `#/book/6`,
evaluated with the injected clock: an invalid plate, a missing location, an appointment that is no
longer offered and invalid contact data are reported in that order, before the payment rule. A
valid method cannot carry an expired appointment forward. A corrected entry replaces the link;
because the session lives in memory only, a reload starts a new session at that route and is
guarded again.

## Safety boundary

The screen states that WashGo does not request a wallet password or verification code. C012 does
not include the reference's later QR/checkout/payment-state module. It creates no order, payment
intent, merchant record, proof image, external request or browser storage. The selected note's
`qr-pay` icon is decorative; no QR content is generated. The browser acceptance observes the
running page: no request after the initial loopback page load, no storage or cookies, no QR or
canvas element.

## Accessibility

The three methods are a native radio group in a fieldset with a legend; the group is one Tab stop
and arrow keys change the choice natively. Focus-visible styling is on the focused radio's card;
errors use an alert and a described-by relationship. The amount/fees disclosure is a native
`details` toggled by Enter. Reduced motion is the rendering contract's default; selection is also
compared with motion allowed.

## Deterministic scenarios

`booking-payment-empty`, `booking-payment-cash`, `booking-payment-sham` and
`booking-payment-syriatel` reuse the valid Contact fixture under the contract's fixed instant
(2026-09-20 12:00, Damascus). They contain no real financial or personal data.

## Defects corrected before acceptance

| Defect | Evidence | Correction |
| --- | --- | --- |
| Workflow file ended with a blank line; `git diff --check` (F001 `diff-whitespace`) failed and cascaded to F007/F009 | run 37132857491 job 111231276000 | trailing blank line removed |
| An extra `aria-hidden` span repeated the selected method's short name («كاش») after the screen; the reference has none | run 37132857555, `payment-cash@320` text drift | span removed |
| The Review guard accepted any non-null method (`'card'`, `'__proto__'`) and `paymentMethodDefinition('__proto__')` returned `Object.prototype` | local probe on `75f50c5` | one closed id rule shared by guard, selector, Next and lookup |
| Repeating an order carried an unknown stored method into the draft | local probe on `75f50c5` | method sanitized as in `cleanDraft()` |
| The announced total was a render-time memo, not the transitioned draft | source review | computed inside the transition |
| Browser test pressed header Back (a push) and then browser Forward, which has no entry | test review | split into header-Back→Contact-Next and genuine browser Back/Forward |
| Radios were selected with `.check()` on a visually hidden input that the card covers | local run | the customer action (tap the option card) is used |

## Superseded earlier assertions

| Old invariant | New owner | Replacement assertion |
| --- | --- | --- |
| C002 browser: `#/book/5` shows `booking-payment-default` | C012 entry guard | an empty draft at `#/book/5` and `#/book/6` shows `booking-location-default`; C012 verifies Payment with complete prerequisites |
| C008/C010/C011 unit: payment is not mounted | C012 | Payment is mounted; Review (C013) is not |
| C011 browser: valid Contact Next reaches the deferred footer | C012 | it reaches the Payment screen with the booking footer |

## Limitations

- Pixel parity is authoritative only on the Linux CI rendering contract; Windows runs are
  interaction-only.
- The illustrative amount is a fixture figure, not a price from Pricing or Billing.
- No accessibility certification is claimed.

## Deferred ownership

C013 owns Review. The booking confirmation sprint owns `confirmOrder()`. Later payment work may own
QR display, wallet transfer instructions, proof, verification, payment states, refunds or cash
collection. C012 intentionally implements none of those capabilities.
