# W08-A source, writes, caches and compiled assets

**SOURCE_ANALYSIS_ONLY.** Immutable source:
`f0b76221c1a1991ba78327c019f0b4a0a7c53dff`. Raw-file SHA256 pins and actual
diagnostic/build results are in [source-observation.json](source-observation.json).
Historical docs/VERIFICATION.md text that calls the customer app only HTML is
stale: React exists. Its existence does not implement the missing business APIs.

## Accepted producers and current owner truth

| Surface | Actual source | Current limit |
| --- | --- | --- |
| Customer / Vehicle / Geo | Each schema has ServiceMarker; domain/application exports are empty; create-app sets BUSINESS_READY=false | Health/Prisma foundations, no customer profile/address/vehicle/zone business controller or accepted business grant. |
| Public HTTP registry | packages/contracts/src/registry.ts publishes identity.v1 and gateway.v1 | Identity security foundation and routing declarations, not implemented Customer/Vehicle/Geo operations. |
| Events | foundation.probe.created.v1 runtime; booking.confirmed.v1 contract-only | Probe effects and a strict schema cannot prove real Booking or financial transitions. |
| Clients | packages/api-clients/src/index.ts exports nothing | No accepted business transport, cursor/revision/replay/media adapter. |
| Customer startup | src/main.tsx always injects initialSessionState | Current app is a fixture-backed session demo, including when built. No production-mode authority gate. |
| Shared web runtime | infra/web-runtime.mjs technical CSP/readiness/asset allowlist | Source policy prevents business backend connections, excludes source maps and reports business-not-ready. Actual served-header/path-denial tests are required; source inspection alone is not runtime evidence. |

F001 service-catalog ownership wins over older grouping comments: Customer
owns profiles/addresses/preferences/consents; Vehicle owns vehicles/ownerships;
Geo owns geometry/geocoding/estimates. Gateway/admin own no business data. An
illustrative “Location service” comment or UI saved object does not reassign them.

Source package versions are contracts0.0.2, event-contracts0.0.2,
api-clients0.0.1. Read E's accepted release records rather than interpreting
those version numbers as a W08 business release. W07-A #74's broker recovery
repair is merged; it repairs a foundation test lifecycle, not product entry.

## Every current customer write and memory collection

All paths in this table are under apps/customer-web/src/. They are actual
session writes. No remote-write retry path was found in this app source.

| Surface / commands | Data / mutation | Required production authority and recovery |
| --- | --- | --- |
| state/CustomerSessionProvider.tsx apply/transition | Synchronous command against latest stateRef, React state update, notice/announcement | Real principal epoch and scoped adapters; generation checks for responses; clear confidential state on logout/expiry/switch. |
| bookingEntry, vehicleStep | New/resumed/repeated draft, vehicle/name/plate/color, save choice, review edit | Vehicle ownership/current revision; historical snapshots immutable; no command from route entry. |
| careStep, extrasStep | Fixture package/add-on choices and illustrative total | Catalog/Pricing owner quote/version/expiry and explicit price reconfirmation; client totals never authoritative. |
| locationStep | Draft address/label/note, map/sample/GPS outcome, optional save | Customer address authority; actual Geo/Aleppo serviceability receipt; location result invalidation by user intent. |
| scheduleStep, scheduling | Illustrative offered slot/show-all/time/review navigation | Scheduling real slot/hold/expiry; Booking operation recovery; server timezone and half-open expiry semantics. |
| contactStep | Draft name/phone/note, validation and first-invalid navigation | Customer and Identity approved fields/guest ownership; no fake verification or copied account scope. |
| paymentStep | Cash/ShamCash/Syriatel selection | Billing real obligation/beneficiary/amount/proof/verification; selection and successful navigation are not paid. |
| reviewStep | Review edit target and guarded return | Revalidate current quote/slot/owner/session before explicit confirm; no mount-triggered mutation. |
| savedVehicles saveGarageVehicle/saveVehicleRecord/delete/choose/book | In-memory descriptions and deterministic CAR sequence | Vehicle object authorization, stale-edit rejection, version conflict, same-key replay and audit. |
| savedAddresses submitAccountAddress/saveAddressRecord/delete/choose/prefill | In-memory address book, ADR sequence; stale address edit returns missing | Customer object authorization/revision/audit; Geo location changes revalidated separately. |
| bookingConfirmation confirmBooking | One generation/fingerprint receipt, unpaid session order, optional saves, profile update and draft reset | Real Booking saga/idempotency plus B/C owners; independent optional-save outcomes and durable lost-response lookup. |
| customerSession profile/orders/vehicles/addresses/draft/receipts/pendingHandoff | In-memory collections; history bounded80 and receipts bounded10 | Principal-scoped cache keys, retention/cleanup and real unknown-outcome resync. Limits are demo implementation bounds, not approved production budgets. |
| state notice/announcement, route and sheet state | Presentation messages/focus/history changes | No confidential identifiers/tokens in URLs, logs or support messages; late notifications cannot cross principals. |

Source searches found no customer fetch/XMLHttpRequest/WebSocket, credentials,
localStorage/sessionStorage/IndexedDB/service-worker cache or remote upload
implementation. This negative source observation is not a whole-runtime
security certificate. The locked HTML has its own illustrative persistence;
it is not the current React storage implementation.

Sensitive production fields include name/contact phone, optional plate and
vehicle ownership, precise address/location/note, account/guest/object/operation
IDs, consent, private proof/media, booking snapshots and financial facts. Keep
them out of public bundle fixtures, diagnostic URLs, unrestricted logs and
post-sign-out state. No real customer data is used in this audit.

## HTML, network and cancellation boundaries

The three raw HTML sinks in shared/art/ReferenceArt.tsx and
IllustrativeMapArt.tsx render static build-time artwork. No user-controlled
input path to those sinks was found. Required malicious-text/URL/JSON tests
remain unexecuted; do not call these sinks a reproduced XSS.

AddressEditor/deviceLocation requests permission on an explicit action,
reduces raw coordinates to a class and drops them. The editor rejects results
after unmount/replacement, but does not bind the result to the newest manual
selection; see the reproduced register. Its timeout8s is a source default,
not a W08 latency objective. The reference's Damascus label/Riyadh coordinates
remain illustrative; neither establishes real Aleppo coverage.

No real query abort, streaming cancellation, upload replacement or remote
operation reconciliation exists to harden yet. A future AbortController stops
an observation; it cannot roll back an already-committed owner command.
UNKNOWN keeps the original operation key and polls its accepted authorized
lookup, without confirming a second Booking/payment under a new key.

## Compiled artifact and performance boundary

Explicit commands exist: pnpm --filter @carwash/customer-web typecheck and
build. Root build/typecheck alone omit the three frontend apps; F009's
scripts/ci/run.mjs explicitly filters each app. Installed/build measurements
in the observation record cover this current session-demo source only.

Record each emitted HTML/JS/CSS/font/map asset's bytes, compressed bytes and
SHA256, the toolchain/lock/Vite configuration and source tree. Source maps
belong in build inventory but not public serving. Production bundle fixtures,
actual served artifact hashes/headers, private-byte/cache authorization and
no-fallback transport must be retested after real producers are implemented.

Measured static bytes are not measured latency, mobile heap, decoded-image
memory, low-bandwidth behavior or an approved maximum. No W08 performance
PASS can be issued while E/product budgets, workload/device definitions or
the complete application are absent.
