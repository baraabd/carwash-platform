# Customer conformance and production boundary — 2026-11-22

This records a bounded correction after auditing baseline main
`7aace4b515ca4efa179293624b2395d9f8121e88`. It does not accept all of P01–P06,
declare the customer checkout complete, or change `BUSINESS_READY`.

## Defects established from executable code

- The default customer build loaded URL-selected synthetic customer/order data.
- Review could create an in-memory confirmation in any build, without a Booking
  service response.
- Gateway's catalog route named `/packages`, while the Catalog owner implements
  the published `/definitions` endpoint. The Gateway correction accompanies this
  change.
- Customer's deployed profile output was a flat legacy representation rejected
  by `parseCustomerProfileV1`; the published PUT bootstrap was absent.
- Customer's Identity adapter treated guest sessions as accounts.
- Booking called the published address-snapshot resolve endpoint, which the
  Customer owner did not implement.

The contract documentation and surface-lock checks passed before these repairs.
They compare contract declarations and generated documents; they do not prove
that real controller responses satisfy those declarations.

## Runtime behavior

The default production build and every mode except `parity` exclude scenario
initializers from emitted JavaScript. A hash, query string or browser storage
value cannot select a sample customer. The explicit command for design
comparison is `pnpm --filter @carwash/customer-web build --mode parity`; C002–C014
workflows now select that mode.

Production reads Catalog and the authenticated Customer profile through
the same-origin Gateway. The public catalog request omits credentials, while
private requests use the browser's same-origin session. Owner responses
must satisfy the shared owner parser. Invalid, unavailable or closed-profile
responses do not populate synthetic records. Published package names, identifiers
and durations come from Catalog; retired definitions and extras are not
advertised as packages. No price is inferred from Catalog. Booking actions stay
unavailable until the actual Pricing/Scheduling/Booking flow is connected.

The session confirmation command independently refuses production execution
before quoting, receipt replay, saved-record changes or navigation. Its parity
behavior remains available to the existing design harness. Production Account
also removes the prototype's payment simulation, local export and reset entries.

### Real guest, profile and garage slice

The production Account/profile sheet now supports explicit guest entry and
recovery. Mounting or reloading the application never creates a guest. A session
read may refresh an existing expired access cookie once; failed authentication
does not fall back to a new identity. The actual Identity recovery receipt is
displayed for acknowledgement and retained only in transient memory. No access
token, recovery code or personal record is written to browser storage, logs or
URLs. Typing a phone neither verifies ownership nor creates an account.

Profile creation and edits use Gateway `PUT/PATCH /api/v1/customer/profile`, the
published canonical parser, a fresh random idempotency key per intent and the
captured revision for edits. A bootstrap race shows the actual existing profile
and a conflict instead of claiming that the requested input was saved. A stale
form retains its typed values and cannot silently overwrite the refreshed
revision; closing and reopening is required to review the current record.

The production garage uses Vehicle's owned collection through these aliases:

| Browser route | Owner route and command |
| --- | --- |
| `GET /api/v1/customer/vehicles` | `GET /internal/v1/vehicle/mine`, bounded limit/cursor and strict paged results. |
| `POST /api/v1/customer/vehicles` | `POST /internal/v1/vehicle/mine`, canonical vehicle input and idempotency key. |
| `PATCH /api/v1/customer/vehicles/:vehicleId` | `PATCH /internal/v1/vehicle/mine/:vehicleId`, idempotency key and If-Match. |
| `POST /api/v1/customer/vehicles/:vehicleId/archive` | Matching owner archive command, idempotency key and If-Match. |

The existing garage/editor sheets retain their parity behavior. Production uses
owner-issued UUIDs/revisions, preserves noneditable make/model/plate-region data,
allows a null plate and uses the owner's input limits. Equal plates do not merge
different records. Archiving changes the saved collection, not past bookings.
Illustrative prices are absent from the production vehicle editor, and its
booking action remains unavailable until checkout is connected.

