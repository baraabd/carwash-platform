# vehicle technical runtime

W01 adds a service-local Nest foundation shell, Prisma client and initial ServiceMarker migration. This service has no accepted business API or business events. It returns HTTP 200 from /health/live and HTTP 503 with FOUNDATION_NOT_READY from /health/ready; a healthy database never implies business readiness.

Its reserved database is cw_vehicle. Runtime replicas use cw_vehicle_app; isolated migration jobs use cw_vehicle_migrate. DATABASE_URL is supplied by the allocated environment. Runtime startup never performs migrations. This source does not provision a database or prove its privileges.

From the repository root:

- pnpm --filter @carwash/vehicle generate
- pnpm --filter @carwash/vehicle build
- pnpm --filter @carwash/vehicle typecheck
- pnpm --filter @carwash/vehicle test:runtime
- pnpm --filter @carwash/vehicle migrate:deploy (only with its migration identity in an allocated environment)
- docker build -f services/vehicle/Dockerfile -t washgo/vehicle:w01 .

The framework tests start a real local HTTP listener but do not connect to PostgreSQL or RabbitMQ. Real migration, isolation and image acceptance remain separate mandatory gates. E's bootstrap lease expires only at verified BASE_W02; the permanent domain owner then owns service source and append-only migrations.
