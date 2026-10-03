# C012 — Customer payment method selection

Status: React port of the approved booking payment-choice step (`#/book/5`; `#book/5` in
the prototype). This sprint selects a method only. It does **not** create a payment intent, show a
wallet QR, contact Sham Cash or Syriatel Cash, upload proof, verify funds, collect cash, confirm a
booking or claim production payment readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`.
- Owned reference behavior: `PAYMENT_METHODS`, `paymentChoiceView()`, the
  `paymentMethod` change handler and `validate(5)`.
- Earlier customer sprints remain authoritative for vehicle, care/extras, location/address,
  scheduling and contact.

## Flow ownership

C012 owns booking step 5 of seven:

Vehicle → Care → Location → Time → Contact → **Payment** → Review.

Back returns to Contact. A valid Next enters Review. Review and confirmation remain deferred.

## Exact method catalog

1. `cash` — «كاش بعد الغسيل»
2. `sham` — «شام كاش»
3. `syriatel` — «سيريتل كاش»

A fresh draft keeps `paymentMethod: null`; C012 does not silently default to cash. Selecting a
method updates only the unsent draft and the polite announcement. It does not change total or
duration.

The same illustrative total is displayed for every method. No wallet surcharge is introduced.

## Safety boundary

The screen states that WashGo does not request a wallet password or verification code. C012 does
not include the reference's later QR/checkout/payment-state module. In particular it creates no
order, payment intent, merchant record, proof image, external request or durable browser state.

## Validation

Next with no method stays on Payment and reports:

«اختر كيف ستدفع قبل متابعة الحجز.»

The fieldset is described by the error and becomes the focus target, matching the reference's
non-input validation target. Selecting a method clears the error. Valid Next moves the draft to
step 6 without confirming anything.

The shared booking-entry resolver remains the prerequisite authority: missing location, an expired
appointment or invalid contact data cannot be bypassed by a payment choice.

## Accessibility

The three methods are a native radio group in a fieldset with a legend. Focus-visible styling is
on the selected radio's card; errors use an alert and described-by relationship. The amount/fees
disclosure is a native `details`.

## Deterministic scenarios

C012 adds synthetic, allowlisted payment scenarios for empty selection and the three approved
methods. They reuse a valid Contact fixture and contain no real financial or personal data.

## Deferred ownership

C013 owns Review. Later payment work may own QR display, wallet transfer instructions, proof,
verification, payment states, refunds or cash collection. C012 intentionally implements none of
those capabilities.
