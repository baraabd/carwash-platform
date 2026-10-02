# C010 — Customer scheduling / time selection / earliest appointment

Status: React port of the approved time step (`#/book/3`; `#book/3` in the prototype), driven by
the in-memory draft, deterministic fixtures and an explicit clock. It ports the prototype's
**demonstration** schedule. It does **not** claim a Scheduling service, capacity, reservations or
production readiness, and choosing a time reserves nothing.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`. Unchanged by
  C010 and byte-protected by F010 and the design-reference guard.
- Language/direction: Arabic / RTL.

## Source → implementation → acceptance

| Reference | Implementation | Acceptance |
| --- | --- | --- |
| `TIMES` | `state/scheduling.ts` `ARRIVAL_TIMES` | unit "catalog" |
| `nowLocal()` | `serviceNow(instant)` | unit "clock", "host time zone" |
| `dates()` | `scheduleDays(instant)` | unit "days", boundaries; browser all states |
| `available()` | `isSlotAvailable(instant, day, time)` | unit "availability", "lead time"; browser clock cases |
| `earliest()` | `earliestSlot(instant)` | unit "earliest"; browser earliest cases |
| `dateLabel()`, `timeLabel()` | same names | unit "labels"; browser text |
| `blank()` date default | `defaultScheduleDay`, `highlightedDay` | unit "model" |
| `scheduleView()` | `features/booking/schedule/ScheduleStep.tsx`, `scheduleViewModel.ts`, `schedule.css` | browser visual states |
| action `day` | `state/scheduleStep.ts` `selectScheduleDay` | unit, browser |
| action `time` | `selectScheduleTime` | unit, browser |
| action `earliest` | `chooseEarliestSlot` | unit, browser |
| action `all-times`, `showAllTimes` | `toggleAllTimes`, `visibleTimes`, session `showAllTimes` | unit, browser |
| action `book-step` (step 2) / `back` | `returnToLocationStep` (also the shell's header back) | browser |
| `validate(3)` + `next()` | `submitScheduleStep(state, instant)` | unit "submission"; browser refusal cases |
| `guardStep()` | `resolveBookingEntryStep(draft, step, instant)` | unit "entry guard" |
| `start()` date normalisation | `startBooking(…, instant)` → `draftWithCurrentSchedule` | unit "start" |
| `quickRebook()` | `repeatOrder(state, id, instant)` | unit "repeat"; browser repeat case |
| action `resume` | `resumeBooking(state, instant)` | unit "resume"; browser session case |
| `cleanDraft()` | not needed: there is no stored draft to load (see "Differences") | — |

## The demo rules, exactly as the reference

- Calendar and labels use `Asia/Damascus`, never the device's time zone or locale.
- Five days, starting with today in Damascus.
- Thirteen arrival times, every hour from 08:00 to 20:00, in that order.
- A time is offered when its day is one of the five, it is one of the thirteen, it is **not 11:00**
  (a demonstration rule, not occupancy), and — for today — its start minute is **strictly later**
  than the current Damascus minute plus 45. "Now" has minute precision: at 09:14:59 the 10:00 slot is
  still offered, at 09:15:00 it is not.
- The earliest slot is searched day by day, then time by time. It can be null in principle; with
  this catalog tomorrow 08:00 is always offered, so the null branch is reachable only through a
  declared test seam (below).
- Dates are stepped with the reference's `T12:00:00+03:00` noon construction. That offset is a
  reference detail: at noon it lands on the right calendar day whatever Damascus' offset is, and it
  is used for nothing else.

Nothing else was added: no holidays, capacity, travel buffer, duration overlap, dynamic price or
location-dependent schedule. The care duration shown («مدة العناية … دقيقة») comes from the C006
calculation and does not limit the offered times.

## Selected day versus appointment

`BookingDraft.slot: BookingSlot | null` alone cannot say "a day is chosen, but no time". C010 adds
one field:

| Field | Meaning |
| --- | --- |
| `scheduleDay: string \| null` | the highlighted day; null until scheduling records one (the default is then derived from the clock) |
| `slot: BookingSlot \| null` | a complete appointment, or null |

Invariants (unit-tested): `slot === null` means no appointment; a non-null `slot` is on
`scheduleDay`; tapping a day — even the same day — clears the time and collapses the list; only an
offered time can be stored; historical order slots are never touched. `showAllTimes` is
presentation state on the session (like the reference's module variable it survives leaving and
returning to the step) and is reset only where the reference resets it: day, earliest, and a new
repeat.

## Clock ownership

- `shared/clock.ts` `currentInstant()` is the **only** place the app reads the wall clock (a unit
  test enforces it). Commands and the view model take the instant as a parameter.
- The time step reads it once per render and once per action, and every rule of that render or
  action uses that one instant. As in the reference, the screen is recomputed when the customer acts;
  there is no polling or countdown.
- A missing or invalid instant throws instead of silently falling back to the real clock.
- The running app uses the real clock. Browser acceptance uses the rendering contract's fixed
  instant (12:00 in Damascus, 2026-09-20) or an explicit settable one; unit tests pass fixed
  instants and give the same results under any host time zone (tested under four).

## Fixture reconciliation

The session used to carry `nextAvailableSlot`, a fixed fixture offer (2026-09-21 10:00) used by
repeat. It was a second source of truth that would contradict the schedule. It is removed: repeat
now offers `earliestSlot(instant)` — under the contract clock, 2026-09-20 13:00. The time-step
scenarios (`booking-time-*`) are calendar keys declared against the contract clock; under any other
clock they are simply days that are no longer offered, and the screen shows them that way.

`repeatOrder` has an optional fourth argument, the offered slot (default: the earliest offer). It is
the declared seam for the "nothing offered" branch, which the demo catalog never reaches.

## Expiry and entry guards

- **Next** is judged at the moment of the tap. A time that stopped being offered (lead time passed,
  midnight passed, the day left the five-day window) is refused with «اختر موعدًا متاحًا، أو استخدم
  أقرب موعد.», the message receives focus, and the stored choice is **kept**, not replaced — as in the
  reference, which re-renders without the expired time but still shows the choice in the summary.
- **Entry guard** (`resolveBookingEntryStep`, used by resume and repeat): earlier steps keep
  priority (a missing address still returns to location); then a missing, malformed, unknown or
  expired appointment returns to the time step.
- **Start** resets a recorded day that is no longer offered to the default day with no time, as
  `start()` does. A resumed day is kept, even when it later expires (the reference behaves the
  same); the screen then highlights nothing and says no time is left.

## Navigation

| From the time step | Goes to |
| --- | --- |
| Next with an offered appointment | `#/book/4` (contact — still the C002 placeholder, C011) |
| Header back, «تغيير» | `#/book/2` (location); the appointment, day and price are kept |
| Exit / resume | resume returns to the recorded step, bounded by the guard |
| Repeat | review (`#/book/6`, placeholder) with the earliest offer, or the time step when none |

