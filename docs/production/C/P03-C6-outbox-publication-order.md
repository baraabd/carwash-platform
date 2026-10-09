# P03-C6 — Outbox batches are published in commit order

Child of P03-C, found by the P03-C merge-candidate verification. One branch and one PR from `main`.

## Defect

The Lane C outbox stores (Scheduling, Dispatch, Booking, Workforce) leased a batch with:

```sql
UPDATE app.outbox_message ... WHERE id IN (SELECT ... ORDER BY created_at, id ... LIMIT n) RETURNING ...
```

PostgreSQL gives `RETURNING` no defined order, so the shared `OutboxRelay` published one batch in heap order.

**Observed:** `scheduling-outbox-rabbitmq.test.mjs` received a hold's `COMMITTED` before its `HELD`. This happened in two of two full merge-candidate verify runs, and on a fresh stack.

**Impact:**
- Consumers stay correct, because they apply only a newer `aggregate.version` (watermarks in Dispatch, Booking and Workforce consumers).
- An out-of-order delivery is still recorded, but it is ignored as STALE. Ignoring the older one is correct only when the newer one already covers it.
- Ordered publication per aggregate across transactions is the stated relay property.

## Fix

The lease is wrapped in a CTE and re-sorted: `WITH leased AS (UPDATE ... RETURNING ...) SELECT ... FROM leased ORDER BY created_at, id`. The locking, lease semantics and SQL guards are unchanged, and there is no schema change.

**Not changed:** two events of one aggregate written in the same transaction share `created_at` (transaction start time). They are ordered by id, and consumers rely on `aggregate.version` for them.

The Catalog outbox (`services/catalog/src/outbox/prisma-outbox.store.ts`) has the same pattern. It is Lane B's, so it is reported to B rather than changed here.

## Evidence

`tests/production/C/{scheduling,dispatch,booking,workforce}-outbox-order.test.mjs` use the shared `support/outbox-order.mjs`. They run on real PostgreSQL with the runtime role and the compiled store. Each test:

1. inserts 60 rows with known commit order;
2. scatters them on the heap;
3. leases exactly those rows;
4. asserts that the batch comes back in commit order.

| Run | Result |
| --- | --- |
| Regression tests, without the fix | 0/4 |
| Regression tests, with the fix | 4/4 |
| `scheduling-outbox-rabbitmq.test.mjs`, with the fix | 6/6 consecutive runs |

Exact-source `verify.mjs` counts are in the PR description.

**Rollback:** redeploy the previous image. There is no data or schema change.
