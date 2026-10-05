# W02-E — Gateway, clients and application acceptance proposal

Status: **PROPOSED / ENTRY_BLOCKED**. Exact audited target and entry facts are in [ENTRY_AUDIT.json](ENTRY_AUDIT.json). Existing foundation transport is not an implemented owner API.

## Current route surface

`packages/contracts/src/gateway.ts` publishes 25 route descriptors and three read-only compositions under `/api/v1`. `apps/api-gateway/src/application/gateway.service.ts` and its domain/HTTP ports implement transport only. Gateway has no business database, durable command receipts or domain policy.

| Public surface                                                                                    | Existing owner and permission                                            | Evidence boundary                                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| GET auth csrf/JWKS/session; POST register/login/challenge resend/verify/refresh/logout/logout-all | Identity V1, with Identity auth/CSRF requirements                        | Real registered-account security; no guest/recovery/linkage route             |
| GET/PATCH `/customer/profile`                                                                     | Customer `/me`; self read/write; PATCH requires idempotency key          | Routing, not durable Customer product CRUD                                    |
| GET `/customer/packages`                                                                          | Catalog; requires `profile.read:self`                                    | Not public/guest catalog access or the proposed definitions API               |
| GET/POST `/customer/bookings`                                                                     | Booking; self read/create; POST requires key                             | Routing only; no real booking acceptance                                      |
| GET `/technician/work`; POST `/technician/work/:id/execute`                                       | Booking; assigned work read/execute; write requires key                  | Not Workforce eligibility or implemented work execution                       |
| GET `/technician/profile`                                                                         | Workforce `/me`; assigned-work permission                                | Not durable operator profile/eligibility                                      |
| POST `/admin/dispatch/:id`                                                                        | Booking; dispatch grant and key                                          | Future owner orchestration                                                    |
| GET `/admin/billing`; POST `/admin/billing/:id/refund`                                            | Billing; read/refund grants; refund requires key                         | No financial operation or received-money evidence                             |
| GET `/admin/support`                                                                              | Support cases read                                                       | Routing only                                                                  |
| POST `/admin/reviews/:id`                                                                         | Workforce verification; `verification.review`; key                       | This is not Reviews-domain moderation                                         |
| POST `/admin/accounts/:id/status` and `/roles`                                                    | Real Identity V1 administrative mutations and CSRF                       | Strict legacy bodies; no revision/idempotency receipt                         |
| GET customer/technician/admin overview                                                            | Authenticated GET-only compositions; every component permission required | Stubbed owner components in acceptance; collective sanitized error on failure |

The owner whitelist is Identity, Customer, Catalog, Booking, Workforce, Billing, Support and Reporting. Vehicle, Geo, Pricing, Media and Configuration required by W02 are absent. New routes/owners must be accepted with their schemas and permissions, rather than inferred from catalog proposals.

## Verified authority and transport limits

JWT verification is followed by live Identity session validation, including subject/session/authVersion agreement. Cookie domain writes call Identity authorize; bearer-only domain requests use session validation. Domain forwarding preserves the verified bearer and derives actor metadata server-side, discarding caller cookies and caller actor/service headers. Identity auth transport separately preserves the selected Identity cookies, CSRF and Origin required by its contract.

The current contract **overwrites** spoofed x-auth headers on an otherwise valid request; spoof-only authentication fails. W02 explicitly requires rejection of spoofed identity headers. Contract pre-work must settle the reserved header list, external/trusted ingress boundary and legacy-route compatibility, then prove rejection rather than relabeling overwrite as that acceptance. Do not forward unverified actor/owner headers or substitute a fabricated service principal.

Current bounded behavior, to preserve or explicitly reconcile in reviewed pre-work:

- GET/POST/PATCH only; a UUID v1–5 `:id` matcher; query strings, encoded paths and arbitrary parameter forms refused. Event IDs separately allow UUID v1–8; changing shared validators requires compatibility review.
- JSON requests are bounded to 64 KiB; default responses to 256 KiB. Private media bytes need accepted grant/upload transport, not an accidental JSON proxy.
- Default HTTP timeout is three seconds per attempt, with a separate bounded JWKS fetch. No overall interactive deadline is implemented.
- One upstream attempt; no write retry. Idempotency keys matching `[A-Za-z0-9_-]{16,128}` are preserved. Fingerprint, replay receipt, conflict, retention and uncertain-outcome recovery remain with each authoritative owner.
- Success payloads are opaque. Domain 409/422 responses lose reason detail; upstream 503/504 map to 502, while local timeout maps to 504. Accepted W02 parsers/error adapters must distinguish the reviewed outcomes.
- No Gateway-level rate budget or CORS setup exists. Freeze approved same-origin ingress or reviewed browser CORS behavior; caller proxy headers cannot select a trusted actor/IP.

