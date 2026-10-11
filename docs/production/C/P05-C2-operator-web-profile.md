# P05-C2 — operator-web: technician profile, availability, equipment, custody, offline reads

Status: **IMPLEMENTED against fixture doubles; INTEGRATION_PENDING** (parent P05-C).
Base: `main@66aa7528500a06f65a4b73305506feee7c3fc3b3`. No dependency added.
Provider: Workforce P05-C1 (separate PR; routes requested in
`contract-requests/CR-P05-C1-workforce-profile.md`, added by that PR) and the published
Billing `getMyCustody`. Browser routes `/api/operator/{profile,schedule,schedule/apply,
availability-exceptions[/:id/cancel],equipment/:kind/status,custody}` are requested from
Lane E (CR-P05-C1 §3); the gateway is not changed here.

## 1. Owner decision and visual rule

**P05-C-D1 (owner, 2026-10-10):** the approved technician reference has no screen for
readiness, verification, skills, weekly availability, exceptions, service area,
equipment or Billing custody. The owner chose "existing components": the additions are
built ONLY from reference components and classes, and declared as PN differences.

| Id | Where | Content | Components |
| --- | --- | --- | --- |
| PN-01 | profile, after the motion card | name, readiness (reasons), verification, skills | `card`, `setting-row`, `tile-icon`, `pill` |
| PN-02 | profile | weekly availability, exceptions (open sheets), service area (read only) | `card`, `menu-row` |
| PN-03 | profile | equipment / service vehicle with status pill (opens sheet) | `card`, `menu-row`, `pill` |
| PN-04 | collections, after the reference stats grid | Billing custody: cash held, in handover, shortage note | `stats-grid`, `metric`, `note amber` |
| PN sheets | `#sheet` | schedule (per-day list, add/remove window, apply week, upcoming shifts), exceptions (list/cancel/add), equipment status | `receipt`, `receipt-row`, `segmented`, `segment`, `field-label`, `input`, `sheet-error`, `btn`, `text-btn` |

Evidence of the rule: the profile journey asserts every class used inside `[data-pn]`
exists in the reference CSS; the visual suite copies each PN block from the candidate
into the reference (`insertHtml`, declared regions) and requires **0 changed pixels**
everywhere else. The CSS files are untouched. Copy is PENDING OWNER COPY (`views/profile.ts`,
`copy.ts`). Zone names are not shown (Workforce stores ids; Geo names are a data gap).

## 2. Behaviour

- **Server truth only.** Every change is a revision-fenced request through the existing
  intent machinery (fresh `Idempotency-Key` per intent, reused for every retry; UNKNOWN is
  never success). Success is shown only after a 2xx and a re-read; the open sheet is
  re-rendered from the re-read. Refusals map to fixed texts: `REVISION_CONFLICT`,
  `OPERATOR_NOT_ACTIVE`, `ZONE_OUTSIDE_SERVICE_AREA`, `EXCEPTION_OVERLAPS`.
- **Schedule:** add/remove a window PUTs the whole schedule with `expectedRevision`;
  local validation (≥ 15 min, no overlap) before any request. "Apply" posts the local
  tomorrow + the shown revision; the provider creates each shift once (replay-safe).
- **Exceptions:** full local days; a period starting today starts now; ends at the local
  midnight after the last day; ≤ 31 days.
- **Equipment:** status + issue (none when READY) with the item revision.
- **Revoked technician:** a suspended/inactive operator sees the reason in PN-01; the
  ready switch is refused (`409 OPERATOR_NOT_ACTIVE`) and keeps showing the server state.

## 3. Offline / reconnect

- **Read cache (declared change to the device-storage rule):** localStorage key
  `washgo-operator-profile-cache-v1` holds ONLY the technician's own profile and own
  custody position, the Identity subject and `savedAt`. Never jobs, bookings, customers,
  addresses, phones, plates, photos, signed URLs, notes or tokens (asserted). Written only
  after a confirmed read; re-validated with the closed parsers on load; expires after 24 h;
  discarded for another subject; cleared on 401/403.
- When the API is unreachable the profile shows the cached read with the status bar
  "… كما أكّده الخادم آخر مرة (time)". **No profile mutation runs offline**: nothing is sent
  or queued (asserted: zero requests).
- **Reconnect fix:** an app that started without a session (offline boot) now boots again
  on `online`; previously it stayed in the offline state until a manual reload.
- Task mutations keep the P03-C5 UNKNOWN policy (same key, backoff, `online`/visibility).
- **Media resumable uploads:** the Media adapter offers single presigned PUTs only (no
  multipart/resumable protocol in `services/media`), so resumption stays "same reservation,
  same key, re-PUT the same bytes" (P03-C5). A resumable protocol needs a Media + Lane E
  contract and is not claimed.

## 4. Support / obstacle flows

The Support exception-case API is in PR #126 (unmerged). Obstacles stay on the existing
task `HELP` / `PAYMENT_FOLLOW_UP` notes (Dispatch). Consuming Support is **BLOCKED** until
#126 merges and Lane E publishes its contract.

## 5. Evidence

| Command | Scope | Result |
| --- | --- | --- |
| `pnpm --filter @carwash/operator-web run typecheck` / `build` | app | pass |
| `node --test tests/production/C/operator-web-profile.test.mjs` | Chromium + harness + fixture doubles | 7/7 |
| `node --test tests/production/C/operator-web-journey.test.mjs` | existing journeys (+ cache-content assertion) | see PR |
| `node --test tests/production/C/operator-web-a11y.test.mjs` | axe incl. the profile with PN sections | pass + the pre-existing contrast `todo` |
| `node --test tests/production/C/operator-web-visual.test.mjs` | PN declared, 0 changed pixels elsewhere | see PR (pre-existing CSS byte guard failure on main, §6) |

Substitutes: Identity, Workforce profile, Billing custody, Dispatch, Booking and Media are
fixture doubles (`tests/production/C/support/operator-*-double.mjs`, `operator-api-fixture.mjs`).
Real-service journeys belong to the P05-C integration candidate.

## 6. Pre-existing failure on main (not caused here)

`operator-web-visual.test.mjs` asserts the port CSS equals the reference `<style>` byte for
byte. Commit `cf7cf41` ("fix(ci): remove trailing blank line from operator CSS reference")
removed one blank line from `02-reference-sheets-motion.css`, so the guard fails on main
before any pixel comparison. It is not weakened here. The pixel comparison was run with a
local, uncommitted copy that skips only that assertion; results are labelled as such in
the PR. Owner/Lane E decision needed: restore the byte or teach the CI whitespace check to
skip this verbatim file.
