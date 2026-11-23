# W09-A — complete customer and actual-device rehearsal matrix

**SOURCE_LINKED_PLAN / NO_REHEARSAL_EXECUTED.** Every row is ENTRY_BLOCKED.
The current React customer is a partial fixture/session demo; operator/admin
are technical boots. Full customer production/error/recovery states and real
owner integrations remain required, not represented by reference simulation.

## Inventory coverage

The immutable [customer manifest](../../../../docs/customer/customer-parity-manifest.json)
and [E full-scope matrix](../../E/W07/FULL_SCOPE_MATRIX.md) cover CF01..CF20,
87 unique reference actions, six forms, seven primary surfaces and seven
booking decisions. The 20-family literal-action crosswalk covers all87 with
zero missing/extra names; it is retained in source-observation.json.

Every action needs approved actor/app/owner/state disposition before production
acceptance. Designer simulation, local merchant configuration, technician photo
lab and demo-fill actions are reference-only or require the proper B/C/D
owner/app authorization; they do not become customer production permissions.
Form rows include vehicle/address/profile/proof and the two reference merchant
configuration forms. A prototype form existing does not approve a merchant
settings screen in production.

Current source anchors below are repo-relative, with customer prefix
`apps/customer-web/src/`. They prove source presence/limits, not tested UI.

| Family | Current source / remaining real scope | W09 test families and authoritative handoff |
| --- | --- | --- |
| CF01 routing/back/forward | app/routes.ts, app/router.tsx; source routes exist, foreign/malformed real IDs are not integrated. | T08/T10/T24/T33; E Identity and each object owner; navigation never creates another mutation. |
| CF02 save/resume draft | state/CustomerSessionProvider.tsx, app/initialSession.ts; memory-only session demo. | T16/T17/T18/T33/T37; safe unsent draft versus durable submitted C Booking operation. |
| CF03 vehicle CRUD/use | state/savedVehicles.ts; real Vehicle provider absent and D02 open. | T11/T18/T41; A Vehicle and immutable C Booking history. |
| CF04 optional plate | state/vehicleStep.ts and approved vehicle form; optional normalization/preview. | T09/T11; empty plate stays valid; no plate-derived ownership. |
| CF05 care/extras/price | features/booking and state helpers; illustrative selections/price. | T14/T31; B Catalog/Pricing quote/revision/expiry, C Booking revalidation. |
| CF06 addresses | state/savedAddresses.ts, state/locationStep.ts; local save/history only. | T12/T13/T18/T40; A Customer/Geo and C immutable address snapshot. |
| CF07 map/geolocation | widgets/address-editor/AddressEditor.tsx, state/locationStep.ts, widgets/address-editor/deviceLocation.ts; D01/D03 open and geometry illustrative. | T05/T06/T09/T13/T35/T42; HTTPS permission/manual fallback and actual Aleppo Geo. |
| CF08 appointment | booking scheduling step/state; current fixtures are not authoritative capacity. | T15/T16/T17/T23; C Scheduling/Booking/Dispatch/Workforce and B current quote. |
| CF09 contact | contact step and account view model; source validation/demo fill, no Identity/profile authority. | T09/T10/T12/T16/T17; E/A/C real actor/guest/contact rules. |
| CF10 payment method | payment-choice state and review; Cash/ShamCash/Syriatel Cash only. | T19/T20/T21/T23; B financial verification and C Booking remain independent. |
| CF11 QR/copy/save/settings | payment route placeholder and approved checkout reference; merchant config controls are local reference labs. | T02/T20/T21; real B-approved test beneficiary/amount/operation, device clipboard/save and return. |
| CF12 private proof | payment placeholder; reference local proof is not upload/scan/finalize. | T20/T21/T22/T35; C Media object/purpose authorization and B independent review. |
| CF13 payment/cancel/refund | order-handoff view model; paid/collection simulation is not production authority. | T19/T20/T21/T23/T37; B/C independent outcomes, D current support, no late capacity revival. |
| CF14 orders/history | orders route is deferred; approved filtering/detail reference exists. | T24/T32/T33; C owned snapshots, B independent financial state, scoped pagination. |
| CF15 tracking/operator contact | tracking route placeholder; reference simulated progression/technician. | T19/T25/T38/T39; C current assignment/work, D communication, A permitted Geo view. |
| CF16 before/after/comparison/rating | features/home/components/HomeShowcase.tsx is deferred illustration; approved comparison reference. | T26/T27/T35/T43; actual same-work C Media bytes and D eligible review/moderation. |
| CF17 rebooking | C014 session repeat and reference quickRebook; real history/providers absent. | T14/T15/T30/T31/T32/T44; new current B/C authority, no reused old payment/hold. |
| CF18 motion | shell/shared Sheet/styles support bounded demo reduced motion; user preference authority deferred. | T08/T09/T35; actual normal/OS/user preference changes, reload and full states. |
| CF19 account/profile/help | account route/view model; several required help/preferences/privacy states deferred. | T10/T11/T12/T28/T39; A owner writes and real D support/current-purpose lookup. |
| CF20 export/reset/privacy | account deferred actions and prototype JSON/reset; no distributed fulfillment. | T10/T33/T34/T40/T43; actual accepted coordinator/all-owner results, current masks and recovery references. |

