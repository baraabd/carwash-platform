# P05-B2 — Pricing promotions: coupon quotes and redemption caps

**Status: review required.**

- **Parent P05-B:** INTEGRATION_PENDING.
- **Not:** production-ready, deployed or integrated.
- **No consumer calls it yet:** no Booking saga, Gateway route or UI. Customer coupon entry is not part of the approved UI.

| | |
| --- | --- |
| Base | `main` `3e1ab23bff450235858ea13e049f8fb373df393f`, refreshed 2026-10-11. The audited `f875d31` and the first refresh `66aa752` were stale. |
| Scope | `services/pricing/**`, `scripts/production/B/postgres-acceptance.mjs`, `docs/production/B/**` |
| Migration | `20261011110000_p05b_promotions` (expand-only on top of the P01-B history) |
| Contracts | None consumed or changed in shared packages. Requests: `CONTRACT_REQUEST_E_PRICING.md`, CR-B2-9 to CR-B2-11. |
| Evidence | `docs/production/B/evidence/pricing-postgres-178b19d47200.json` (code commit `178b19d`, clean tree; real PostgreSQL 16.10, runtime role) |

## Design

**Promotions.** A promotion is a stable code with one customer-facing coupon code. The coupon is fixed when the promotion is created and stored only as the SHA-256 digest of its upper-case form. It never appears in a receipt, an event or a log.

**Revisions** are immutable and take effect at strictly increasing instants, with optimistic `expectedRevision` and a database guard. Each revision states, as data published by staff (B-10 is open, so no value is a default):

- **discount:** `PERCENT` in basis points with an optional cap, or `FIXED`;
- **currency:** must equal the Pricing currency policy;
- **eligibility:** eligible packages, a minimum subtotal and an optional end;
- **caps:** a total cap and a per-customer cap;
- **`active`.**

**Quote.** `POST /quotes` takes an optional `couponCode`. Eligibility is evaluated against the revision in force:

- **Rejections:**
  - an unknown, inactive, not-yet-started or ended coupon is one indistinguishable `COUPON_NOT_VALID`, so codes cannot be enumerated;
  - a valid coupon that does not fit the selection is `PROMOTION_NOT_APPLICABLE`.
- **The discount is exact and deterministic:** `floor(subtotal × bp / 10000)`, then capped by `maxDiscount` and by the subtotal.
- **It is recorded as the quote's own component** (`quote_discount`), so `total = subtotal − discount`. A COMMIT-time assertion enforces this; the old `total = subtotal` CHECK is relaxed to `total ≤ subtotal`.
- **Caps are only checked at quote time**, so an exhausted promotion is not quoted. **A quote is never a redemption.**

**Redemption** (the Booking saga, through a scoped service credential, deny by default).

- **Reserve** `{quoteId, bookingId, customerSubject}`. All of these must hold:
  - the quote belongs to that customer;
  - it carries a discount;
  - it is still usable;
  - the promotion is still active and not ended;
  - the caps of the revision in force are not exceeded.

  Reservations serialise on a row lock on the promotion, so concurrent attempts for the last use yield exactly one success.
- **The database re-checks the caps at COMMIT**, so a reservation written without the lock (direct SQL) cannot exceed them either.
- **Idempotent on (promotion, booking).** A quote is redeemed at most once, and a booking holds at most one live promotion.
- **Commit** on booking confirmation; **release** on cancellation or failure (compensation, which frees the use). Repeating a settlement already done is a replay.

**Events:** `pricing.promotion-redemption-changed.v1` goes to the outbox in the same transaction. The relay is not started until E registers the event. Promotion audit rows record every revision and redemption change.

## Test evidence

| Family | Result |
| --- | --- |
| Domain/unit (promotion terms, coupon normalization, exact discount incl. > 2^53, eligibility, caps, revisions, transitions, event self-validation) + existing Pricing application/HTTP/Nest specs | **PASSED 38/38** |
| **Real PostgreSQL 16.10**, runtime role, 2 replicas: `node scripts/production/B/postgres-acceptance.mjs --service pricing --record` | **PASSED 13/13** (10 P01-B + 3 P05-B2), all phases, no skips |
| Upgrade from the P01-B history (3 migrations), re-provision, schema mirror drift | **PASSED** |
| typecheck, build, ESLint, Prettier, design reference + reference lock, boundaries, layers, service shells, migrations, ownership, contract docs/surface | **PASSED** |
| `tests/parallel/E/status.test.mjs` (CI `static`) | **BLOCKED** until E registers the new persistence models (CR-B2-11): a registration gap by design, not a behaviour failure |
| Real RabbitMQ | **BLOCKED**: event not registered (CR-B2-10) |
| Booking saga against real Booking | **BLOCKED**: Lane C consumer |
| Playwright / visual | **NOT APPLICABLE**: no coupon field exists in the approved customer UI, and none was added |

**Races proven on real PostgreSQL:**
- two customers racing across replicas for the last use (total cap 1): exactly one wins, and after a release the other succeeds;
- one customer, two quotes, two bookings racing (per-customer cap 1): exactly one wins;
- four identical concurrent reserves: one redemption.

**Negative cases:**
- unknown coupon;
- ineligible package;
- wrong currency;
- a coupon reused by another promotion;
- a coupon change on a later revision;
- a customer publishing a promotion;
- the quote of another customer;
- a quote without a promotion;
- an expired quote;
- a deactivated promotion;
- a release after commit;
- the same booking with another quote;
- a missing or user-token service caller.

**Direct-SQL attacks** (runtime role):
- a discount that does not explain the total;
- editing a discount or a revision;
- a discount added to another transaction's quote;
- a forged redemption (wrong amount or owner);
- over-cap inserts;
- changing redemption identity;
- an illegal transition;
- delete.

**Real vs mocked.**
- **Real:** PostgreSQL, with separate migration and runtime roles, and the shared service-credential authenticator.
- **Local doubles:** Identity (HTTP stub) and the Catalog reader (test double, as in P01-B).
- **Not used:** a broker or Booking.

## Rollback and compensation

- **Code:** revert the PR.
- **Schema, before any promotion row exists:**
  - restore the P01-B `pricing_check_quote_consistency` body;
  - re-add `quote_total_equals_subtotal`;
  - drop the P05-B2 objects in reverse order.
- **Schema, after rows exist:** a reviewed data plan is required.
- **Business compensation:** release a redemption, or deactivate a promotion by publishing a revision with `active: false`.

## Blockers

| ID | Blocker | Owner |
| --- | --- | --- |
| B-P05-21 | Source inventory registration for the new models (CI `static`, CR-B2-11) | E |
| B-P05-22 | `pricing.v1` promotion routes, Gateway aliases, event registration, relay (CR-B2-9/10) | E |
| B-P05-23 | Booking saga: reserve/commit/release redemption; Billing bills the discounted quote total | C (after E) |
| B-P05-24 | Owner decision B-10: real promotions, stacking (one per quote today), budgets, timezone, rounding confirmation | Owner |
| B-P05-25 | Coupon entry in the customer UI and admin promotion screens (not designed) | Owner design, then A/D |
