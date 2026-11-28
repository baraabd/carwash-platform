import {
  parseCashCollectionResultV1,
  parseCashCollectionTargetV1,
  type CashReceiptV1,
  type CashCollectionTargetV1,
  type RecordCashCollectionRequestV1,
} from '@carwash/contracts/billing-v1';
import { ContractViolation } from '@carwash/contracts/common';
import {
  call,
  unknownGatewayOutcome,
  sessionChanged,
  sessionRequests,
  type Result,
} from './client';
import type { RequestEpochToken } from '@carwash/api-clients';
import { ShapeError } from './parse';
import type { Money } from './types';

export type CashReceipt = CashReceiptV1;
export type CashCollectionTarget = CashCollectionTargetV1;

function parse<T>(parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value);
  } catch (error) {
    if (error instanceof ContractViolation) throw new ShapeError('billing');
    throw error;
  }
}

export const sameAmount = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.amountMinor === b.amountMinor && a.scale === b.scale;

export const readCashTarget = async (bookingId: string): Promise<Result<CashCollectionTarget>> => {
  const result = await call({
    method: 'GET',
    path: `/api/operator/bookings/${encodeURIComponent(bookingId)}/cash-collection-target`,
    parse: (value) => {
      const target = parse(parseCashCollectionTargetV1, value);
      if (target.bookingId !== bookingId) throw new ShapeError('billing.bookingId');
      return target;
    },
  });
  // This read also reconciles pending writes. A failed read after a commit is
  // not a definitive financial refusal and must not discard the pending key.
  return result.kind === 'error'
    ? (unknownGatewayOutcome(result.status, result.code) ?? result)
    : result;
};

interface CashAttempt {
  readonly obligationId: string;
  readonly body: RecordCashCollectionRequestV1;
}

/**
 * Only in memory. Once a financial write can have been sent, its exact amount,
 * booking and expectedRevision stay fixed under that key. A timeout may never
 * cause a new revision/body (or another receipt) to be silently substituted.
 */
const attempts = new Map<string, CashAttempt>();

export function clearCashAttempts(): void {
  attempts.clear();
}

const refused = (code: string): Result<never> => ({
  kind: 'error',
  status: 409,
  code,
  reason: null,
  retryable: false,
});

function restored(target: CashCollectionTarget, amount: Money): CashReceipt | null {
  const receipt = target.receipt;
  return receipt &&
    receipt.bookingId === target.bookingId &&
    receipt.obligationId === target.obligationId &&
    receipt.custodyStatus !== 'REVERSED' &&
    sameAmount(receipt.amount, amount)
    ? receipt
    : null;
}

/**
 * Dispatch's declaration is already known before this call. Billing alone can
 * confirm collection. First resolve the local obligation binding, then submit
 * a separate stable command, then read the CURRENT receipt. Even a successful
 * historical idempotency replay cannot conceal a subsequent reversal.
 */
export async function collectCash(
  bookingId: string,
  amount: Money,
  idempotencyKey: string,
): Promise<Result<CashReceipt>> {
  const epoch = sessionRequests.capture();
  const result = await collect(bookingId, amount, idempotencyKey, epoch);
  if (!sessionRequests.current(epoch)) return sessionChanged();
  if (result.kind === 'ok' || (result.kind === 'error' && !result.retryable)) {
    attempts.delete(idempotencyKey);
  }
  return result;
}

async function collect(
  bookingId: string,
  amount: Money,
  key: string,
  epoch: RequestEpochToken,
): Promise<Result<CashReceipt>> {
  const target = await readCashTarget(bookingId);
  if (!sessionRequests.current(epoch)) return sessionChanged();
  if (target.kind !== 'ok') return target;
  const receipt = restored(target.value, amount);
  if (receipt) return { kind: 'ok', status: 200, value: receipt };
  if (target.value.receipt) return refused('AMOUNT_NOT_EQUAL_OUTSTANDING');

  let attempt = attempts.get(key);
  if (attempt) {
    if (
      attempt.obligationId !== target.value.obligationId ||
      attempt.body.bookingId !== bookingId ||
      !sameAmount(attempt.body.amount, amount)
    )
      return refused('IDEMPOTENCY_CONFLICT');
    // An absent receipt with a newer financial revision may mean that the
    // original receipt was reversed. Require a fresh explicit user decision.
    if (target.value.revision !== attempt.body.expectedRevision)
      return refused('CASH_RECEIPT_NOT_ACTIVE');
  } else {
    if (!sameAmount(target.value.amountDue, amount)) return refused('AMOUNT_NOT_EQUAL_OUTSTANDING');
    attempt = {
      obligationId: target.value.obligationId,
      body: {
        expectedRevision: target.value.revision,
        bookingId,
        amount: { ...amount },
      },
    };
    attempts.set(key, attempt);
  }

  const recorded = await call({
    method: 'POST',
    path: `/api/operator/obligations/${encodeURIComponent(attempt.obligationId)}/cash-collections`,
    body: attempt.body,
    idempotencyKey: key,
    parse: (value) => {
      const result = parse(parseCashCollectionResultV1, value);
      if (
        result.receipt.bookingId !== bookingId ||
        result.receipt.obligationId !== attempt.obligationId ||
        !sameAmount(result.receipt.amount, amount)
      )
        throw new ShapeError('billing.receipt');
      return result;
    },
  });
  if (!sessionRequests.current(epoch)) return sessionChanged();
  if (recorded.kind !== 'ok') return recorded;
  const current = await readCashTarget(bookingId);
  if (!sessionRequests.current(epoch)) return sessionChanged();
  if (current.kind !== 'ok') return current;
  const active = restored(current.value, amount);
  return active
    ? { kind: 'ok', status: recorded.status, value: active }
    : refused('CASH_RECEIPT_NOT_ACTIVE');
}
