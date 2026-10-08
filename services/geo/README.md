# geo-service

**Status: service-zone and serviceability capability implemented; INTEGRATION_PENDING. No zone
data exists — no approved dataset has been provided and none is invented.** Readiness stays
HTTP 503 (`BUSINESS_READY = false`).

Owns `service_zone`, `geo_dataset_state`, `serviceability_decision`, `outbox_message`,
`audit_entry` in database `cw_geo`. Geo is never the customer-address authority. No other service
may read or write these tables.

- API: `/internal/v1/geo`, conforming to the published `geo.v1` contract (P02-A3):
  - `GET /service-zones`: public, `{items: ServiceZoneV1[]}`, no geometry.
  - `POST /serviceability` `{point}`: a current account or guest session holding
    `bookings.create:self` (verified with Identity, fail closed); rate limited by
    `GEO_SERVICEABILITY_RATE_PER_MINUTE`; returns `ServiceabilityDecisionV1`.
  - `POST /serviceability/validate`: `service:geo.serviceability.validate`, closed until
    workload identity exists.
  - See `docs/production/A/P02-A3_GEO_V1_PROVIDER.md`.
- Without approved zones every answer is `INDETERMINATE / GEO_DATASET_UNAVAILABLE`; boundary and
  overlap cases are `INDETERMINATE / LOCATION_UNRESOLVED` until the owner approves rules.
- Configuration: `GEO_IDENTITY_ORIGIN`, `GEO_IDENTITY_TIMEOUT_MS`, `GEO_DECISION_TTL_SECONDS`
  (60..86400, default 1800), `GEO_TRUSTED_PROXY_IPS`.
- Decisions hold a precise point: run `pnpm --filter @carwash/geo run decisions -- purge` on a
  schedule (retention: 24 hours after expiry).
- Zone data is managed with the operator CLI (`pnpm --filter @carwash/geo run zones -- ...`);
  every zone needs an approved `datasetRef`.
- Tests: `pnpm --filter @carwash/geo run test:unit`; real infrastructure:
  `node scripts/production/A/acceptance-a.mjs --services geo`.