## Accessibility

Native buttons with `aria-pressed` for the earliest card, the days and the times; `role="group"`
with the approved labels on the day strip and the time grid; `aria-expanded` on «عرض كل الأوقات»;
the summary is a polite live region; the validation message is `role="alert"` and receives focus.
Tab order follows the screen with a visible ring on every stop; Enter and Space choose and focus
stays on the chosen control; the price details use the existing native dialog and return focus.
Selection feedback is a short animation, skipped under reduced motion. The «تغيير» link is 30 px
high, as in the reference; all other controls are at least 44×44 at 320 and 1440.

This is evidence for the tested behaviour, not an accessibility certification.

## Differences from the reference

- **No stored-draft normalisation.** The reference's `cleanDraft()` repairs a draft loaded from
  storage. The port stores nothing, so there is nothing to repair; the same rules run at start,
  resume, repeat and Next.
- **Default day without a recorded day.** The reference records a day when a blank draft is created;
  the port records it at `startBooking` (and on the first day/time choice) and otherwise derives the
  default at render time. The two differ only if a session crosses an availability boundary between
  creating a draft and starting it without visiting the time step.
- **Deep links.** The reference guards every route on load; the port, as in C004–C009, renders the
  requested step and applies the guard on resume and repeat. Unchanged by C010.

## Earlier assertions changed

| Old invariant | New owner | Replacement |
| --- | --- | --- |
| C003 unit: repeat offers `state.nextAvailableSlot` | C010 schedule | the offer equals `earliestSlot(NOW)` = 2026-09-20 13:00 |
| C003 unit: "no offer" via `nextAvailableSlot: null` | C010 test seam | `repeatOrder(state, id, NOW, null)` stops at the time step |
| C003 unit: no `new Date(` anywhere in state/shared | C010 clock boundary | no no-argument `new Date()`/`Date.now(` outside `shared/clock.ts`, asserted for the whole app |
| C005 unit: a started empty draft equals the blank draft | C010 start rule | the same plus `scheduleDay: '2026-09-20'` |
| C008 unit: the time step is a placeholder | C010 | the location step is mounted and the contact step is not |
| C008 / C009 browser: `#/book/3` shows the deferred footer | C010 | `#/book/3` renders the real screen with the booking footer and the chosen place |
| C003–C009 unit: entry commands called without an instant | C010 explicit clock | the same calls with the contract instant `NOW` (61 call sites, mechanical) |

No visual, map, address-book, pricing, privacy or account check was removed and no tolerance changed.

## Session, privacy and resources

No storage, cookie, request, reservation, notification or calendar action. The time step adds no
timer. The browser acceptance runs one heavy task at a time with one preview server whose bundle is
verified against the build; booking time and interaction time are separate clocks (the prototype's
350 ms Next guard runs on `performance.now()`, which is never frozen, and is waited out).

## Future ownership

Real availability, capacity, working hours, holds and reservations belong to the Scheduling
service. The frontend's clock and demo rules are not reservation authority, and nothing here calls
or imitates that service.

## Deferred

Contact (C011), payment, review and confirmation.

## Known limitations

- The schedule is a demonstration; it says nothing about technician availability.
- The draft, including the appointment, does not survive a reload.
- Evidence covers the tested Chromium build, fixtures and instants only.
