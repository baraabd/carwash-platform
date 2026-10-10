/** Regression: the scheduling outbox lease returns a batch in commit order (see support/outbox-order.mjs). */
import test from 'node:test';
import { assertLeaseOrder } from './support/outbox-order.mjs';

test('scheduling outbox: a leased batch is published in commit order (created_at, id)', () =>
  assertLeaseOrder('scheduling'));