Unknown writes retain their exact body/key/revision in memory for explicit
same-request replay. New mutations are blocked while that result is unresolved.
Malformed 2xx receipts, foreign profile principals and mismatched vehicle IDs do
not produce optimistic success. Transient authentication failure hides private
UI while retaining a pending key; replay requires session revalidation. Logout
and identity changes clear private drafts and views, and late responses from a
previous session cannot repopulate them. An unconfirmed logout blocks new guest
creation until a fresh session read.

This pending-command memory survives route navigation, not a full document
reload. After a reload the client reads owner records and never automatically
reissues a create. It is not a durable offline command queue. The recovery code
must be kept by the user; a lost guest-operation receipt cannot be reconstructed
by the browser or replaced with a fabricated code.

The added guest entry/receipt is a prepared production-only design extension of
existing sheet, field and button components. ADR 0004 and DESIGN_LOCK section 9
require explicit owner approval of those new visible states before merge;
technical tests and general code authorization do not establish that approval.
The approved HTML, CSS assets and parity screenshots were not rewritten. The
subsequent canonical manual-address correction is documented in
[CUSTOMER_ADDRESS_CONFORMANCE_2026-11-22.md](CUSTOMER_ADDRESS_CONFORMANCE_2026-11-22.md),
including provider persistence, existing Account sheets and current evidence.

## Customer owner compatibility

| Route | Representation and behavior |
| --- | --- |
| `PUT /internal/v1/customer/me` | Published canonical profile bootstrap, full `ProfileInputV1`, required idempotency key, atomic initial contact/profile/outbox/audit. |
| `GET /internal/v1/customer/me` | Strict `CustomerProfileV1`, current principal kind, ETag and no-store. |
| `PATCH /internal/v1/customer/me` | Full canonical input, required idempotency key and If-Match, strict canonical response. |
| `POST /internal/v1/customer/me` | Existing legacy bootstrap retained. |
| `GET/PATCH /internal/v1/customer/legacy/me` | Explicit compatibility path for the former flat representation and partial legacy contact edits. |
| `POST /internal/v1/customer/address-snapshots/resolve` | Published snapshot, authenticated service scope, owner/revision/active checks and purpose audit. |

Malformed JSON and oversized request bodies on the canonical write routes also
use the published error envelope, including failures raised before the controller.
Legacy routes retain their existing error format. The error response does not
echo rejected request contents.

Callers of the former flat GET/PATCH must migrate to the published canonical
shape or use the explicit legacy path during transition. Legacy data is retained.
The implementation never guesses a phone country prefix. A stored contact that
cannot satisfy the canonical phone contract returns
`CONFLICT/PROFILE_CONTACT_MIGRATION_REQUIRED`; an authenticated canonical PATCH
can explicitly correct or clear it. `phoneVerification` remains `unverified`.
The profile model has no closure operation; its existing records are active.

The additive migration widens profile display names from 60 to the published
80 characters. It permits a service actor and an explicit purpose on the existing
append-only audit table, with a database constraint requiring exactly one actor
shape. It neither drops data nor fabricates Identity user/session identifiers.

## Snapshot authorization and configuration

`CUSTOMER_SERVICE_CLIENTS` uses the existing service-kit hashed-credential
format. The only accepted scope is `customer.address-snapshot.resolve`; an absent
configuration denies every service call. The caller presents `x-service-client`
and `x-service-token`. Browser/user credentials cannot substitute for a service
identity, and mixed credentials are refused.

The owner looks up the requested principal and owned address within its own
transaction. A missing, foreign or archived address yields no snapshot. A stale
revision is rejected. Decimal coordinates are padded exactly to six decimal
places, without floating-point conversion or invented map positions. Manual
addresses remain manual. Underspecified legacy manual text returns
`CONFLICT/ADDRESS_MIGRATION_REQUIRED` rather than fabricated location details.
Successful resolves append only service/purpose/identifier audit facts.

