# Release barrier: NO_GO

Candidate 3e1ab23bff450235858ea13e049f8fb373df393f (tree 53edea7ff5348c969408e9fd3ee23569b06a9f94), evaluated 2026-10-10T22:19:41.791Z.
Deployment: NOT_PERMITTED.

| Family | Status | Owner | Action |
| --- | --- | --- | --- |
| A.rc-acceptance | MISSING | Lane A (customer, vehicle, geo, customer-web) | Run the Lane A exact-RC acceptance on real PostgreSQL/Redis/Identity and the customer-web Playwright journeys; emit a receipt bound to the RC tree. |
| B.rc-acceptance | MISSING | Lane B (catalog, pricing, billing, custody) | Run the Lane B exact-RC acceptance on real PostgreSQL/RabbitMQ including provider reconciliation/refund paths; emit a receipt bound to the RC tree. |
| C.rc-acceptance | MISSING | Lane C (scheduling, booking, dispatch, workforce, media, operator-web) | Run the Lane C exact-RC acceptance including outbox/inbox redelivery on real RabbitMQ and operator-web journeys; emit a receipt bound to the RC tree. |
| D.rc-acceptance | MISSING | Lane D (reporting, communications, configuration, support, admin-web) | Run the Lane D exact-RC acceptance on real infrastructure and admin-web journeys; emit a receipt bound to the RC tree. |
| E.ci-mandatory | MISSING | Lane E | Run every mandatory CI workflow on the RC head and attach the aggregate job record. |
| E.security-scans | MISSING | Lane E | Run secret, dependency, image and CodeQL scans on the RC head; attach findings with zero unaccepted high/critical. |
| E.contract-compatibility | PASSED | Lane E |  |
| E.design-lock | PASSED | Lane E |  |
| E.migration-rehearsal | MISSING | Lane E with every data-owning lane | Apply every service migration with the migration identity against a restored copy of the previous production schema; record expand/contract compatibility. |
| E.recovery-rehearsal | MISSING | Lane E with operations | Restore every owned database from backup, measure RPO/RTO and rehearse rollback of the RC artifacts; attach observed results. |
| E.artifacts-published | MISSING | Lane E | Build and publish every release image from the RC tree; record immutable sha256 digests. The deployment must reference these identical digests. |
| review.independent | MISSING | Independent reviewer (not the RC author) | Obtain an APPROVED review on the RC pull request whose commit_id equals the RC sha, from a reviewer who did not author it. |
| repo.required-checks-enforced | INVALID | Repository administrator | Enable branch protection on main with required status checks, required reviews and enforce_admins; attach the protection API record. |
| ext.production-authorization | MISSING | Project owner | Issue an explicit, time-bounded production authorization naming the RC sha, artifact manifest digest and live-money scope. |
| ext.infrastructure-target | MISSING | Project owner / operations | Provide the reviewed production target (cluster/account, DNS zone, TLS authority, database and broker endpoints) as references, not secrets. |
| ext.secrets-provisioned | MISSING | Operations | Provision production secrets in the secret store and attach store references only (never values). |
| ext.merchant-onboarding | MISSING | Project owner / finance | Complete merchant onboarding and provider verification for every enabled wallet; until then live money stays disabled. |
| ext.incident-contacts | MISSING | Project owner / operations | Name distinct primary and backup incident contacts with their paging channels for the initial operating window. |
| ext.operating-window-policy | MISSING | Project owner / operations | Approve the initial operating window duration and numeric rollback/forward-recovery thresholds. |
