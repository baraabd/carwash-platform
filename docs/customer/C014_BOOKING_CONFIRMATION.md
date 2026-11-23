# C014 — Session booking confirmation and order handoff

Status: explicit confirmation of a **demo** booking on Review (`#/book/6`), creation of one
immutable order in the current in-memory session, and an honest handoff on the existing
`#/order/:id` (cash) and `#/pay/:id` (wallet) routes.

A C014 order really exists in session state after success. It is **not** a booking with any
service, not a reservation of a technician or a time, not a payment, not a receipt or invoice, and
not durable: reloading the page ends the session and the order with it.

## Working sprint ID

C013's documentation names a deferred "booking confirmation sprint" without a number. This
sprint assigns that scope the working ID **C014**. It is a new mapping recorded here, not an
older numbered contract; no earlier C014 plan (for example a wallet-QR plan) is implemented.

## Authority and scope

- Golden HTML (read-only): `design/reference/approved/washgo-payments-interactive.html`.
- Source behavior: `confirmOrder()`, `next()` at REVIEW, `validate()`, `guardStep()`,
  `cleanDraft()`, `blank()`, `cost()`, `saveCar()`, `saveAddress()`, `createPayment()` (initial
  state only), `quickRebook()`, `go(…, true)`, `routeHash()`, `homeView()` order entries.
- Not ported: `trackingView()`, `checkoutView()`, merchant/QR configuration, proof, payment state
  transitions (`paid_demo`, `cash_collected_demo`, review/refund), cancellation, rating, stage
  simulation. These remain later sprints.
- No API, database, migration, broker message, capacity reservation, remote pricing, wallet,
  notification, authentication, browser storage or cookie.

## Source → behavior → implementation → test

| Group | Reference | Behavior | Implementation | Tests |
| --- | --- | --- | --- | --- |
| A | `next()` at REVIEW → `confirmOrder()` | the final Review action confirms | `ReviewStep` → `confirmBooking` (`state/bookingConfirmation.ts`) | unit "cash, sham and syriatel…"; browser transitions |
| A | `validate(0,2,3,4,5)` in order | refusal returns to the owning step with its message, editing off, history replaced | `resolveBookingEntryStep` at the event instant + step messages | unit "refusals…"; browser "expired appointment refused to Time" |
| A | normalisation in `confirmOrder()` | plate digits/spaces, number without spaces/()-, name trimmed ≤60, at confirmation only | `confirmedPlate/ContactPhone/ContactName` (`state/bookingDraft.ts`) | unit "normalises…" |
| A | `saveCar()` / `saveAddress()` when preferred | match → update; else add; full (30 / 20) → nothing stored | `saveVehicleRecord`, `saveAddressRecord` with outcomes | unit "save preferences…", "full garage…"; browser garage/account comparison |
| A | order `{...d, id, stage:0, createdAt, total, payment}` | newest first, history of 80 | `CustomerOrderSnapshot.confirmation` | unit "snapshot…", "ids… 80" |
| A | `createPayment()` | `cash_due` / `awaiting_transfer`, amount, SYP, nothing submitted or verified | `InitialOrderPayment` | unit; handoff copy from `PAYMENT_STATES` |
| A | `S.profile = {name, phone}`; `S.draft = blank()` + contact | profile updated, draft reset with contact | transition | unit "accepted draft is reset…"; browser Home greeting |
| A | `go(cash ? 'tracking' : 'payment', 0, true)` | cash → `/order/:id`, wallet → `/pay/:id`, replacing history | `state.pendingHandoff` followed by the Review route | browser transitions, history |
| A | `cleanDraft(o)` in `quickRebook()` | unknown size/package → blank's; known add-ons once | `draftFromOrder` guards (scoped audit) | unit "repeat entry sanitises…" |
| B | (hardening) | at-most-once per reviewed draft; replay/conflict/stale outcomes | draft generation + fingerprint + receipts | unit replay tests; browser dblclick/keyboard |
| B | (hardening) | an unexpected failure commits nothing | `try` around preparation; failure notice | unit "unexpected failure…" |
| C | session-only differences | see "Deliberate differences" | | |
| D | tracking, checkout, QR, proof, stages | deferred | handoff only | |

