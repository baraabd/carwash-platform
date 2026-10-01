# WashGo implementation status

**Status date:** 2026-10-01
**Baseline:** `main@f364792d78cf572444df8093c2e4c6315becdae9`

The machine-readable source is `architecture/implementation-status.json`. Validate it with:

```bash
node architecture/implementation-status.mjs --self-test
```

The validator cross-checks all 19 service entries against `architecture/service-catalog.json`, inspects the Prisma model names that actually exist, verifies evidence paths, and runs adversarial mutations that must fail closed.

## Current product truth

F001 through F010 are merged and their foundation capabilities have been verified. This means the repository has a tested platform foundation: ownership boundaries, pinned toolchain, service templates, PostgreSQL isolation, RabbitMQ Outbox/Inbox mechanics, Identity security, the stateless gateway, observability, fail-closed CI/security/image gates, and a deterministic golden-HTML parity harness.

It does **not** mean the WashGo product is implemented or production-ready.

### Services

- 19 domain service boundaries exist in the service catalog.
- 10 have foundation runtimes.
- 9 remain TypeScript/directory skeletons.
- Identity has real security/session persistence models, but its catalog business API/events are still marked planned.
- Catalog, Communications and Reporting contain foundation probe/outbox/inbox models used to prove infrastructure semantics.
- Customer, Booking, Workforce, Billing, Media and Support foundation databases still contain only their service marker for product-domain persistence.
- Every service catalog business API and business-event status is still `planned-not-implemented`.
- Every service catalog deployment flag is still `verified: false`; foundation image verification is not the same as a production deployment.

### Applications

| Surface | Current status |
|---|---|
| Customer | Approved golden HTML/prototype exists; React/backend-integrated product app is not implemented |
| Technician / operator | Approved golden HTML reference exists; application boundary is still planned |
| Admin | Approved golden HTML reference exists; application boundary is still planned |
| API gateway | Foundation runtime implemented and tested; it is not business-state authority |

F010 protects the three approved HTML references and provides deterministic parity tooling. It does not convert those references into production React applications.

## Repository governance

GitHub repository state observed on 2026-10-01:

- `main` reports `protected: false`.
- Repository ruleset collection is empty.
- The connected GitHub integration cannot modify branch-protection administration settings.

Therefore X001 is not accepted yet. CI is fail-closed when it runs, but repository administration must still make the required checks mandatory before merge policy is actually enforced by GitHub.

## What remains

The next product work is the C/T/A application streams and X003+ domain/API/backend streams from the approved remaining-sprint plan. Do not infer a business capability from a foundation shell, a passing container probe, or a golden HTML reference.
