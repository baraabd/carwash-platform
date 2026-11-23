import {
  BookingError,
  CUSTOMER_CANCELLATION_REASONS,
  STAFF_CANCELLATION_REASONS,
  assertChangeable,
  isUuid,
  newCancellation,
  newReschedule,
  type CancellationReason,
  type ChangeState,
  type Requester,
  type SlotSnapshot,
  type TargetSlot,
} from '../domain';
import type {
  BookingRecord,
  BookingStore,
  ChangeStore,
  Clock,
  HoldReader,
  IdGenerator,
  Observer,
  RequestMeta,
} from '../ports';
import { CREATE_PERMISSION, OPERATIONS_PERMISSION, assertCanRead } from './authorization';
import { fingerprint } from './canonical-json';
import { idempotencyKey } from './commands';
import type { ChangeDriveResult, ChangeProcessManager } from './change-manager';

export interface ChangeServiceDeps {
  readonly bookings: BookingStore;
  readonly changes: ChangeStore;
  readonly holds: HoldReader;
  readonly manager: ChangeProcessManager;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly observer: Observer;
  readonly instanceId: string;
  readonly inlineBudgetMs: number;
}

export interface ChangeResult {
  readonly change: ChangeState;
  readonly replayed: boolean;
}

const MAX_HISTORY = 50;

/**
 * Cancellation and reschedule requests of a confirmed booking (P04-C3).
 *
 * A request is validated against Booking's own facts (status, revision, no
 * open change, the new hold for a reschedule), recorded atomically with an
 * audit row, then driven by the change saga. Whether work has progressed is
 * Dispatch's answer, never Booking's guess (decision P04-C-D1).
 */
export class ChangeService {
  constructor(private readonly deps: ChangeServiceDeps) {}

  async cancel(
    meta: RequestMeta,
    bookingId: string,
    rawKey: unknown,
    body: unknown,
  ): Promise<ChangeResult> {
    const key = requireKey(rawKey);
    const input = closed(body, ['expectedRevision', 'reason']);
    const expectedRevision = revision(input.expectedRevision);
    const record = await this.load(meta, bookingId);
    const { requester, reason } = cancellationRequester(meta, record, input.reason);
    const request = { kind: 'CANCELLATION', expectedRevision, reason } as const;
    const replay = await this.replay(requester, key, record.booking.id, request);
    if (replay) return replay;
    const slot = await this.changeable(record, expectedRevision, requester, key, request);
    if ('change' in slot) return slot;
    const change = newCancellation({
      changeId: this.deps.ids.next(),
      bookingId: record.booking.id,
      reason,
      requester,
      from: slot,
      now: this.deps.clock.now(),
    });
    return this.record(meta, change, key, request);
  }

  async reschedule(
    meta: RequestMeta,
    bookingId: string,
    rawKey: unknown,
    body: unknown,
  ): Promise<ChangeResult> {
    const key = requireKey(rawKey);
    const input = closed(body, ['expectedRevision', 'holdId', 'holdRevision']);
    const expectedRevision = revision(input.expectedRevision);
    const holdRevision = revision(input.holdRevision);
    if (!isUuid(input.holdId)) throw new BookingError('INVALID_INPUT', 'holdId must be a UUID.');
    const holdId = input.holdId.toLowerCase();
    const record = await this.load(meta, bookingId);
    const requester = beneficiaryRequester(meta, record);
    const request = { kind: 'RESCHEDULE', expectedRevision, holdId, holdRevision } as const;
    const replay = await this.replay(requester, key, record.booking.id, request);
    if (replay) return replay;
    const from = await this.changeable(record, expectedRevision, requester, key, request);
    if ('change' in from) return from;
    const credential = meta.credential;
    if (credential === null) throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
    const read = await this.deps.holds.read(holdId, credential, meta.correlationId);
    if (read.kind === 'UNAVAILABLE') {
      throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Scheduling is unavailable; retry.');
    }
    if (read.kind === 'NOT_USABLE') throw holdNotUsable('HOLD_NOT_FOUND');
    const hold = read.value;
    const now = this.deps.clock.now();
    const durationMs = from.endsAt.getTime() - from.startsAt.getTime();
    if (
      hold.state !== 'HELD' ||
      hold.revision !== holdRevision ||
      hold.expiresAt.getTime() <= now.getTime()
    ) {
      throw holdNotUsable('HOLD_NOT_ACTIVE');
    }
    if (
      hold.beneficiary.kind !== record.booking.beneficiary.kind ||
      hold.beneficiary.subjectId !== record.booking.beneficiary.subjectId
    ) {
      throw holdNotUsable('HOLD_NOT_FOUND');
    }
    if (hold.zoneId !== from.zoneId) throw holdNotUsable('ZONE_MISMATCH');
    if (hold.endsAt.getTime() - hold.startsAt.getTime() !== durationMs) {
      throw holdNotUsable('DURATION_MISMATCH');
    }
    if (hold.holdId === from.holdId) throw holdNotUsable('SAME_SLOT');
    const to: TargetSlot = {
      holdId: hold.holdId,
      holdRevision: hold.revision,
      zoneId: hold.zoneId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      expiresAt: hold.expiresAt,
    };
    const change = newReschedule({
      changeId: this.deps.ids.next(),
      bookingId: record.booking.id,
      requester,
      from,
      to,
      now,
    });
    return this.record(meta, change, key, request);
  }