## Verification performed

| Check | Result and scope |
| --- | --- |
| Original C001–C014 unit suites before modification | 304 passed. |
| Customer unit, runtime-bundle and real-HTTP client tests after the read-only correction | 313 passed; zero failed/skipped/todo. |
| Customer unit, runtime-bundle and real-HTTP client tests after guest/profile/garage integration | 332 passed; zero failed/skipped/todo, including 19 production adapter cases for dropped replies, exact replay, conflicts, recovery and identity races. |
| Real Gateway/Identity/Customer/Vehicle HTTP integration | 6 passed against real PostgreSQL and Redis; includes persistence, owner isolation, CSRF, idempotency, revision conflicts, guest recovery and revocation. |
| Customer service/domain tests | 18 passed; zero failed/skipped/todo. |
| `customer-contract.http-pg.test.mjs` | 10 passed against real Customer HTTP, Prisma and PostgreSQL, with an explicitly identified Identity HTTP test double; includes canonical malformed-JSON/size boundaries and legacy compatibility. |
| Full Lane A diagnostic before the final transport-only test addition | 74 passed against real Identity, Redis and PostgreSQL, including the preceding 9-case canonical Customer suite. |
| Additive migration and runtime-role provisioning | Passed in the same disposable PostgreSQL invocation as the provider tests. |
| Type checking and production bundle | Customer web and service passed; the current production web build passes on Vite 8.3.3. |
| Supplemental type-aware frontend review | 10 changed TypeScript/TSX files pass the repository's recommended typed rule set; regular lint also passes the added tests and Gateway changes. |
| Immutable design preservation | All 10 locked artifacts preserved. |
| Feature import boundaries and whitespace errors | Passed. |
| Local visual browser comparison | Not executed: the pinned Chromium download was denied by the environment with HTTP 403. CI must supply exact-candidate browser evidence. |
| Real production browser journey | Added to mandatory `a-customer-browser` acceptance. Uses the production bundle/static runtime and real Identity, Customer, Vehicle and Gateway; no fixture routes. CI execution remains required. |

The focused 10-case run used the final Customer source; the full Lane A run
preceded the final transport-only repair and is not a claim that the complete
final candidate has passed canonical acceptance.

The local PostgreSQL run used 17.12 as supplemental diagnostic evidence. The
canonical acceptance runner pins `postgres:16.10-alpine`; this local result does
not replace that gate. The existing Lane A suite exercises real Identity and
Redis separately. A new provider-conformance suite is included in Lane A's plan
so real wire/DB checks are not limited to source inspection.

Commands for the focused non-infrastructure checks:

```sh
pnpm --filter @carwash/customer-web typecheck
pnpm --filter @carwash/customer build:tests
node --test --test-reporter=spec apps/customer-web/test/*.test.mjs tests/unit/c0*.test.mjs tests/unit/customer-production-boundary.test.mjs
node --test --test-reporter=spec services/customer/dist-tests/test/customer.nest.spec.js services/customer/dist-tests/test/domain/customer-domain.spec.js
node scripts/check-design-reference.mjs
node scripts/c002/check-feature-boundaries.mjs
```

## Remaining release requirements

This change connects live Catalog browsing, guest entry/recovery, canonical
profile writes and persisted garage CRUD; the subsequent address correction adds
canonical persisted manual-address editing. It does not provide account
registration/login screens, serviceable location selection, live
availability, Pricing quote, Booking creation, real payment checkout or order
tracking UI. The existing front-end booking decisions still belong to the
approved prototype/parity implementation; they are not evidence of a complete
production checkout.

Exact-candidate canonical CI, browser comparisons and a complete journey through
the real owner services remain acceptance requirements. Merchant/provider
credentials, published commercial configuration and policy decisions remain
deployment inputs. Registry consistency and historic green runs must not be
reported as current production acceptance.
