# CR-P03-C1 — Workforce v1 additions and grants (request to Lane E)

Requester: Lane C (P03-C / C1). Implementation: `services/workforce`.
Lane C does not edit shared packages, lockfiles, CI, infra or architecture; each
item is a request for Lane E to review, version and publish. Until then the
items are **requested / provider-implemented**, and nothing in Workforce claims
them as published. Already published and implemented here:
`workforce.v1.listCapacityResources` and `workforce.eligibility-changed.v1`
(see `../P03-C1-workforce.md`).

## 1. HTTP: technician availability in `workforce.v1`

Prefix `/internal/v1/workforce`. Implemented in
`services/workforce/src/transport/http/workforce.controller.ts`.

| Operation | Method | Path | Access |
| --- | --- | --- | --- |
| `getMyAvailability` | GET | `/me/availability` | `user:work.read:assigned` (own subject only) |
| `setMyAvailability` | PUT | `/me/availability` | `user:work.execute:assigned` (own subject only) |

Wire shapes (closed objects):

```ts
type AvailabilityStatusV1 = 'AVAILABLE' | 'ON_BREAK';
interface AvailabilityViewV1 {
  status: AvailabilityStatusV1;
  revision: number;            // integer >= 0; 0 = never set
  updatedAt: UtcTimestamp | null; // null iff revision = 0
}
interface SetAvailabilityRequestV1 {
  status: AvailabilityStatusV1;
  expectedRevision: number;    // integer 0..2147483647
}
```

Semantics: never set → `{ON_BREAK, 0, null}`. A stale `expectedRevision` is
refused even when the status already matches; a current revision with the
current status is a no-op returning the current view. Not idempotency-keyed
(the revision makes retries safe). Availability is not an eligibility input,
changes no capacity resource and emits no event. Audited by Workforce.

Errors (shared envelope):

| Case | Status | `code` | `reason` |
| --- | --- | --- | --- |
| subject has no operator profile | 404 | `NOT_FOUND` | `OPERATOR_NOT_FOUND` |
| stale `expectedRevision` | 409 | `CONFLICT` | `REVISION_CONFLICT` |
| malformed body | 400 | `REQUEST_INVALID` | null |
| service caller / missing permission | 403 | `AUTH_FORBIDDEN` | null |

**Decision requested:** the P03-C interface asks for `409 REVISION_CONFLICT`,
but the shared `code: REVISION_CONFLICT` is bound to `412` (If-Match). The
implementation answers `409 CONFLICT` + reason `REVISION_CONFLICT`. Please
either confirm this, or publish the body-revision convention you prefer (e.g.
`412 REVISION_CONFLICT` as Dispatch uses for `expectedRevision`) so Workforce
and Dispatch converge; the change is one mapping line in
`transport/http/http-errors.ts`.

Reasons requested for the `workforce.v1` owner allowlist (today only
`RESOURCE_NOT_FOUND`): `OPERATOR_NOT_FOUND`, `REVISION_CONFLICT`,
`INVALID_CURSOR` (stale/foreign cursor on `listCapacityResources`), plus the
transport reasons `IDENTITY_UNAVAILABLE`, `STORE_BUSY`, `CONCURRENT_UPDATE`.

## 2. Grants of `workforce.capacity.read`

Grant the service scope `workforce.capacity.read` (published access of
`listCapacityResources`) to:

- **scheduling** — capacity source for slots;
- **dispatch** — eligibility re-check before offer and acceptance (P03-C § C4).

Interim mechanism until workload identity exists (CR-C1 §4): an entry in
`WORKFORCE_SERVICE_CLIENTS` per caller with the SHA-256 digest of its token and
`"scopes":["workforce.capacity.read"]`, provisioned by the platform secret
store, never committed.

## 3. Subject → resource read for Dispatch (gap, not implemented)

Dispatch receives the technician's Identity subject from the session but
offers are made to a `resourceId`. There is still no published way to resolve
one from the other, so Dispatch cannot prove that the accepting subject *is*
the offered resource (CR-P02-C3 §5). Requested addition to `workforce.v1`:

```
GET /internal/v1/workforce/capacity-resources/by-subject/:subjectId
access: service:workforce.subject.resolve (new scope, Dispatch only)
200 { resourceId, revision }   404 RESOURCE_NOT_FOUND (no probing detail)
```

The response must not carry name/phone. Workforce will implement it once E
fixes the shape and scope; it is deliberately not added here without a
contract.

## 4. Availability exposure to Dispatch for new offers

Availability is owned by Workforce and today readable only by the technician
(`/me/availability`). If Dispatch is to skip `ON_BREAK` technicians when
creating offers, it needs either:

- (a) an `availability` field on `CapacityResourceV1` (`'AVAILABLE'|'ON_BREAK'`
  plus `availabilityRevision`) — a **breaking** change to a published closed
  shape, so a new version or an optional-field policy is needed; or
- (b) a separate published read
  `GET /internal/v1/workforce/capacity-resources/:resourceId/availability`
  (service scope `workforce.availability.read`) returning `AvailabilityViewV1`; or
- (c) a published event `workforce.availability-changed.v1`
  (aggregate `availability`, id = resourceId, version = availability revision,
  data `{status}`).

Lane C prefers (b) for now (no change to the published resource, no new event
stream to operate). Until decided, availability must not be treated as an
offer filter by any consumer; it remains the technician's declaration only.

## 5. Unchanged prerequisites

- Outbox relay dependency (`@carwash/platform-messaging`) for Workforce (CR-C2),
  so `workforce.eligibility-changed.v1` actually leaves the database.
- `@carwash/contracts` as a Workforce dependency, to replace the local mirrors
  of the query parser and error envelope (today proven by
  `tests/production/C/workforce-contract.test.mjs`).