  async list(meta: RequestMeta, bookingId: string): Promise<ChangeState[]> {
    const record = await this.load(meta, bookingId);
    return this.deps.changes.listChanges(record.booking.id, MAX_HISTORY);
  }

  async openChange(bookingId: string): Promise<ChangeState | null> {
    return this.deps.changes.findOpenChange(bookingId);
  }

  private async load(meta: RequestMeta, bookingId: string): Promise<BookingRecord> {
    if (!isUuid(bookingId)) throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found.');
    const record = await this.deps.bookings.find(bookingId.toLowerCase());
    if (!record) throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found.');
    assertCanRead(meta.actor, record.booking);
    return record;
  }

  /**
   * Booking-side preconditions. A refusal is re-checked against the key once:
   * a concurrent retry of the SAME request may have just created the change
   * that now makes this one look like a second change.
   */
  private async changeable(
    record: BookingRecord,
    expectedRevision: number,
    requester: Requester,
    key: string,
    request: Readonly<Record<string, string | number>>,
  ): Promise<SlotSnapshot | ChangeResult> {
    try {
      return assertChangeable(record.booking, {
        expectedRevision,
        changeOpen: (await this.deps.changes.findOpenChange(record.booking.id)) !== null,
      });
    } catch (error) {
      const raced = await this.replay(requester, key, record.booking.id, request);
      if (raced) return raced;
      throw error;
    }
  }

  /**
   * Same requester + key: the change it created (whatever happened since);
   * a different request under that key is a conflict. Decided before any
   * validation, so a lost response is replayed even after the booking moved on.
   */
  private async replay(
    requester: Requester,
    key: string,
    bookingId: string,
    request: Readonly<Record<string, string | number>>,
  ): Promise<ChangeResult | null> {
    const known = await this.deps.changes.findByKey(requester, key);
    if (!known) return null;
    if (known.fingerprint !== fingerprint({ bookingId, ...request })) {
      throw new BookingError(
        'IDEMPOTENCY_CONFLICT',
        'The Idempotency-Key was used for another request.',
      );
    }
    return { change: await this.current(known.changeId), replayed: true };
  }

