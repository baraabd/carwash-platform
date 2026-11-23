/** Regression: the workforce outbox lease returns a batch in commit order (see support/outbox-order.mjs). */
import test from 'node:test';
import { assertLeaseOrder, assertOwnerLeaseFencing } from './support/outbox-order.mjs';

test('workforce outbox: a leased batch is published in commit order (created_at, id)', () =>
  assertLeaseOrder('workforce'));

test('workforce outbox: stale same-ID leases cannot finalize and crashed final attempts are parked', () =>
  assertOwnerLeaseFencing('workforce'));
