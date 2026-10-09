import { DispatchError } from '../domain';
import type {
  DispatchTransaction,
  DispatchUnitOfWork,
  IdempotentResult,
  RequestMeta,
} from '../ports';
import { actorKey } from './authorization';
import { fingerprint } from './canonical-json';

/** Idempotency records are kept this long, then purged by the expiry worker. */
export const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 3_600_000;

const KEY = /^[A-Za-z0-9_-]{16,128}$/;

export type Outcome =
  | { readonly kind: 'DONE'; readonly result: IdempotentResult }
  /** Committed (e.g. an expiry or a withdrawal was recorded) but the command is refused. */
  | { readonly kind: 'REFUSED'; readonly error: DispatchError };

export function assertIdempotencyKey(key: string | undefined): string {
  if (key === undefined || key === '') {
    throw new DispatchError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.');
  }
  if (!KEY.test(key)) throw new DispatchError('INVALID_INPUT', 'Idempotency-Key is malformed.');
  return key;
}

/**
 * Runs one command in one local transaction under (actor, operation, target,
 * key). Same key + same canonical body replays the recorded result; a
 * different body is IDEMPOTENCY_CONFLICT. A refusal commits its side effects
 * but no record, so a retry is evaluated against the new state. Concurrent
 * requests with one key serialise on the record insert; exactly one executes.
 */
export async function runIdempotent(
  uow: DispatchUnitOfWork,
  meta: RequestMeta,
  scopeParts: { readonly operation: string; readonly target: string },
  key: string | undefined,
  body: unknown,
  work: (tx: DispatchTransaction) => Promise<Outcome>,
): Promise<{ readonly result: IdempotentResult; readonly replayed: boolean }> {
  const checked = assertIdempotencyKey(key);
  const scope = `${actorKey(meta.actor)}|${scopeParts.operation}|${scopeParts.target}`;
  const print = fingerprint(body);
  const outcome = await uow.run(async (tx) => {
    const claim = await tx.claimIdempotency(scope, checked, print);
    if (claim.kind === 'CONFLICT') {
      throw new DispatchError(
        'IDEMPOTENCY_CONFLICT',
        'The Idempotency-Key was already used for a different request.',
      );
    }
    if (claim.kind === 'REPLAY') return { replayed: true, value: claim.result };
    const result = await work(tx);
    if (result.kind === 'REFUSED') return { replayed: false, value: result.error };
    await tx.completeIdempotency(scope, checked, result.result);
    return { replayed: false, value: result.result };
  });
  if (outcome.value instanceof DispatchError) throw outcome.value;
  return { result: outcome.value, replayed: outcome.replayed };
}

/** Bounded positive revision as sent by clients. */
export function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new DispatchError('INVALID_INPUT', 'expectedRevision must be a positive integer.');
  }
  return value;
}
