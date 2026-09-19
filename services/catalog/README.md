# catalog-service

**Status: foundation only; not a working business service.**

Wash packages, add-ons, price versions and expiring quotes.

Owns `packages,addons,price_versions,quotes,promotions`. Database: `cw_catalog`. No other service may read or write these tables.

The NestJS entry point only serves liveness and deliberately returns HTTP 503 for readiness. It has not been compiled or booted in the delivered verification run because dependencies could not be installed. It has no business/auth endpoints.

Implement domain → application → ports → adapters → transport. Keep migrations and a service-local Prisma schema here when persistence is implemented. Do not import another service's source or Prisma client.
