# W08-A threat model and reproduced local findings

**PROPOSED_TRIAGE / NO_PRODUCT_REMEDIATION.** Entry base/contracts are absent.
Three read-only pure diagnostics were repeated on pinned Node24.21.0 at
source f0b76221. They reproduce current behavior, not a passing fix, browser
exploit, real-device failure or server authorization bypass. Exact source
pins and diagnostic outputs belong in source-observation.json.

## Reproduced findings and closure criteria

| ID / proposed triage | Evidence and reachability limit | Proposed A repair and required gate |
| --- | --- | --- |
| W08-A-D01 MEDIUM local intent integrity | AddressEditor.tsx locate continuation reads current values and applyGeolocationOutcome; locationStep.ts overwrites place. Manual map(120,160) becomes gps(350,250) after delayed in-range. Typed address survives. Manual map controls remain enabled. Browser ordering unexecuted. | Bind each request to editor/principal/location-intent generation; invalidate on newer pin/sample/saved choice, retry, replacement or unmount. Apply only the current request; retain newer inputs and suppress stale notice. Deferred-callback unit plus actual pointer/keyboard/browser ordering gate; do not disable manual recovery to hide the race. |
| W08-A-D02 MEDIUM command integrity | savedVehicles.ts findExisting falls back from a missing editingId to a matching description or creation. Delete CAR-1 then submit its edit produces CAR-2 and a saved notice. No reachable concurrent UI or cross-principal exploit demonstrated. Address command rejects equivalent stale target as missing. | Distinguish create intent from edit intent; missing/stale edit must never create or update another matching vehicle. Accepted Vehicle revision/permission conflict and authorized lookup determine production recovery. Unit command matrix and real owner/browser lost-reply/concurrent-delete tests. |
| W08-A-D03 LOW defensive validation | classifyDevicePosition(NaN,NaN) returns in-range because distance >65 is false. No real browser supplied NaN and no Geo business validation exists. | Validate finite latitude/longitude and legal coordinate bounds before classification; use accepted unavailable/error semantics and manual recovery. NaN/Infinity/out-of-bounds/swapped/malformed adapter tests plus real Geo HTTP validation. Do not store/log coordinates or relabel fixture coverage as Aleppo. |

These triage labels are review proposals, with no invented CVSS or severity
acceptance. D01/D02 are A command/adapter work; domain Vehicle/Geo validation
retains the actual owner. None is fixed or closed by this packet. Their
proposed child is W08-A-LOCAL-STATE in README.

For reproduction, import blankBookingDraft/addressSheetValuesForDraft,
setSheetMapPoint/applyGeolocationOutcome/classifyDevicePosition,
homeScenarioState('home-empty'), saveGarageVehicle/deleteSavedVehicle and
the analogous address commands from their actual .ts sources using native
Node type stripping. Inputs are synthetic strings, pin(120,160), valid car
description and NaN; no real location/customer is used. Read-only assertions
describe the defective output. Future regressions must instead require the
newer manual intent, reject the stale edit and reject invalid coordinates.

## Security boundaries and actual test ownership

| Threat / boundary | Required policy and real failure evidence | Actual owner |
| --- | --- | --- |
| Account/guest/administrator principal and object enumeration | Current actor+object+purpose grants on list/detail/write/media/lookup, guessed IDs and revoked/foreign cursors; no existence/count/contact leakage | E Identity/Gateway; A Customer/Vehicle/Geo; B/C/D own their endpoints |
| Internal identity/header and browser write spoofing | Strip/verify external/internal principal headers; actual origin/CSRF/session/revocation and service identity, no browser-selected role or customerId authority | E transport/Identity; each owner verifies scope |
| Logout, expiry, principal or locale change | Cancel obsolete reads, rotate scope/generation, remove confidential caches/drafts/media/URLs and reject late effects; minimum approved safe draft only | A consumer; E publishes epoch/session/grant contracts |
| HTML/URLs/schema/body/file input | Safe React text/context escaping, allowlisted links/schemes, strict owner schema/body limits, private upload quarantine/type/size/checksum/purpose | A rendering/input; C Media and B proof owner; E shared transport limits |
| Client price, coverage, capacity or permission tampering | Real owner recomputation/version receipt and current permission; never trust UI disabled controls, fixture totals or copied snapshots | B Pricing/Billing/Subscription; C Scheduling/Booking; A Geo/Vehicle/Customer |
| Sensitive output/persistence | No credentials in localStorage; no plate/contact/precise location/private bytes/token in bundle/URLs/logs/screenshots/support traces; private data no-store where accepted | A browser; E shared runtime/observability; actual data owner |

These are **BLOCKED_UNEXECUTED** producer/consumer gates. Current session demo
has no authenticated principal/server client, so they are not newly reproduced
production vulnerabilities. Static artwork sinks are not a demonstrated XSS.
Foundation Identity/RabbitMQ green evidence cannot prove customer object policy.

## Race winners and durable recovery requests

Winners below are proposed invariants for owner review, not accepted wire
contracts. Preserve the eight unresolved W07 W08-A-C01..08 requests.

| Boundary | Required authoritative result and observable customer recovery |
| --- | --- |
| Quote or promotion changes | B's accepted current immutable quote/reservation association wins. Invalidate old totals; explicit changed-price/benefit consent before commit. Lost reply retains original key and looks up outcome. |
| Last slot / hold expiry | C serializes accepted reservation/expiry fences. Exactly one allowed winner; loser gets truthful unavailable/change selection. Client abort never releases already-claimed capacity by inference. |
| Confirm / double tap / reload / navigation | C Booking owns durable operation fingerprint/key/receipt. Same meaning replays; changed meaning conflicts. Route or locale changes cannot trigger a new confirmation. |
| Optional address/vehicle save | A owner's allowed versioned save settles independently from Booking. Failure cannot convert a real Booking into failure or claim a save succeeded; explicit partial outcome and safe same-key recovery. |
| Proof replacement / stale preview | B obligation and C Media current generation/purpose settle. Older upload/process replies cannot replace newer proof; finalized/revoked bytes obey actual retention/access policy. No automatic verification. |
| Cancel versus payment / entitlement | B/C publish explicit action authority/fence and durable compensation. Current payment and booking/capacity facts remain independent; no late payment resurrection or guessed refund/credit. |
| Repeat / amended Booking / archived objects | Fresh repeat revalidates present permitted choices/quote/coverage/slot and preserves historical snapshots. It is distinct from modifying an active Booking or financial amendment. |
| Principal switch / async completion | Current approved principal epoch wins presentation; stale read must not render. A committed original operation remains recoverable only by its currently authorized actor; it is not retried for the new actor. |

Use real two-actor barriers at the owning HTTP/DB boundary, persist before/after
revisions and operation results, and cut replies/worker/broker at precise
commit/ACK points in E-owned disposable resources. UI single-flight controls,
pure state tests or mocked provider responses cannot close these races.

Current E W07 recovery findings E07-B07 remain owner-tracked static hypotheses,
not reproduced by this A audit. Do not change shared messaging or another
service here; queue actual failing source/evidence to its writer.