## Required contract/client prerequisite

`@carwash/contracts@0.0.2` exports Identity V1, Gateway routing vocabulary and HTTP contract descriptor registry. `@carwash/api-clients@0.0.1` contains `export {}`. There are no accepted W02 request/response/client exports or common HTTP Money type. Event-contracts 0.0.2 retains foundation probe and strict contract-only `booking.confirmed.v1`; do not silently widen its `{bookingId, customerId}` payload for guests.

| W02 consumer                | Needed accepted owner packet                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A Customer/Vehicle/Geo CRUD | Missing A packet: owner binding, revisions, optional plate, address/consent, geography and exact route/client vocabulary            |
| B Catalog/Pricing           | Definitions/publication/quotes, immutable snapshots, money/currency precision, expiry and real Catalog → Pricing dependency         |
| C Media/Workforce           | Object purpose/binding, upload/finalization/read grants, quarantine/processing, profile/resources/review/eligibility and revocation |
| D Configuration             | Read/draft/validate/publish, authorization, revision/effective time, audit and real domain validators                               |
| E Identity/Gateway          | Reviewed guest/normal actor verification, scopes/recovery/lifetimes, exact routes/errors/deadlines and transport compatibility      |

B proposes `amountMinor/currencyPolicyRevision`, C `minorUnits/currency`, and D `amountMinor/exponent/currencyPolicyVersion`. These are unaccepted differences, not permission for E to invent a universal type. Preserve meaningful owner revisions and settle exact payloads/adapters with providers and consumers. The pre-work package child publishes reviewed additive schemas/clients and a new common base before affected consumers begin. No private service DTO, implementation or Prisma client may enter shared clients.

## Three actual applications

| Application | Existing build/launch                                                           | Current acceptance limit                                                                                                 |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Customer    | React main.tsx/hash router; typecheck/build/preview                             | C002–C014 launch actual Vite preview and compare the frozen reference; memory/fixture state, no durable business clients |
| Operator    | Technical TypeScript/Vite entry; typecheck/build/preview; start uses server.mjs | Artifact HTTP test does not execute browser JavaScript; no actual app Playwright launch/journey gate                     |
| Admin       | Technical TypeScript/Vite/server entry                                          | Same browser/product acceptance gap                                                                                      |

All six explicit commands already run in `scripts/ci/run.mjs static`; retain them:

```bash
pnpm --filter @carwash/customer-web run typecheck
pnpm --filter @carwash/customer-web run build
pnpm --filter @carwash/operator-web run typecheck
pnpm --filter @carwash/operator-web run build
pnpm --filter @carwash/admin-web run typecheck
pnpm --filter @carwash/admin-web run build
```

Root build/typecheck alone omit frontends. `tests/parallel/E/web-runtime.test.mjs` serves each actual emitted artifact, explicitly without browser execution. Image probes prove live 200 / business-ready 503, not application boot. F006 Chromium uses a test-only Identity TLS fixture. F010 validates frozen references/harness behavior, not a deployed Operator/Admin product.

After entry approval, an E-owned acceptance child must allocate ports/profile/artifact paths, launch each actual emitted app in pinned Chromium, verify executed DOM and absent page errors, and record exact source/exit/cleanup evidence. Technical boot remains distinct from owner/app business journeys. Preserve customer canonical Linux parity and add affected authorization/accessibility/mobile journeys only against accepted real providers. Actual Windows/device interaction remains separate.

## Required W02 cases and evidence

Future gates remain NOT_RUN/provider-blocked in this proposal:

| Case group                       | Required proof                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission and identity spoofing | Each accepted route/actor/permission; missing/expired/revoked credentials; explicit spoofed-header denial; direct owner object scope          |
| Errors and deadlines             | Accepted owner reason/status mapping, malformed payload, unavailable dependency, total/attempt budgets, sanitization and redacted correlation |
| Mutation transport               | Exact idempotency key preservation, no accidental retries, owner replay/conflict and uncertain-outcome reconciliation                         |
| Client conformance               | Public compiled exports and wire parsers; provider/consumer positive and negative cases; no domain logic or production fixture fallback       |
| Actual app launch                | Each emitted bundle executes in a real browser with allocated runtime resources, truthful source binding and scoped cleanup                   |
| Combined W02 smoke               | Real A CRUD, B Catalog/Pricing quotes, C Media/Workforce eligibility and D Configuration processes/DBs; affected app flows, not stubs         |
| Release barrier                  | Every mandatory and affected gate on unchanged latest target/head; independent review and authorized merge; checks on actual resulting target |

Existing `pnpm test:gateway` and `pnpm acceptance:gateway` supply foundation unit/real-Identity transport evidence with explicit business stubs. They were inspected, not rerun for this proposal, and cannot close the real W02 smoke.
