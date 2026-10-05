# reviews technical runtime

W01 adds a service-local Nest foundation shell, Prisma client and initial ServiceMarker migration. This service has no accepted business API or business events. It returns HTTP 200 from /health/live and HTTP 503 with FOUNDATION_NOT_READY from /health/ready; a healthy database never implies business readiness.

Its reserved database is cw_reviews. Runtime replicas use cw_reviews_app; isolated migration jobs use cw_reviews_migrate. DATABASE_URL is supplied by the allocated environment. Runtime startup never performs migrations. This source does not provision a database or prove its privileges.

From the repository root:

- pnpm --filter @carwash/reviews generate
- pnpm --filter @carwash/reviews build
- pnpm --filter @carwash/reviews typecheck
- pnpm --filter @carwash/reviews test:runtime
- pnpm --filter @carwash/reviews migrate:deploy (only with its migration identity in an allocated environment)
- docker build -f services/reviews/Dockerfile -t washgo/reviews:w01 .

The framework tests start a real local HTTP listener but do not connect to PostgreSQL or RabbitMQ. Real migration, isolation and image acceptance remain separate mandatory gates. E's bootstrap lease expires only at verified BASE_W02; the permanent domain owner then owns service source and append-only migrations.
