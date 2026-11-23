# P07 — financial concurrency and recovery closure

This P07 change closes concrete recovery defects in the Billing custody relay
and the Wallet custody projection on the current `develop` source. It extends
the existing P07-B1 recovery work; Billing remains the financial owner and
Wallet remains its read projection. It does not approve provider credentials,
cash-refund policy, customer stored value, production deployment or live money.

## Closed defects

### Billing: fence a reused worker identity by its lease generation

The outbox previously matched completion writes on row ID, worker ID and live
expiry. A delayed publisher confirmation could therefore complete a newer
lease if the same worker identity reclaimed the expired row. The same race
could release or park the new lease through a delayed failure callback.

Every completion now carries the `attempts` value returned by the successful
lease as `leaseAttempt`. The database update requires that generation, the
worker ID, a live lease and an unpublished, non-dead row. Lease acquisition
increments `attempts` atomically. A stale success or failure changes no row;
the current lease alone can complete it. The shared relay passes the generation
for both completion paths.

The regression obtains a lease, expires it, reacquires the same row with the
same worker ID, submits both old completion callbacks and checks that the new
lease is still intact. Existing competing-worker and final-attempt parking
checks remain. No data migration or reset is required. Operational replay must
preserve the generation counter; resetting it would invalidate this fence.

### Wallet: serialize first delivery before planning a balance change

`SELECT ... FOR UPDATE` cannot lock an absent projection source. Distinct
envelopes representing the first version of the same receipt could both plan
from an absent row before the account lock serialized their writes. The
database version guard prevented a duplicate commit but the losing delivery
raised a persistence error instead of becoming a recorded stale no-op.

The Wallet adapter now takes an owner-local, transaction-scoped advisory lock
for the source identity before reading its row. The later delivery re-reads the
committed state, records `STALE` and changes no balance. The lock also applies
to existing sources and is released by PostgreSQL on commit or rollback.
Unrelated sources and owner databases remain independent. Hash collisions only
serialize otherwise independent work; they cannot substitute one source for
another.

The PostgreSQL regression sends eight distinct event IDs for a previously
unseen receipt/version concurrently through two connection pools, for five
rounds. Each round requires exactly one movement, one account revision, seven
recorded stale outcomes and all eight inbox records. Existing duplicate-ID,
different-receipt, out-of-order and database-tampering tests remain.

### Wallet: make collection a single-use receipt transition

A newly generated envelope with an incremented version previously allowed a
second collection for an already projected receipt, including after reversal.
The domain now rejects collection when that receipt already exists. A valid
new collection must refer to a new Billing receipt. Stale versions keep their
existing no-op behavior; invalid newer collections are recorded as rejected
without moving funds or changing the original source. Domain/application and
PostgreSQL regressions cover both an active and a reversed receipt.

## Verification

The working source passed these local diagnostic suites on Node **24.22.3**
and PostgreSQL **16.15**, using separate Billing and Wallet databases, their own migration
roles and their least-privileged runtime roles. All 256 checks passed, with
zero failures, cancellations, skipped tests or todos:

| Suite | Passed |
| --- | ---: |
| Wallet domain, application, broker-adapter and HTTP/Nest | 19 |
| Wallet PostgreSQL | 11 |
| Billing domain, application, adapters and HTTP/Nest | 86 |
| Billing PostgreSQL command, custody, provider, notification and refund suites | 108 |
| Billing Booking-saga PostgreSQL | 25 |
| Billing finance PostgreSQL | 3 |
| Billing relay-storage PostgreSQL | 4 |

Billing and Wallet test builds/typechecks pass. The locked design-reference
check passes. These counts are working-source diagnostic evidence; they are
not an exact-commit release receipt or a production certification.

Canonical CI uses the existing `b-billing`, `b-wallet` and `b-wallet-broker`
business-acceptance families. Their disposable PostgreSQL 16.10 and RabbitMQ
4.2 runs must pass on the final candidate commit before merge. The local
broker-adapter checks use transport doubles; they are not RabbitMQ acceptance.
The Billing PostgreSQL command, saga, finance and relay batches must remain
separate where the runner requires isolated database-wide assertions.

## Scope that remains distinct

The current custody producer publishes only its three registered event types
with a deployed Wallet subscriber. Other Billing events remain pending under
the existing allowlist; this patch does not widen publication to an unverified
consumer. Therefore the broader `FIN-EVT-01` release requirement cannot be
marked complete solely from the custody relay's existence. The historical
finance matrix and release barrier must be assessed against their complete
requirements and the exact source's receipts.

Provider agreements and verification facilities, merchant credentials,
cash-refund/custody policy, financial retention and external operating-window
evidence remain their existing explicit launch inputs. No test value is
promoted into a business policy, and no readiness flag is changed here.
