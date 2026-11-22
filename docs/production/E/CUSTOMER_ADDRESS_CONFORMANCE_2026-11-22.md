# Canonical saved addresses — 2026-11-22

This is a bounded Customer owner and production UI correction based on checkpoint
`257e6c8`. It does not mark P01–P06 complete or enable production checkout.

## Delivered behavior

The existing Account address-book sheet now reads and writes actual Customer
records in production. Creating, editing and archiving use the shared
`customer.v1` parsers, owner-issued UUIDs and revisions, same-origin session/CSRF
credentials and one idempotency key per user intent. The manual address fields,
saved-address list, editor and delete confirmation use the existing approved
components. The explicit parity build retains its reference behavior.

| Browser alias | Canonical owner endpoint | Preconditions |
| --- | --- | --- |
| `GET /api/v1/customer/addresses` | `GET /internal/v1/customer/me/addresses` | `profile.read:self`; closed `limit`/`cursor` query. |
| `POST /api/v1/customer/addresses` | `POST /internal/v1/customer/me/addresses` | `profile.write:self`, CSRF and Idempotency-Key. |
| `PATCH /api/v1/customer/addresses/:addressId` | Matching canonical record endpoint | Same write controls plus captured If-Match. |
| `POST /api/v1/customer/addresses/:addressId/archive` | Matching canonical archive endpoint | Same write controls, captured If-Match and empty object body. |

Collections use stable `(createdAt, id)` keyset pagination, an owner-bound cursor
and the published page envelope. Cursors remain usable after their former row
is archived; a cursor from another owner is refused. The canonical active limit
is the published maximum of twenty, or a lower configured technical limit. A
profile row lock serializes concurrent creation at that boundary. A caller
without a profile receives the published `NOT_FOUND/PROFILE_NOT_FOUND` rather
than invented data.

Canonical mutations atomically write the record, idempotency receipt, identifier
event and audit entry. Lost replies can be retried with the same key, body and
revision. Conflicts refresh authoritative records while refusing a still-open
stale editor. No-op writes at the maximum published revision remain readable;
an operation requiring another revision fails before integer overflow.

## Location truth and compatibility

Production manual entry never sends the prototype drawing's x/y, sample location
or simulated GPS outcome. The illustrative map and sample controls are excluded
from this production sheet under ADR 0004's simulation safety boundary. A saved
real coordinate record keeps its exact point when its label, description or
access note is edited. This UI does not claim to select a serviceable map pin,
capture actual device coordinates, infer a zone, or validate coverage.

The additive migration `20261122140000_customer_address_contract` widens label,
description and access-note storage to the published 40/300/300 limits. Coordinate
description and provenance may be absent, as required by the canonical contract.
The database still rejects non-finite/out-of-range coordinates, invented sources
and inconsistent manual/coordinate combinations. Old rows are retained without
rewriting their values or fabricating provenance. Existing actual provenance is
kept only when an update preserves the same coordinate point.

The former flat address DTO remains explicitly available at
`/internal/v1/customer/legacy/me/addresses` and its record/archive endpoints.
Historical HTTP tests now call those compatibility routes. Their old field
limits, partial updates, source requirements, configurable legacy technical cap
and error format remain intact. A canonical-only record that cannot be represented
by that older DTO yields `ADDRESS_MIGRATION_REQUIRED`; it is not truncated or
given a fabricated source. Callers of the former unversioned representation must
use the explicit compatibility route or migrate to the already-published
canonical shape. Repository inspection found no deployed domain consumer of the
former CRUD DTO; Booking consumes the published address-snapshot endpoint.

Snapshot resolution continues to read the same owned/versioned records and
enforce service credentials, owner, active status and revision before returning
an immutable snapshot. Existing bookings are not rewritten by edits or archive.

## Client recovery and privacy

The UI accepts an address mutation only after the strict response matches the
expected ID, input and archived state. An unreadable or mismatched success retains
the unresolved command for explicit same-request replay; it does not display a
successful save or send a different create. New commands are blocked while the
outcome is unresolved. That command memory survives route navigation, not a full
document reload. A full reload reads server records and never blindly resends a
create.

Sign-out, principal changes and guest recovery clear old private address views.
Late responses from an older identity cannot repopulate them. No address or
recovery code is persisted to local/session storage. The prior guest-entry and
recovery controls remain a prepared production design extension requiring the
explicit owner approval described by ADR 0004 and DESIGN_LOCK section 9;
successful technical tests do not grant that approval.

## Evidence

| Check | Result |
| --- | --- |
| Canonical Customer HTTP/Prisma/PostgreSQL provider suite | 18/18 passed, including nullable coordinates, pagination, owner isolation, cap concurrency, transport failures and legacy compatibility. The provider suite explicitly stubs Identity transport. |
| Historical Customer plus actual Gateway/Identity/Customer/Vehicle suites | 29/29 passed with real PostgreSQL and Redis: 20 historical Customer cases and 9 Gateway cases, including actual ProductionCustomer runtime, address CRUD, CSRF, recovery and revocation. |
| Final combined provider, historical and Gateway run | 47/47 passed in one disposable PostgreSQL/Redis invocation; zero failures, skips or TODOs. |
| Customer frontend C001–C014, production transport and bundle-boundary tests | 341/341 passed, including 28 production-client HTTP cases. |
| Customer domain/Nest suite | 18/18 passed. |
| Gateway HTTP/unit suite after the shared response correction | 35/35 passed. |
| Production frontend build and type checking | Passed with the pinned Node24/pnpm10 toolchain and Vite8.3.3. |
| Backend/test lint and supplemental typed frontend lint | Passed; seven changed frontend files had zero findings. |
| Migration history, ownership/layers and immutable design tests | Passed; migration history is additive against `257e6c8`; 12 design-lock tests passed. |
| Actual production browser journey | Extended to address create/reload/edit/recovery/archive, with real owners and no route mocks. Execution is required in canonical CI. |

Local PostgreSQL17.12/Redis8.0.2 runs are diagnostic evidence. They do not replace
the canonical runner's pinned PostgreSQL16.10 and browser gates. The local
environment cannot execute the pinned browser; no alternate browser/sandbox
bypass is committed or used. Final merged-SHA CI and visual comparisons remain
required.

## Remaining scope

Manual saved-address CRUD is connected. Coverage validation, actual location
selection, quote/hold integrity, live scheduling, Booking submission, payment
and order-tracking UI remain separate owner integrations. Saving an address
does not make it serviceable or confirm a booking. External commercial/provider
configuration and the explicit outstanding design decisions remain release
inputs; this document does not change their acceptance state.
