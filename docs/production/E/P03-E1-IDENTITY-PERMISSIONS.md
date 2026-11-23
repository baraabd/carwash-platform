# P03-E1 — Identity permissions for catalog/pricing publication and billing reconciliation

Parent: P03-E (certify the first real three-app cash vertical slice). Status of the parent:
INTEGRATION_PENDING. This child is one prerequisite, not the certification.

## Why

The P03 vertical slice starts from real catalog and price data. On main
`a14997a` no Identity session can carry `catalog.publish` or `pricing.publish`,
because they are not in `IDENTITY_PERMISSIONS`. Catalog and Pricing therefore
deny every publication (fail-closed), so no package, price or quote can exist on
real infrastructure. `billing.reconcile` is missing for the same reason. Billing
denies every reconciliation, so no payment can ever be confirmed server-side.

These were requested from Lane E in CR-B1-2 (`catalog.publish`), CR-B2-2
(`pricing.publish`) and CR-B-03 §1 (`billing.reconcile`).

## Change

- `packages/contracts/src/identity.ts`: `catalog.publish`, `pricing.publish` and
  `billing.reconcile` are added to `IDENTITY_PERMISSIONS`. identity.v1 stays
  version 1: the change is additive, and no existing permission was renamed or
  removed.
- `services/identity/src/domain/auth-policy.ts`:
  - `finance` gains `billing.reconcile`.
  - `super-admin` already derives from the full vocabulary, so it gains all three.
  - No other role changes.
- Tests:
  - `tests/unit/f006-security.test.mjs` asserts the exact role→permission mapping
    for all seven roles.
  - `tests/identity/api.test.mjs` asserts the mapping through the real Identity
    `/session` on real PostgreSQL and Redis.

## Decisions and least privilege

| Permission | Granted to | Requested proposal | Status |
| --- | --- | --- | --- |
| `billing.reconcile` | finance, super-admin | finance, super-admin (CR-B-03) | as requested |
| `catalog.publish` | super-admin | operations, super-admin (CR-B1-2) | narrower; E-P03-D1 |
| `pricing.publish` | super-admin | finance, super-admin (CR-B2-2) | narrower; E-P03-D1 |

**E-P03-D1** is an open owner decision. Publication changes what every customer
sees and pays, so Lane E grants it only to super-admin until the owner confirms
the staff mapping.

Separation of duties stays with Billing. Billing refuses reconciliation by the
obligation's own owner even when the caller holds `billing.reconcile`.
Customers, guests and technicians never receive any of the three permissions.

## Compatibility and rollback

- **Consumers:** the permission arrays in session views grow. Owner services
  compare permission strings and do not reject unknown ones. Gateway uses the
  same contract package. No migration, no event change and no stored data change.
- **Existing sessions:** permissions are derived from roles at read time. An
  existing finance or super-admin session gains the new permissions on its next
  `/session` read. No re-login is needed and no authVersion bump.
- **Rollback:** revert the commit. Grants then disappear on the next read, and the
  affected services return to fail-closed 403. No data cleanup is needed.

## Evidence

The exact commands and results are recorded in the PR description for the exact
head/tree. Required families:

- unit: `node --test tests/unit/f006-security.test.mjs`
- real Identity: `pnpm acceptance:identity` (real PostgreSQL and Redis)
- contract gates: `pnpm test:production:e`, `pnpm check:contract-surface`, `pnpm check:contract-docs`
- typecheck: contracts, identity, gateway, catalog, pricing, billing