## Atomicity and replay (one session)

`confirmBooking(state, { key, fingerprint, now, catalog })` is pure: it reads no clock (the
instant is read once in the click handler), generates no random value and mutates nothing.
`CustomerSessionProvider.run` evaluates it once against the latest state and stores the result
(it never passes React a replayable updater), and navigation follows that same result.

- **key** = `state.draftGeneration` when Review rendered; **fingerprint** = `draftFingerprint`
  of that draft (every recorded value; `touched` excluded).
- Accepted → a receipt `{ key, fingerprint, orderId }` is kept (newest 10) and the generation
  advances. The same command again is `replay` (no new order, id, profile or save); the same key
  with another fingerprint is `conflict`; a command for an older generation or a changed draft is
  `stale` (a fresh look at Review is needed).
- Two activations before a render: the second runs against the state the first produced and
  replays (browser: double-click and double Enter create one order).
- A refusal consumes nothing; correcting the draft allows a fresh attempt. A later, deliberately
  identical draft is a new generation and a new order. An accepted replay stays a replay after the
  appointment's time boundary.
- Back/Forward, re-render, remount, reload and returning to an old Review do not submit: the
  transition is called only from the click handler.
- **Not claimed**: cross-tab, reload or server exactly-once. This is one in-memory session.

## Order model

`CustomerOrderSnapshot` gains an optional `confirmation` record: `createdAt` (ISO of the action
instant), the quoted `total` and `minutes`, `carId`, a cloned `place`, and the initial payment.
Demo fixture orders have no record; their dates, totals and payment states are not invented, and
the handoff shows no amount or payment state for them. Ids are `WG-SESSION-<n>` from
`state.orderSequence`, skipping any id already present; only an accepted confirmation advances it.
The order's add-ons are the displayed choices in order; the recorded total is the bill's (each
add-on once, never one the package includes) and is never recomputed from a later draft.

## Save outcomes

`saveVehicle`/`saveAddress` false → `off`, nothing changes. True → `added` or `updated` by the
existing match rules (car: linked id, else plate+size, else name+size+colour; address: same text).
At capacity (30 cars, 20 addresses) → `capacity`: the booking still succeeds, nothing is stored,
and the notice says so after the success sentence («وصلت إلى حد 30 سيارة في النموذج…»,
«وصلت إلى حد 20 عنوانًا محفوظًا.»). No confirmation message claims device storage. Ordinary
Payment Next, Review entry/edit/exit, refusals and replays never save.

## Handoff

The confirmed order is shown on the existing routes by `widgets/order-handoff`: the session
disclosure, the initial payment state with the reference's own `PAYMENT_STATES` wording
(«كاش بعد الغسيل» / «بانتظار التحويل» and their hints), a wallet note that no QR or transfer
details exist yet, the recorded amount, the shared receipt (`widgets/order-receipt`, moved
unchanged from Review) and «العودة إلى الرئيسية». An unknown id, a malformed id or a link opened
after a reload shows «لم نجد هذا الطلب في هذه الجلسة.» with the same Home action. Home's active-
order banner and the bookings badge count the new stage-0 order. The header action of these
routes (order details / payment help) has no behaviour yet and is natively disabled. The C002
deferred footer on `/pay/:id` («متابعة الدفع», disabled) is unchanged.

## Deliberate differences from the reference

Declared before comparison in `scripts/c014/browser-acceptance.mjs` and
`scripts/c013/browser-acceptance.mjs`:

1. **Disclosure** under the bill: «ينشئ التأكيد طلبًا تجريبيًا لهذه الجلسة فقط، بلا حجز أو دفع.»
   replaces the reference's device-request sentence (shortened from the brief's example so it
   stays one line at 320 px, as the sentence it replaces).
