# Carwash engineering rules

Read docs/ARCHITECTURE_AR.md, architecture/service-catalog.json and docs/VERIFICATION.md first.

- This is a new microservices project, not permission to modify the original repository.
- Each domain owns data, migrations, runtime identity, API/events and release artifact.
- Never import another service's implementation or Prisma client. No shared business database.
- Gateway and admin are not business-data owners.
- Share only versioned external contracts, technical libraries and UI primitives.
- No fabricated authentication, payment success, persisted saves or readiness.
- Payment, access, resource availability and booking state are independent server facts.
- Every distributed write needs an explicit failure/compensation and idempotency design.
- Financial confirmation and refunds require server-side verification and audit.
- Add schema mirrors and migrations together. No production db push/reset.
- Arabic/English and RTL/LTR, accessible focus, mobile interaction and low-bandwidth behavior are acceptance requirements.
- Use scope-specific tests. Never present domain tests as database, broker, browser or production evidence.
- Keep migration, contract compatibility, rollback, security and source-provenance evidence per final commit.
- Pin resolved dependency versions and commit lockfiles only after install/build/security checks.
- Foundation shells intentionally return 503 readiness until the actual service is implemented.
