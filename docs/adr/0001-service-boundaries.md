# ADR 0001 — Service ownership
Status: proposed baseline, 2026-09-19.

Use one monorepo with independently buildable/deployable services. Each service owns a private logical database, a runtime role, a distinct migrator identity and its public contracts. A shared Postgres host is allowed initially; a shared business schema/client is not. Shared-host failure is explicitly not high availability.

Keep bookings, capacity reservations and dispatch in the Booking bounded context. Persist team and van reservations in one local transaction. Put master workforce records and qualification decisions in Workforce. Event projections have freshness rules and cannot indefinitely authorize sensitive actions.

Admin commands go to domain owners. Reporting owns only read models. Gateway is not a domain orchestrator or database owner. No cross-service source imports or SQL joins. Contract/UI/technical-library sharing is allowed without synchronous release coupling.

Revisit boundaries only with a demonstrated independent lifecycle, scaling need or domain model, plus an ADR and migration plan. More processes alone are not an improvement.