Required commerce and additional approved states are not limited to the current
seven React features: wallet holder/purpose/views T29, subscription lifecycle
and benefit T30, promotion lifecycle T31, actual support/review T27/T28,
privacy T34. Their [W07 scope](../W07/COMMERCE_AND_REBOOKING.md) remains a
dependency. No customer funding/withdrawal/recurring debit or extra checkout
method is implied.

## Physical-device and desktop execution

E/operations publish actual approved profiles; model/OS/browser/AT versions,
operators, availability and approval records are currently null. Do not guess
named devices or treat desktop emulation as iOS/Android acceptance.

| Surface/profile | Required actual execution |
| --- | --- |
| Target iOS device(s) | Physically available approved device/browser/OS; all required journeys in Arabic/English; soft keyboard/short viewport, safe area, orientation/text zoom, touchcancel/pinch, camera/file/location permissions, wallet return and background/reload/reconnect. |
| Target Android device(s) | Same complete coverage on actual approved hardware/browser/OS, including low-memory/tab suspension, camera/file chooser and permission denial. |
| Relevant desktop browsers | Actual approved browser/OS profiles; keyboard/screen reader, focus/error/status/dialog races, mixed direction and clipboard/file handling. Separate Windows interaction from Linux canonical pixels. |
| Accessibility/motion | Actual approved AT/input matrix, headings/error associations/announcements, Sheet focus/inert/scroll/restore, touch targets, normal/OS/user reduced motion and runtime preference changes. Source affordances do not certify acceptance. |
| Network/device pressure | Approved rate/latency/loss/jitter/offline transitions and memory/CPU/media bounds; raw samples, throughput/error/outcome denominators and timing windows. All numerical targets are unapproved/null. |

Each complete journey includes approved successful/empty/rejected/permission/
loading/partial/unknown/recovery states and relevant account/guest/foreign/
revoked cases. Reload at each Customer save, Booking commit, payment/proof,
entitlement and Support submission boundary; recover the original owner receipt.
Poor connectivity cannot manufacture saved/paid/sent success or another effect.

Canonical [F010 policy](../../../../docs/design/f010-reference-manifest.json):
320/390/430/768/1024/1440 CSS widths, height900, DPR1, ar-SY, Asia/Damascus,
light, reduced-motion snapshot, fixed2026-09-20T09:00Z, channel threshold8 and
allowedDiffRatio0. Preserve these locked values; Linux reference/candidate/diff
is separate from actual-device/Windows interaction and normal-motion evidence.
Complete English designs are missing; Arabic reference fragments and numeric
LTR fields are not English app acceptance. Retained contrast/reference debt
requires explicit product/design/A/E disposition, not regenerated baselines.

## Per-case evidence and gate

Record proposal case/version/inventory action/state, actual owner/actor/app,
accepted requirement/reference/profile, deployed source/tree/images/configuration/
contracts/migrations and served bytes, physical device/OS/browser/AT/input/locale/
motion/HTTPS/network, protected synthetic input reference, original operation/
receipt scope, injected boundary, independently observed effects, start/end/
timing origin/raw measurements, evidence hashes, support lookup, cleanup,
verdict and concrete blockers. Sensitive fields remain protected and minimized.

No missing device/producer/locale/feature/restore result is waived or marked
successful. Full required real-device and recovery coverage is the W09 parent
gate; current source diagnostics and foundation screenshots are narrower.
