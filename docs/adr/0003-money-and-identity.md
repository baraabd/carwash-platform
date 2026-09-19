# ADR 0003 — Money and identity boundaries
Status: proposed baseline, 2026-09-19. Not implemented as a live system.

Identity alone holds private JWT signing material. Other services validate public keys, issuer, audience, allowed algorithm and expiration. Service-to-service identity and end-user authorization are distinct. Critical operations require a current authoritative authorization decision; unavailable verification fails closed.

Catalog owns price versions and wash quotes; Billing owns payments and ledger. Booking owns resource reservation and confirmation. Frontend return URLs and screenshots do not prove payment. Verify provider signature/reference/amount/currency and deduplicate callbacks. A late payment after hold expiry cannot resurrect an unavailable slot.

Use integer minor units internally with bigint and decimal-string JSON fields. Currency precision and supported currencies are explicit configuration. Posted journals are immutable and balanced per currency; refunds reverse effects with unique business references. Subscription entitlements are reserved/committed/released with idempotency, independent of slot capacity.

Provider payout, payroll, customer wash subscriptions and marketplace provider subscriptions are not interchangeable. Live providers stay disabled until actual API, merchant configuration and end-to-end evidence exist.
