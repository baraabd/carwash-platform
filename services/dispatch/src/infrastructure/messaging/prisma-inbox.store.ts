import type { DispatchTransaction } from '../../ports';
import { withConflictRetry, type PrismaDispatchStore } from '../persistence/prisma-dispatch.store';

/**
 * Dispatch inbox storage.
 *
 * Structurally implements `InboxStore` from @carwash/platform-messaging (the
 * package is not yet a declared dependency of this service; see CR-P02-C3):
 * the inbox row and the local effect are written in ONE transaction, and the
 * caller acknowledges the broker message only after that commit.
 *
 *   APPLIED   - first delivery; effect committed with the inbox row
 *   DUPLICATE - same event id and identical bytes; nothing re-applied
 *   CONFLICT  - same event id, different bytes; an integrity failure the
 *               consumer dead-letters instead of guessing which copy is real
 */
export type InboxOutcome = 'APPLIED' | 'DUPLICATE' | 'CONFLICT';

export interface InboxRecordInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadHash: string;
  readonly correlationId: string;
}

export class PrismaInboxStore {
  constructor(
    private readonly store: PrismaDispatchStore,
    private readonly conflictAttempts = 3,
  ) {}

  applyOnce(
    record: InboxRecordInput,
    effect: (tx: DispatchTransaction) => Promise<unknown>,
  ): Promise<InboxOutcome> {
    return withConflictRetry(this.conflictAttempts, () =>
      this.store.transaction(async (raw): Promise<InboxOutcome> => {
        const inserted = await raw.$queryRawUnsafe<{ event_id: string }[]>(
          `INSERT INTO app.inbox_message (event_id, event_type, payload_hash, correlation_id)
           VALUES ($1::uuid, $2, $3, $4::uuid)
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id::text`,
          record.eventId,
          record.eventType,
          record.payloadHash,
          record.correlationId,
        );
        if (inserted.length === 0) {
          const [existing] = await raw.$queryRawUnsafe<{ payload_hash: string }[]>(
            `SELECT payload_hash FROM app.inbox_message WHERE event_id = $1::uuid`,
            record.eventId,
          );
          return existing?.payload_hash === record.payloadHash ? 'DUPLICATE' : 'CONFLICT';
        }
        const outcome = await effect(this.store.wrap(raw));
        // The handler's decision (OPENED, STALE, ...) is kept for diagnosis.
        if (typeof outcome === 'string') {
          await raw.$executeRawUnsafe(
            `UPDATE app.inbox_message SET outcome = $2 WHERE event_id = $1::uuid`,
            record.eventId,
            outcome.slice(0, 32),
          );
        }
        return 'APPLIED';
      }),
    );
  }
}
