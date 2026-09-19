# Development infrastructure — UNEXECUTED in this environment

`node scripts/create-dev-env.mjs` then `docker compose --env-file .env.local -f infra/compose.dev.yml up -d`.

This starts infrastructure only. It does not run any application and does not make the product ready. The isolated ports avoid the original home-services stack. PostgreSQL init is for a NEW volume only; changing an env password does not rotate an existing database user. Never delete a volume containing wanted data.

Ten private databases have distinct runtime and migration roles. Add actual service-local Prisma migrations and verify cross-role denials before accepting isolation. Runtime roles cannot migrate. Use `?schema=app` in future Prisma URLs. SQL dialect execution, auth, migrations and Docker images were not tested here. Major image tags are LOCAL placeholders, not production-approved pins.

RabbitMQ's local bootstrap user is not a production application identity. Per-service broker credentials, publisher-exchange ownership, queue ACLs, TLS, durable quorum queues, backups and recovery tests are pending. One broker is NOT highly available. Redis is not the authoritative booking or payment database.
