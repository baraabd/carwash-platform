# P06-B2 pricing.v1 and P05 promotions compatibility

The two changes originally occupied the same quote routes with incompatible request and response shapes. This integration retains both owner implementations under explicit paths without changing a published contract or weakening its parser.

| Surface | Routes | Persistence |
| --- | --- | --- |
| Published pricing.v1 | POST `/internal/v1/pricing/quotes`; GET `/internal/v1/pricing/quotes/:quoteId`; POST `/internal/v1/pricing/quotes/:quoteId/validate`; POST `/internal/v1/pricing/price-books` | `price_book`, `price_book_entry`, `pricing_quote`, `pricing_quote_line`, `pricing_audit_record` |
| Explicit legacy compatibility | GET/POST `/internal/v1/pricing/legacy/prices`; GET `/internal/v1/pricing/legacy/price-versions`; POST `/internal/v1/pricing/legacy/quotes`; GET `/internal/v1/pricing/legacy/quotes/:id`; POST `/internal/v1/pricing/legacy/quotes/:id/validate` | Existing `price_version`, `price_rate`, `quote`, `quote_line`, plus P05 `quote_discount` |
| P05 promotions | Existing `/internal/v1/pricing/promotions` and `/internal/v1/pricing/promotion-redemptions` routes remain unchanged | Existing P05 promotion revisions, reservations, audit and outbox |

Legacy implementation and tests are retained under `legacy` modules within each Pricing layer. Infrastructure still uses Pricing's single owned database and generated client. Framework dependencies stay outside domain/application/ports. Legacy and canonical idempotency operation names remain distinct. No implicit conversion turns a legacy quote into pricing.v1 or bypasses its beneficiary/amount validation.

Booking and Billing adapters consume published pricing.v1 shapes and keep the canonical endpoints. Inspection found no Gateway or Booking caller submitting the legacy coupon request. Legacy coupon clients must select the explicit compatibility endpoint; their payload is rejected at canonical pricing.v1. Promotion support on the canonical DTO remains a separate contract decision; this bridge does not claim that canonical Booking consumes a legacy discounted quote.

Both workload scopes are registered explicitly: `pricing.quote.validate` and `pricing.promotion.redeem`. Each route requires its own scope. Only promotion-redeeming clients require an event producer identity because only they create promotion events. No configuration still fails closed.

Both append-only migrations coexist. Historical quote facts and constraints are retained; the pricing.v1 migration's existing correction to nullable linear-chain predecessors remains. The PostgreSQL acceptance runner retains both old and new integration suites, checks all twelve Pricing trigger functions are denied to runtime/PUBLIC, and advances the legacy test clock beyond the preserved upgrade sentinel without mutating it.

Validation performed locally: Prisma generation, TypeScript test build, canonical and legacy unit/HTTP/Nest tests, published-parser conformance, source inventory, architectural layers/boundaries, append-only migrations, ESLint, Prettier and frozen design guard. Real PostgreSQL and RabbitMQ are not available in this environment and were not re-certified. Earlier attached evidence remains historical; the combined migration/replica evidence must come from the new CI run.

Business readiness stays false and production readiness remains unverified. Rollback is the previous image; retain financial/promotion facts and apply the existing reviewed migration rollback restrictions. No migration was edited to force a green test.
