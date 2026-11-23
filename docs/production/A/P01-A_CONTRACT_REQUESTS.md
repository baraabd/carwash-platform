# P01-A — Contract requests to Lane E (and Identity)

Lane A does not edit shared packages, lockfiles, the gateway or CI. These are exact requests.
Until E merges a versioned contract, Lane A services keep their wire shapes service-local and
consume nothing unpublished.

## A-P01-01 — `customer.v1` HTTP contract (`@carwash/contracts`)

Publish the following as the versioned contract, with a generated client in
`@carwash/api-clients`:

- Prefix: `/internal/v1/customer`.
- Routes and status codes: as listed in `P01-A1_CUSTOMER_PROVIDER.md` § HTTP API.
- `ProfileView`: `{customerId, displayName|null, phone|null, preferredLocale:'ar'|'en', revision, createdAt, updatedAt}`.
- `AddressView`: `{addressId, label, line, accessNote|null, location, status:'ACTIVE'|'ARCHIVED', revision, createdAt, updatedAt}`.
- `location`: `{kind:'manual'}` or `{kind:'coordinates', source:'pin'|'device'|'geocoder', coordinates:{crs:'EPSG:4326', latitude, longitude}}`.
  - `latitude` and `longitude` are decimal strings with at most 6 fractional digits.
- Headers:
  - `ETag: "<revision>"` and `If-Match: "<revision>"`.
  - `Idempotency-Key` matching `[A-Za-z0-9_-]{16,128}`.
  - `Idempotent-Replayed: true` on a replay.
- Error codes:
  - Auth and availability: `AUTH_REQUIRED` 401, `AUTH_FORBIDDEN` 403, `IDENTITY_UNAVAILABLE` 503.
  - Not found: `PROFILE_NOT_FOUND` 404, `ADDRESS_NOT_FOUND` 404.
  - Revisions: `REVISION_REQUIRED` 428, `REVISION_CONFLICT` 412.
  - Idempotency: `IDEMPOTENCY_KEY_REQUIRED` 428, `IDEMPOTENCY_KEY_INVALID` 400,
    `IDEMPOTENCY_KEY_REUSED` 422.
  - Address state: `ADDRESS_LIMIT_REACHED` 409, `ADDRESS_ARCHIVED` 409.
  - Validation, all 422: `INVALID_INPUT`, `INVALID_DISPLAY_NAME`, `INVALID_PHONE`,
    `INVALID_LOCALE`, `INVALID_ADDRESS_LABEL`, `INVALID_ADDRESS_LINE`, `INVALID_ACCESS_NOTE`,
    `INVALID_LOCATION`, `INVALID_COORDINATES`.

## A-P01-02 — Gateway routing

- Map `/api/v1/customer/profile` to `/internal/v1/customer/me`.
- Map `/api/v1/customer/addresses[/:id[/archive]]` to `/internal/v1/customer/me/addresses...`.
- Forward these headers unchanged: `if-match`, `idempotency-key`, `x-correlation-id`,
  `traceparent`, and the existing credential headers.
- Expose `etag` and `idempotent-replayed` in responses.
- `GatewayOwner` currently lacks `vehicle` and `geo`. Add them for P01-A2 and P01-A3.

## A-P01-03 — Events, topology and relay dependency

- Register these events in `@carwash/event-contracts`, using the shared envelope (exact shapes
  are in `services/customer/src/application/events.ts`):
  - `customer.profile-updated.v1`, with `data: {customerId, change:'created'|'updated'}`.
  - `customer.address-updated.v1`, with
    `data: {customerId, addressId, change:'created'|'updated'|'archived', status}`.
- Declare the exchange `washgo.customer.events` with a broker ACL limited to the customer
  producer.
- Add `@carwash/platform-messaging` to `@carwash/customer`, with the lockfile update, so the
  outbox relay can be started.
- Do the same later for `vehicle.vehicle-updated.v1` and `geo.zone-updated.v1`.

## A-P01-04 — Identity guest sessions and claim

- Identity V1 issues account sessions only. Customer and Vehicle already model
  `principal_kind = 'guest'`.
- Request: a guest session contract that is distinguishable in `IdentitySessionView`, for
  example a `principalKind` field.
- Request: an explicit, auditable claim operation that links a guest principal to an account.
- An owner decision is needed on claim, recovery, lifetime and orphan cleanup.
- No implicit merge by phone, name or plate will ever be implemented.

## A-P01-05 — Service dependency for direct token verification (optional)

- Owner services currently ask Identity for current-session state on each call. That is
  stronger than a signature check, but costs one call per request.
- If E wants local verification, for example a JWKS check followed by a cached session check,
  add `@carwash/security-kit` to the customer, vehicle and geo packages and update the lockfile.
- Lane A will not copy the verifier.
