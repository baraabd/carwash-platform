# vehicle-service

**Status: saved-vehicle capability implemented; INTEGRATION_PENDING, not production-ready.**
Readiness deliberately stays HTTP 503 (`BUSINESS_READY = false`) until exact-source release acceptance.

Owns `vehicle`, `idempotency_record`, `outbox_message`, `audit_entry` in database `cw_vehicle`.
No other service may read or write these tables.

- API: `/internal/v1/vehicle` — see `docs/production/A/P01-A2_VEHICLE_PROVIDER.md`.
- Owner is the authenticated principal from Identity (`VEHICLE_IDENTITY_ORIGIN`,
  `VEHICLE_IDENTITY_TIMEOUT_MS`); business calls fail closed with 503 without it.
- Booking's snapshot read requires `VEHICLE_SERVICE_CLIENTS`: the platform's
  digest-only service-client configuration granting `vehicle.snapshot.resolve`.
  The caller presents `x-service-client` and `x-service-token`. Empty configuration,
  a wrong client/token, mixed browser credentials and unknown scopes fail closed.
  Vehicle checks the owner, active state, revision and purpose and audits the read.
- Plates are optional, descriptive and never unique.
- `VEHICLE_MAX_ACTIVE_VEHICLES` (default 100) is a technical abuse ceiling, not product policy.
- Tests: `pnpm --filter @carwash/vehicle run test:unit`; real infrastructure:
  `node scripts/production/A/acceptance-a.mjs --services vehicle`.
