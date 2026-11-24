import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySession } from '../../apps/customer-web/src/state/emptySession.ts';
import {
  CONFIRMATION_UNAVAILABLE_TEXT,
  confirmBooking,
  draftFingerprint,
} from '../../apps/customer-web/src/state/bookingConfirmation.ts';
import { reviewScenarioState } from '../../apps/customer-web/src/fixtures/customerReviewScenarios.ts';
import { confirmationCatalog } from '../../apps/customer-web/src/features/booking/review/confirmationCatalog.ts';

const now = new Date('2026-09-20T09:00:00.000Z');
const command = (state, catalog = confirmationCatalog) => ({
  key: state.draftGeneration,
  fingerprint: draftFingerprint(state.draft),
  now,
  catalog,
});

test('production sessions start without invented customer records or simulation authority', () => {
  const first = emptySession();
  const second = emptySession();
  assert.equal(first.runtimeMode, 'production');
  assert.deepEqual(first.profile, { name: '', phone: '' });
  for (const key of ['orders', 'vehicles', 'addresses', 'confirmationReceipts']) {
    assert.deepEqual(first[key], []);
    assert.notEqual(first[key], second[key], 'sessions never share mutable arrays');
  }
  assert.equal(first.pendingHandoff, null);
});

test('production cannot confirm a fully valid draft using illustrative prices or payment methods', () => {
  for (const id of ['booking-review-cash', 'booking-review-sham', 'booking-review-syriatel']) {
    const state = { ...reviewScenarioState(id), runtimeMode: 'production' };
    let quoteCalls = 0;
    const result = confirmBooking(
      state,
      command(state, {
        quote() {
          quoteCalls += 1;
          throw new Error('a production confirmation must never read an illustrative quote');
        },
        sizeName() {
          throw new Error('a production confirmation must never save a fixture vehicle');
        },
      }),
    );
    assert.equal(quoteCalls, 0, id);
    assert.deepEqual(result.outcome, { kind: 'failed', reason: 'PARITY_MODE_REQUIRED' });
    assert.equal(result.intent, null);
    assert.equal(result.state.notice.message, CONFIRMATION_UNAVAILABLE_TEXT);
    assert.equal(result.state.announcement.message, CONFIRMATION_UNAVAILABLE_TEXT);
    assert.deepEqual(
      { ...result.state, notice: state.notice, announcement: state.announcement },
      state,
      'draft, customer data, orders and counters stay unchanged',
    );
  }
});

test('production cannot replay a fixture receipt or use a missing/unknown runtime capability', () => {
  const fixture = reviewScenarioState('booking-review-cash');
  const reviewed = command(fixture);
  const accepted = confirmBooking(fixture, reviewed);
  assert.equal(accepted.outcome.kind, 'created', 'the approved parity journey remains functional');
  for (const runtimeMode of ['production', 'development', 'true', '', undefined, null]) {
    const result = confirmBooking({ ...accepted.state, runtimeMode }, reviewed);
    assert.deepEqual(result.outcome, { kind: 'failed', reason: 'PARITY_MODE_REQUIRED' });
    assert.equal(result.intent, null);
    assert.equal(result.state.orders, accepted.state.orders);
    assert.equal(result.state.confirmationReceipts, accepted.state.confirmationReceipts);
  }
});
