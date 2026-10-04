# C013 — Customer booking review, summary and edit-and-return

Status: React port of the approved seventh booking screen (`#/book/6`; `#book/6` in the
prototype) and of its «تعديل» edit loop. C013 shows the whole unsent draft, its bill and one edit
control per decision. It does **not** confirm a booking: the final action is shown but unavailable.
Nothing in C013 creates an order, reserves capacity, writes the profile, saves a car or an address,
creates a payment, shows a wallet QR, uploads proof, sends a notification or moves money.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html` (read-only;
  its hashes, baselines and the F010 comparison thresholds are unchanged).
- Owned reference behavior: `reviewView()`, `summary()`, `paymentSummary()`, `bill()`, `carName()`,
  `cost()`, `dateLabel()`, `timeLabel()`, the Review branch of `bookingFooter()`, and the
  `edit-step`, `back` and `next` handlers as far as they concern `S.editing`.
- Read for boundaries only: `confirmOrder()`, `saveCar()`, `saveAddress()`, `createPayment()`,
  `guardStep()`, `fromRoute()`, `go()`, `quickRebook()`, `start()` and the `resume` action.
- Earlier customer sprints (C003–C012) remain authoritative for their own screens.

## Flow ownership

C013 owns the seventh of the seven booking screens (index 6):

Vehicle → Care → Location → Time → Contact → Payment → **Review**.

No step is added, merged or renumbered. The booking confirmation sprint owns `confirmOrder()`.

## Source → behavior → owner → implementation → test

| Reference source | Observable behavior | Owner | Implementation | Tests |
| --- | --- | --- | --- | --- |
| `reviewView()` heading | `07 / كل شيء واضح`; normal «غسلتك، مثل ما تحب.»; repeat «نفس العناية، بموعد جديد.» and its description; chapter icon `check` | C013 | `features/booking/review/reviewViewModel.ts`, `ReviewStep.tsx` | unit "summary: wallet methods … repeat"; browser Review states, repeat Review |
| `summary()` receipt | vehicle art, package, `carName() · colour`, plate chip or «بدون لوحة في هذا النموذج»; care + add-ons or «بدون إضافات»; label (or «المكان»), address, access note; date · time, «بتوقيت دمشق · N دقيقة تقريبًا»; name and LTR number; payment line; optional «ملاحظتك للفني» | C013 | `buildReviewViewModel`, `review.css` | unit "summary: …" (4 tests); browser six widths + short height |
| `paymentSummary()` | method icon/name; «كاش بعد إتمام الغسيل» or «QR بعد المراجعة · التحقق قبل بدء الخدمة» | C013 (reuses C012 catalog) | `paymentMethodDefinition` | unit "summary: wallet methods" |
| `bill()` | «السعر، بدون مفاجآت.», package, size or «ضمن السعر», chargeable add-ons, visit line, total | shared | one `PriceBill` component used by Review and the footer sheet; `buildPriceBreakdown` over `illustrativeCost` | unit "bill: …" (2 tests); browser price sheet on Review |
| `bookingFooter()` at REVIEW | caption «إجمالي التجربة», check icon, «تأكيد الحجز التجريبي» / «تأكيد الحجز وعرض QR» | C013 | `BookingFooter` `totalCaption`, `nextIcon`, unavailable action | unit "confirmation stays unavailable"; browser keyboard check |
| `bookingFooter()` while `S.editing` | «العودة إلى المراجعة» on the step opened for editing | C013 | `decisionNextLabel(step, reviewEditing)` | unit "each «تعديل» opens …"; browser edit loops |
| `edit-step` | opens step 0–5, sets editing, clears errors | C013 | `openReviewEdit` (state), six «تعديل» buttons | unit "edit targets", "edit: each …" |
| `next()` while editing | validates the active step, then goes straight to Review and clears editing | C013 | `completeReviewEdit` wraps each step's existing `submit…Step` in one transition | unit "a valid Next returns …", "an invalid Next is refused …" |
| `back` while editing | returns to Review, clears editing, keeps live edits | C013 | `leaveReviewEdit` in the shell header | unit "header Back"; browser header Back |
| `back` on Review | Payment | C013 | `returnToPaymentStep` | unit, browser |
| `fromRoute()` / `go()` | browser history and any navigation outside the journey end editing | C013 | shell layout effect (`POP` or non-booking route → `endReviewEdit`); `startBooking`, `resumeBooking`, `repeatOrder`, `saveDraftAndExit` clear it | unit "edit mode ends …"; browser history and exit |
| `book-step` (Time «تغيير») | does not touch editing | C013 | an in-app PUSH keeps `reviewEditing` | browser "edit intent survives Time → Location" |
| `guardStep()` | invalid plate → 0, address → 2, appointment → 3, contact → 4, method → 5 | C003–C012 | existing `resolveBookingEntryStep` with the injected clock | unit "direct entry", "guard …"; browser direct entry and expiry |
| `confirmOrder()` | creates the order, saves preferences, creates the payment | booking confirmation sprint | **not ported** | unit "confirmation stays unavailable" |

## Edit-mode lifecycle

`CustomerSessionState.reviewEditing` is the minimal typed edit context. It is separate from
`bookingMode` (`standard`/`repeat`) and `showAllTimes`, and it never stores a copy of the summary.

- **Open**: «تعديل» runs `openReviewEdit(state, step, now)`. Only an integer 0–5 is accepted. The
  destination is `resolveBookingEntryStep(draft, step, now)`, so an edit opened after the
  appointment expired lands on Time directly instead of navigating to a screen that redirects.
- **Next**: each decision step runs `completeReviewEdit(submit…Step(current), now)` as one
  `run()` transition. A refused submission is returned unchanged (edit mode stays); a valid one goes
  to `resolveBookingEntryStep(draft, 6, now)` with `reviewEditing: false`. Outside edit mode the
  submission is returned unchanged, so ordinary sequential navigation is identical to C012.
- **Header Back**: `leaveReviewEdit` — Review, editing cleared, live changes kept (the reference
  keeps them too; inputs write to the draft as the customer types). Existing modal editors keep
  their own apply/cancel behavior.
- **Ends**: a `POP` (browser Back/Forward, a typed or reloaded link), any non-booking route,
  start, resume, repeat and save-and-exit. The shell applies it in a layout effect, before paint.
- **Survives**: in-app PUSH navigation inside the journey, such as Time's «تغيير» to Location.

## One bill, one calculation

Review, the footer total/duration and the price-details sheet all derive from the current draft
through `illustrativeCost` and `buildPriceBreakdown`; Review is rebuilt on every render (no
memoised snapshot). The footer's private bill component was extracted to `PriceBill.tsx` and is
used in both places. Each bill line now has a stable identity (`package`, `vehicle`,
`extra:<id>`, `visit`) used as its React key. No price engine, fee, service or market price was
added. A payment choice never changes the total or the duration; vehicle and package choices
change them only through the existing rules. Amounts remain illustrative fixture figures.

Displayed and chargeable add-ons are separate lists, as in the reference. The receipt lists the
draft's add-ons as they are, in order (`summary()` lists `d.extras`); only an id with no catalog
entry is skipped, because it has no name. The bill charges each add-on once and never one the
package includes (`cost()`). The receipt invents no omission to make the two lists agree; in the
reference's always-cleaned draft they coincide.

`illustrativeCost` now keeps only ids with a catalog entry, as `cost()` keeps only `EXTRAS[k]`.
Before, an unknown id (reachable by repeating a stored order) threw `Cannot read properties of
undefined (reading 'price')` and `__proto__` totalled `null` (probe on `58c18b5`); a unit test
covers `polish`, `__proto__` and `constructor`.

## Deliberate differences from the reference

Declared before any browser comparison (also at the top of `scripts/c013/browser-acceptance.mjs`):

1. **Review note, second line.** The reference says the confirm button creates a request on the
   device («زر التأكيد ينشئ طلبًا على جهازك، وليس فاتورة أو حجزًا فعليًا.»). That capability does
   not exist here, so C013 shows its own disclosure: «مسودة تجريبية لهذه الجلسة فقط. تأكيد الحجز
   غير متاح بعد.». It is not a quote from the golden source. Its wording was shortened from the
   example in the sprint brief so it stays one line at 320 CSS px like the sentence it replaces;
   the longer wording wrapped and changed the page height at 320. The first line (cash: «كاش بعد
   الغسيل. لا دفع مسبق.»; wallets: «يظهر QR بعد التأكيد. الدفع لا يُعتمد دون مطابقة.») is the
   source text; the disclosure directly beneath it states that confirmation — and so any QR — is
   not available.
2. **Final action.** «تأكيد الحجز التجريبي» / «تأكيد الحجز وعرض QR» is a native disabled button
   with `aria-describedby` pointing at that disclosure. It therefore takes the reference's own
   `button:disabled` rule (opacity .45, cursor not-allowed). It is not a Tab stop, has no click
   handler, and the footer's type allows either an active action or an unavailable one, never a
   button wired to nothing.
3. **Guarded return (safety).** The reference's edit-Back path renders Review without checking
   prerequisites. Here header Back, a valid edit Next and direct entry all pass through
   `resolveBookingEntryStep` at the action's instant, so a draft an edit made incomplete (or an
   appointment that expired) goes to its owning step instead of to an invalid summary.
4. **Edit targets.** The reference clamps `Number(value) || 0`, so a bad value opens Vehicle.
   Here unknown, negative, out-of-range, fractional, string and prototype-derived values open
   nothing.
5. **First-load focus** (inherited from C002, not changed here): the reference focuses the heading
   on the first page load; the candidate leaves focus alone so the skip link stays first. After
   every in-app screen change both focus the heading.

## Shared-support correction (separate commit)

Finding re-read on `bd72661`: `Sheet` set `document.body.style.overflow = 'hidden'` on open and
cleared it only in its `close` event handler. A dialog removed from the document while open never
fires `close`.

- **Reproduced** (probe on `bd72661`, Windows Chromium): Payment → Next → Review, open the price
  sheet, browser Back. The footer unmounts with the dialog open; `overflow` stayed `hidden` and a
  wheel scroll on Payment did not move (`scrollY` 0). The Save-and-exit path did **not** reproduce
  on that build (its `close` event fired before the header unmounted).
- **Cause (proven)**: the lock was released only by the `close` event.
- **Fix**: `shared/scrollLock.ts` keeps one lock per open sheet. The open effect acquires it and its
  cleanup releases it (owner close or unmount); the `close` event releases it too (idempotent).
  The previous overflow returns only when the last lock is released, so a late close never unlocks
  another open sheet. StrictMode's mount → cleanup → mount replay re-acquires the lock.
- **Evidence**: red on `bd72661` by the probe; green after the fix (same probe, `scrollY` 182).

A second lifecycle defect was then reproduced on `ac4fec6` (pre-existing, not introduced by C013):
**rapid reopen**. When the owner closes a sheet (`open` → false) and the customer reopens it before
the old `close` event arrives, that stale event called `onClose` and cancelled the newer open
request: two close events, sheet closed, scroll unlocked (probe trace: `later open=false`).

- **Fix**: the close the owner requested is marked; its `close` event is an echo and does not call
  `onClose` again. A `close` event for a sheet that is open again is ignored entirely (no release,
  no focus move). A platform close (Escape, backdrop, the × control) still releases the lock,
  returns focus to the opener when focus was lost, and reports `onClose`. Every `Sheet` owner's
  `onClose` only sets its own closed state, so skipping the echo changes nothing else.
- **A first attempt was wrong** and is recorded: it left the echo mark set when the stale event
  returned early, so the next Escape was taken for an echo and the sheet could not be reopened
  (probe: timeout waiting for the sheet). The mark is now cleared when consumed and on every open.
- **Evidence**: probe after the fix — `close open=true`, final `open=true overflow=hidden`, Escape
  and backdrop restore `overflow` and focus. Browser check "sheet lifecycle: unmount, replacement,
  Escape, rapid reopen, backdrop, close button"; unit "shared Sheet lock: close, Escape, unmount,
  replacement and StrictMode replay". A production build does not replay effects, so StrictMode's
  mount → cleanup → mount is covered by the unit test on the lock itself, not in the browser.

The second finding — `VEHICLE_SAVED_NOTICE` («السيارة ولوحتها محفوظتان على جهازك.») claims device
storage while the garage is in memory — is unrelated to Review and is **not** fixed here. It
remains tracked for the Garage owner. Review repeats no device-storage claim; the footer keeps
«محفوظ لهذه الجلسة».

## Tracked, not changed

- `draftFromOrder` (repeat, C003) copies an order's add-ons, package and vehicle size as stored,
  while the reference's `cleanDraft()` drops unknown, duplicate and package-included add-ons and
  rejects an unknown package or size. Every order fixture is clean and the bill now ignores unknown
  add-ons, but a stored order with an unknown package or size would still fail its catalog lookup.
  Sanitising needs the catalog in the state layer (which never imports fixtures today); it is left
  to the repeat/Booking owner.

## Deterministic scenarios

`booking-review-cash`, `-sham`, `-syriatel`, `-minimal` (every optional value absent), `-full`
(every optional value present), `-long` (long Arabic/mixed text and markup-like input, rendered as
text), `-repeat` (repeat mode) and `-expired-slot` (guarded to Time). They build on the valid
Contact fixture under the rendering contract's fixed instant (2026-09-20 12:00, Damascus), are
built afresh on every call (no shared nested values) and contain no real personal or financial
data. They are selected only through the existing allowlisted `?scenario=` mechanism.

## Tests

- `tests/unit/c013-customer-review.test.mjs` — flow/mount, scenarios, direct entry, guard order
  with lead-time and midnight boundaries, summary content and fallbacks, bill agreement and
  add-on rules, price invariants, live-draft rendering, edit targets, six edit transitions,
  refusals, sequential navigation unchanged, header Back, edit-mode reset, repeat integrity,
  no collection/profile mutation, unavailable confirmation, accessibility markup, Sheet lock.
- `scripts/c013/browser-acceptance.mjs` — Review for every method and content shape at 320, 390,
  430, 768, 1024 and 1440 plus 390×560 and 320×560; the price sheet; each of the six steps opened
  for editing (strict full-screen comparison), changed and returned; header Back; refusal;
  Time → Location; browser history; save-and-exit and resume; repeat via Home; the public journey
  Home → six decisions → Review → six edits; keyboard; Sheet lock; expiry with the lead-time
  boundary; direct entry and reload; motion allowed. Review states record a full-screen pixel
  comparison (not claimed as zero) and compare the owned area (declared regions masked on both
  pages) strictly. Negative checks prove the Review comparison is not lenient: the reference
  compared with itself fails (the declared difference is required), and an injected text or
  geometry change fails. Before every visual capture both pages wait for timed toasts to end,
  move the pointer off controls and finish running transitions; thresholds and the stable-capture
  rule are unchanged.

### Superseded earlier assertions

| Old invariant | C013 ownership | Replacement assertion |
| --- | --- | --- |
| C008/C010/C011 unit: Review (C013) is not mounted | C013 mounts Review | Review is mounted (`return <ReviewStep />`); C008 also checks the unavailable confirmation |
| C012 unit: Review remains deferred, shell does not treat `/book/6` as ported | C013 | Review mounted, `/book/6` ported, confirmation unavailable |
| C006 unit: bill lines are `{ label, value }` | shared bill identity | lines are `{ id, label, value }`; labels, values, order and total unchanged |

Empty-draft redirects, earlier validation, Contact input synchronization, Location/Map, Saved
Addresses, Garage, time boundaries, Payment behavior and the public journeys are kept and re-run.

## Limitations

- Pixel parity is authoritative only on the Linux CI rendering contract; Windows runs are
  interaction evidence.
- Full-screen Review captures differ from the reference by the two declared regions; only the
  owned area is compared to zero.
- The illustrative amounts are fixture figures, not Pricing or Billing quotes.
- No accessibility certification is claimed.