  private async record(
    meta: RequestMeta,
    change: ChangeState,
    key: string,
    request: Readonly<Record<string, string | number>>,
  ): Promise<ChangeResult> {
    const inserted = await this.deps.changes.insertChange({
      change,
      idempotencyKey: key,
      fingerprint: fingerprint({ bookingId: change.bookingId, ...request }),
      expectedBookingVersion: request.expectedRevision as number,
      correlationId: meta.correlationId,
      audit: {
        action:
          change.kind === 'CANCELLATION'
            ? 'booking.cancellation.requested'
            : 'booking.reschedule.requested',
        actor: meta.actor,
        bookingId: change.bookingId,
        correlationId: meta.correlationId,
        details: {
          changeId: change.changeId,
          requester: change.requester.kind,
          reason: change.reason,
          toHoldId: change.to?.holdId ?? null,
        },
      },
    });
    switch (inserted.kind) {
      case 'REPLAY':
        return { change: await this.current(inserted.changeId), replayed: true };
      case 'IDEMPOTENCY_CONFLICT':
        throw new BookingError(
          'IDEMPOTENCY_CONFLICT',
          'The Idempotency-Key was used for another request.',
        );
      case 'CHANGE_IN_PROGRESS':
        throw new BookingError('CHANGE_IN_PROGRESS', 'Another change of this booking is running.');
      case 'REVISION_CONFLICT':
        throw new BookingError('REVISION_CONFLICT', 'The booking changed; reload it.');
      case 'CREATED':
        break;
    }
    this.deps.observer.record('booking_change_requested', {
      changeId: change.changeId,
      bookingId: change.bookingId,
      kind: change.kind,
    });
    await this.driveInline(change.changeId);
    return { change: await this.current(change.changeId), replayed: false };
  }

  private async driveInline(changeId: string): Promise<ChangeDriveResult> {
    try {
      return await this.deps.manager.drive(
        changeId,
        this.deps.instanceId,
        this.deps.inlineBudgetMs,
      );
    } catch (error) {
      // The change is durable; the worker resumes it.
      this.deps.observer.record('booking_change_inline_failed', {
        changeId,
        error: error instanceof Error ? error.name : 'UNKNOWN',
      });
      return 'WAITING';
    }
  }

  private async current(changeId: string): Promise<ChangeState> {
    const found = await this.deps.changes.findChange(changeId);
    if (!found) throw new Error('CHANGE_MISSING');
    return found.change;
  }
}

function requireKey(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    throw new BookingError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.');
  }
  return idempotencyKey(raw);
}

function closed(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BookingError('INVALID_INPUT', 'The body must be an object.');
  }
  const record = body as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (!keys.includes(name))
      throw new BookingError('INVALID_INPUT', 'The body has an unexpected field.');
  }
  for (const name of keys) {
    if (!Object.hasOwn(record, name))
      throw new BookingError('INVALID_INPUT', `${name} is required.`);
  }
  return record;
}

function revision(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    throw new BookingError('INVALID_INPUT', 'A revision must be a positive integer.');
  }
  return value;
}

function holdNotUsable(reason: string): BookingError {
  return new BookingError('HOLD_NOT_USABLE', 'The new time cannot be used.', reason);
}

function isOwner(meta: RequestMeta, record: BookingRecord): boolean {
  return (
    meta.actor.kind === 'USER' &&
    meta.actor.principalKind === record.booking.beneficiary.kind &&
    meta.actor.subject === record.booking.beneficiary.subjectId
  );
}

/** Only the booking's own principal (with the create permission) may reschedule. */
function beneficiaryRequester(meta: RequestMeta, record: BookingRecord): Requester {
  if (
    meta.actor.kind !== 'USER' ||
    !meta.actor.permissions.includes(CREATE_PERMISSION) ||
    !isOwner(meta, record)
  ) {
    throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
  }
  return record.booking.beneficiary;
}

/**
 * The customer cancels their own booking (CUSTOMER_REQUEST only); operations
 * staff cancel any booking with a staff reason. Everything else is refused.
 */
function cancellationRequester(
  meta: RequestMeta,
  record: BookingRecord,
  rawReason: unknown,
): { readonly requester: Requester; readonly reason: CancellationReason } {
  const actor = meta.actor;
  if (actor.kind !== 'USER') throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
  if (isOwner(meta, record) && actor.permissions.includes(CREATE_PERMISSION)) {
    const reason = CUSTOMER_CANCELLATION_REASONS.find((r) => r === rawReason);
    if (reason === undefined) throw new BookingError('INVALID_INPUT', 'reason is not allowed.');
    return { requester: record.booking.beneficiary, reason };
  }
  if (actor.permissions.includes(OPERATIONS_PERMISSION)) {
    const reason = STAFF_CANCELLATION_REASONS.find((r) => r === rawReason);
    if (reason === undefined) throw new BookingError('INVALID_INPUT', 'reason is not allowed.');
    return { requester: { kind: 'staff', subjectId: actor.subject }, reason };
  }
  throw new BookingError('FORBIDDEN', 'The operation is not allowed.');
}
