# Quote, duration and hold consistency

## Defect and implemented boundary

The previous Scheduling create-hold path accepted the caller's quote ID, revision and duration without consulting Pricing. The returned HoldV1 also omitted its persisted quote binding. Booking could therefore combine a usable quote with a hold created for another quote, or accept a shorter held interval than the selected work required.

The repaired boundary uses these owner facts:

| Owner | Authoritative fact | Check |
| --- | --- | --- |
| Catalog | Independent PACKAGE/EXTRA definition duration | Published definition duration remains an integer from 5 to 480 minutes. |
| Pricing | Immutable quote duration | Sum each selected definition's duration multiplied by quantity, using the exact Catalog view pinned in the quote's PriceBook. |
| Scheduling | Capacity hold and its quote reference | Read Pricing with the authenticated beneficiary's bearer; match quote identity, revision, beneficiary kind/subject, scoped zone and duration; require a usable unexpired quote. |
| Booking | Captured booking snapshots | Match the held quote ID/revision to the selected quote, reject an expired hold, and require the interval to equal the authoritative quote duration before persisting or calling Billing. |

Canonical Catalog definitions are independent selections. This change does not define included extras, travel time, category time, taxes or rates. It follows the existing additive duration behavior of `services/pricing/src/domain/legacy/quote.ts` while using only the canonical model's published independent definitions. Scheduling still accepts intervals from 5 through 480 minutes. A valid longer Pricing selection is not silently shortened to fit that API.

## Wire contract completion

| Contract | Required field | Meaning |
| --- | --- | --- |
| pricing.v1 QuoteV1 | `durationMinutes: number` | Integer from 5 through 96,000; the upper bound is a technical bound from 20 selections × quantity 10 × definition duration 480, not a booking policy. |
| scheduling.v1 HoldV1 | `quoteRef: { quoteId, revision }` | The exact quote binding already persisted in the capacity hold, for every hold state. |
| Booking captured quote | `durationMinutes: number \| null` | New bookings require the authoritative number. Old persisted Booking JSON without the field reads as explicit `null`; no historical duration is fabricated from its slot. |

Pricing does not rewrite old quotes. Its repository derives their duration from the existing immutable line quantities and the existing immutable PriceBook Catalog view. A later Catalog/PriceBook publication cannot reinterpret an old quote.

Booking's reschedule policy is unchanged: preserve the original quote/total, do not call Billing, and require the same beneficiary, zone and original interval duration. A new hold for rescheduling is not forced to reuse an expired original quote. This change does not introduce repricing.

### Deployment and rollback compatibility

These are required additions to closed parsers in a project that has not yet received production acceptance. Old strict consumers reject the new fields; new strict consumers reject old owner responses. Deploy the shared contracts, Pricing, Scheduling and Booking as one coordinated compatibility set. Do not mix these wire versions in a rolling deployment without a separately tested compatibility stage.

Apply `20261122093000_quote_binding_immutable` with Scheduling's migration role before the new runtime. It adds a trigger only, with no data backfill or guessed values. Existing v1 holds already contain quote ID and revision. The trigger rejects changes to either quote field on every UPDATE. It also protects the original v1 hold identity/beneficiary/zone/interval/creation facts and rejects deleting a v1 or quote-bound hold, preventing downgrade and delete/reinsert bypasses. Runtime roles cannot TRUNCATE the table, and the trigger function is not executable through PUBLIC grants.

Old successful Scheduling receipts are read through an explicit upcaster. It validates the linked hold's existing beneficiary, zone, interval and creation timestamp, then adds only the missing immutable quote reference. The stored outcome status, hold state, revision and timestamps are preserved, including both holds in a replacement receipt. It does not rebuild an outcome from the hold's current mutable state or rewrite receipt bytes. Missing, malformed or mismatched evidence fails closed.

The trigger is compatible with the previous runtime's legitimate hold-state updates. That database compatibility does not make a single-service wire rollback safe: new receipts contain the new field. Keep the parser-complete artifact set or deploy a forward correction. Reverting to the older closed wire set requires a separately rehearsed compatibility/receipt translation plan; this change does not certify that rollback or a production deployment.

## Idempotency and transaction behavior

A validated caller's completed receipt is looked up before the remote Pricing read and before freshness checks for a new operation. The same key and fingerprint therefore returns the original successful outcome even after quote expiry, slot start or a Pricing outage. A changed body retains the existing idempotency conflict behavior.

The Pricing request occurs outside every local capacity transaction. The transactional idempotency claim remains authoritative under concurrent retries. After obtaining the beneficiary and window locks, Scheduling rechecks quote expiry and slot freshness using the current clock. Waiting for a lock cannot create a hold with an expired quote. Denials roll back their claims; no successful receipt, hold or capacity increment is left behind.

The production Pricing reader requires an explicitly configured HTTPS origin or a loopback origin for local tests, with no URL credentials/path/query/fragment. It disables redirects, forwards only the validated user bearer and correlation ID, bounds the request deadline and response bytes, rejects invalid UTF-8/JSON/contracts, and emits sanitized dependency failures. The bearer remains outside actor/audit/outbox data.

## Verification and evidence scope

The dedicated mandatory `c-quote-hold` business acceptance family builds and starts the production Catalog, Pricing and Scheduling HTTP processes against separate runtime-role databases. Its only HTTP double is Identity. Its currency policy, prices, definitions and quote TTL are explicitly synthetic acceptance fixtures, not launch configuration.

`tests/production/C/pricing-scheduling-owner.test.mjs` verifies duration arithmetic, pinned old-quote behavior after publication, forged duration/revision/zone and foreign-principal rejection, concurrent receipt/capacity behavior, the unchanged 480-minute Scheduling limit, and real Pricing process outage with successful receipt replay. The C stack adds only the explicitly selected allowlisted `catalog,pricing` databases for this family. Existing C jobs keep their previous owner set and run-scoped cleanup.

Additional verification includes strict shared/Booking parser parity; Pricing domain/HTTP/PostgreSQL suites; Scheduling HTTP/PostgreSQL contention, expiry-after-lock, old receipt, malformed receipt, immutable quote binding and bounded-reader tests; and Booking domain/codec/PostgreSQL tests proving no booking or Billing effect for mismatched input. Capacity/restart/broker suites use finite, explicitly declared Pricing doubles and do not claim real Pricing integration.

Local diagnostics use PostgreSQL 17.12, whereas canonical CI retains its pinned PostgreSQL 16 image. Local success is supplemental evidence; the exact committed candidate must pass the full mandatory GitHub matrix, including the new family, before merge assessment. No readiness flag, owner policy, historical sprint status, design reference or approval gate is promoted by this change. This family does not prove customer checkout, Billing compensation, browser behavior or external-provider readiness.
