# customer-service

**Status: profile and saved-address capability implemented; INTEGRATION_PENDING, not production-ready.**
Readiness deliberately stays HTTP 503 (`BUSINESS_READY = false`) until exact-source release acceptance.

Customer profiles (name, phone, preferred locale) and owned saved addresses. Owns
`customer_profile`, `customer_address`, `idempotency_record`, `outbox_message`, `audit_entry` in
database `cw_customer`. No other service may read or write these tables.

- API: `/internal/v1/customer` — see `docs/production/A/P01-A1_CUSTOMER_PROVIDER.md`.
- Authorization: every call is checked against Identity (`CUSTOMER_IDENTITY_ORIGIN`,
  `CUSTOMER_IDENTITY_TIMEOUT_MS`); without it business calls fail closed with 503.
- `CUSTOMER_MAX_ACTIVE_ADDRESSES` (default 100) is a technical abuse ceiling, not product policy.
- Events are written to the transactional outbox; the relay waits for Lane E event registration.
- Tests: `pnpm --filter @carwash/customer run test:unit`; real infrastructure:
  `node scripts/production/A/acceptance-a.mjs --services customer`.

Layers: domain → application → ports → infrastructure adapters → transport. Do not import another
service's source or Prisma client.