2. **Wallet copy**: no QR exists, so «يظهر QR بعد التأكيد…» → «لا يظهر QR في هذا النموذج. لا
   يُحصَّل أي مبلغ.», «QR بعد المراجعة · التحقق قبل بدء الخدمة» → «المحفظة غير مفعّلة بعد · لا
   تحويل الآن», and the label «تأكيد الحجز وعرض QR» → «تأكيد الحجز التجريبي».
3. **Notice**: «تم إنشاء الطلب لهذه الجلسة. لا حجز فعلي ولا دفع.» (the reference's session-only
   variant says «…التخزين المحلي غير متاح.»), plus capacity warnings.
4. **Ids**: a session sequence instead of time+random.
5. **Destination screens**: a minimal handoff, not the reference's tracking/checkout; not compared.
6. **Refusal display**: the reference shows the step's inline field error; here the owning step
   is opened and the same approved message is shown as the notice and announcement (step-local
   errors appear on that step's own Next).
7. **Safety**: unknown catalog ids are refused without a step message instead of the reference's
   silent fallbacks; the repeat-entry fallback is the reference's own `cleanDraft()` rule.

## Shared changes

- `BookingFooter`: an active action may be described (`describedBy`).
- `widgets/order-receipt`: the Review receipt markup, view model and CSS moved unchanged; Review
  renders the same DOM (the C013 browser suite compares it).
- `CustomerShell`: clears the pending handoff after the route leaves Review; disables the
  behaviour-less header action on the tracking/payment routes.

## Superseded earlier assertions

| Old invariant | C014 ownership | Replacement |
| --- | --- | --- |
| C008/C012 unit: Review's action is unavailable (`unavailableReasonId`) | confirmation | Review passes `onNext={confirm}` |
| C009 unit: `saveAddressRecord` is called only by the account command | confirmation saves | callers are the account command and `bookingConfirmation` |
| C013 unit: confirmation stays unavailable; wallet QR wording; receipt markup in `ReviewStep` | confirmation, wallet copy, shared receipt | confirm command wired; no QR promise; markup asserted in the widget |
| C013 browser: disabled-button style declared; label «وعرض QR»; clicking the action does nothing | confirmation | enabled style equals the reference; wallet replacements declared; activation tested in C014 |

Every pre-confirmation no-order check (Payment Next, edits, exit, resume, history) still applies.

## Tracked, not changed

- `VEHICLE_SAVED_NOTICE` (Garage editor, «…على جهازك.») still claims device storage. C014 does
  not use it; it remains for the Garage owner.
- The reference's `cleanDraft()` also drops add-ons the package includes when repeating; the state
  layer has no package catalog, so a repeated order may keep one in the displayed choices (the
  bill never charges it).
- StrictMode replay is exercised by the pure transition and the provider's non-updater `run`;
  a development-server StrictMode browser run was not performed.

## Tests

- `tests/unit/c014-booking-confirmation.test.mjs` (pure transition and view models).
- `scripts/c014/browser-acceptance.mjs`: reference transitions for cash, both wallets, saves on
  and at capacity (destination kind, Home banner/badge/greeting/draft, garage, address book);
  the public journey on both; edits then confirm for each method; double-click and keyboard
  replay; Back/Forward/reload/unknown id; expiry refusal; price sheet then confirm; handoff
  screens at 320–1440 and short heights (candidate-only records); shell fallback contract.
- `scripts/c013/browser-acceptance.mjs`: Review parity with C014's declared copy. Two
  adjustments made after failed local runs, both recorded: (1) the per-step state comparison
  now applies the same declared wallet replacements as the DOM comparison (run 1 compared the
  wallet line and label raw); (2) the wallet owned-area mask covers the whole payment receipt
  line instead of its detail `<p>`: run 2 showed one owned pixel at (252, 757), one column right
  of that box, whose geometry was identical on both pages (x 89–252) — ink of the replaced
  reference text's first glyph. The line's icon and method name remain DOM/style-compared.

## Limitations

Session memory only; amounts are illustrative fixture figures; Windows runs are interaction
evidence and Linux CI is authoritative for pixels; no accessibility certification is claimed.
