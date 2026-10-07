# geo-service

**Status: service-zone and serviceability capability implemented; INTEGRATION_PENDING. No zone
data exists — no approved dataset has been provided and none is invented.** Readiness stays
HTTP 503 (`BUSINESS_READY = false`).

Owns `service_zone`, `outbox_message`, `audit_entry` in database `cw_geo`. Geo is never the
customer-address authority. No other service may read or write these tables.

- API: `/internal/v1/geo` — `POST /serviceability` (guest-safe, rate limited by
  `GEO_SERVICEABILITY_RATE_PER_MINUTE`), `GET /service-zones`. See
  `docs/production/A/P01-A3_GEO_PROVIDER.md`.
- Without approved zones every answer is `INDETERMINATE / NO_APPROVED_ZONES`; boundary and
  overlap cases are also `INDETERMINATE` until the owner approves rules.
- Zone data is managed with the operator CLI (`pnpm --filter @carwash/geo run zones -- ...`);
  every zone needs an approved `datasetRef`.
- Tests: `pnpm --filter @carwash/geo run test:unit`; real infrastructure:
  `node scripts/production/A/acceptance-a.mjs --services geo`.
