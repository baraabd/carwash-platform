import { createHash } from 'node:crypto';
import {
  BUSINESS_TIME_ZONE,
  HOLD_LIMITS,
  SchedulingError,
  assertDurationMinutes,
  commit,
  convertHeldToReserved,
  holdChangedEvent,
  holdUnits,
  invalid,
  isDue,
  localDateOf,
  nextLocalDate,
  releaseByBeneficiary,
  releaseHeldUnits,
  startOfLocalDay,
  v1State,
  type CapacityWindowState,
  type HoldState,
  type PrincipalKind,
  type ReleaseReason,
} from '../domain';
import type {
  AvailabilityRow,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  RequestMeta,
  SchedulingReadModel,
  SchedulingTransaction,
  SchedulingUnitOfWork,
  StoredResponse,
} from '../ports';
import {
  actorKey,
  isOperations,
  requirePrincipal,
  requireScope,
  type PrincipalActor,
} from './authorization';
import { assertUuid } from './capacity.service';
import { emit, eventActor, expireDueHoldsOf } from './expiry';

/** scheduling.v1 wire shapes produced by this owner (verified against the published parsers). */
export interface HoldV1View {
  readonly holdId: string;
  readonly revision: number;
  readonly state: ReturnType<typeof v1State>;
  readonly beneficiary: { readonly kind: PrincipalKind; readonly subjectId: string };
  readonly zoneId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly expiresAt: string;
  readonly bookingId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AvailabilityV1View {
  readonly zoneId: string;
  readonly date: string;
  readonly timezone: typeof BUSINESS_TIME_ZONE;
  readonly durationMinutes: number;
  readonly slots: readonly {
    readonly startsAt: string;
    readonly endsAt: string;
    readonly availability: 'AVAILABLE' | 'LIMITED';
  }[];
  readonly earliest: { readonly startsAt: string; readonly endsAt: string } | null;
  readonly asOf: string;
}

export interface HoldRequest {
  readonly beneficiary: { readonly kind: PrincipalKind; readonly subjectId: string };
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly quoteRef: { readonly quoteId: string; readonly revision: number };
}

export const CONTRACT = 'scheduling.v1';
const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_SLOTS = 200;

export function holdView(hold: HoldState): HoldV1View {
  const state = v1State(hold);
  return {
    holdId: hold.id,
    revision: hold.version,
    state,
    beneficiary: { kind: hold.beneficiaryKind, subjectId: hold.beneficiarySubject },
    zoneId: hold.zoneId,
    startsAt: hold.slotStartsAt.toISOString(),
    endsAt: hold.slotEndsAt.toISOString(),
    expiresAt: hold.expiresAt.toISOString(),
    bookingId: state === 'COMMITTED' ? hold.bookingId : null,
    createdAt: hold.createdAt.toISOString(),
    updatedAt: hold.updatedAt.toISOString(),
  };
}

/**
 * Canonical JSON exactly as the published protocol defines it (sorted keys,
 * NFC strings, no whitespace), so a fingerprint is stable across replicas.
 */
function canonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function fingerprint(
  operation: string,
  actor: string,
  target: string | null,
  body: unknown,
): string {
  const material = canonical({ v: 1, contract: CONTRACT, operation, actor, target, body });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export function requireKey(key: string | undefined): string {
  if (key === undefined || key === '') {
    throw new SchedulingError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.');
  }
  if (!IDEMPOTENCY_KEY.test(key)) throw invalid('Idempotency-Key is invalid.');
  return key;
}

/** NEW proceeds (null); REPLAY returns the stored outcome; the rest are refusals. */
export function settle(claim: IdempotencyClaim): StoredResponse | null {
  switch (claim.kind) {
    case 'NEW':
      return null;
    case 'REPLAY':
      return claim.response;
    case 'CONFLICT':
      throw new SchedulingError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key reused.');
    case 'IN_PROGRESS':
      throw new SchedulingError('IDEMPOTENCY_IN_PROGRESS', 'The same request is in progress.');
  }
}

/** Window-level refusals are all "this slot cannot be held" on the v1 surface. */
function asSlotUnavailable(error: unknown): unknown {
  if (
    error instanceof SchedulingError &&
    (error.code === 'WINDOW_CLOSED' ||
      error.code === 'WINDOW_STARTED' ||
      error.code === 'CAPACITY_EXHAUSTED')
  ) {
    return new SchedulingError('SLOT_UNAVAILABLE', 'The slot is no longer available.');
  }
  return error;
}

/** The deadline passed: the expiry was committed, no outcome was stored. */
const EXPIRED = Symbol('EXPIRED');

/**
 * scheduling.v1 holds and availability.
 *
 * Idempotency (protocol): (scope, key) -> (fingerprint, stored response) lives in
 * this service's database and is written in the SAME transaction as the change.
 * Only successful outcomes are stored; a refused command rolls the claim back,
 * so a retry is evaluated again rather than replaying a failure.
 */
export class HoldsV1Service {
  constructor(
    private readonly uow: SchedulingUnitOfWork,
    private readonly read: SchedulingReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // ---------------------------------------------------------------- holds

  async createHold(
    meta: RequestMeta,
    request: HoldRequest,
    rawKey: string | undefined,
  ): Promise<StoredResponse> {
    const principal = requirePrincipal(meta.actor);
    const key = requireKey(rawKey);
    if (
      request.beneficiary.kind !== principal.principalKind ||
      request.beneficiary.subjectId.toLowerCase() !== principal.subject
    ) {
      throw new SchedulingError('FORBIDDEN', 'A principal may hold slots only for itself.');
    }
    assertUuid(request.zoneId, 'zoneId');
    assertUuid(request.quoteRef.quoteId, 'quoteRef.quoteId');
    assertDurationMinutes(request.durationMinutes);
    const startsAt = request.startsAt;
    if (!Number.isFinite(startsAt.getTime())) throw invalid('startsAt is invalid.');
    const endsAt = new Date(startsAt.getTime() + request.durationMinutes * MINUTE);
    const now = this.clock.now();
    if (startsAt.getTime() - now.getTime() > HOLD_LIMITS.horizonDays * DAY) {
      throw new SchedulingError('OUTSIDE_HORIZON', 'The slot is beyond the booking horizon.');
    }
    if (startsAt.getTime() <= now.getTime()) {
      throw new SchedulingError('SLOT_UNAVAILABLE', 'The slot has already started.');
    }
    const zoneId = request.zoneId.toLowerCase();
    const actor = actorKey(principal);
    const scope = `${CONTRACT}:createHold:${actor}`;
    const print = fingerprint('createHold', actor, null, {
      beneficiary: { kind: request.beneficiary.kind, subjectId: principal.subject },
      zoneId,
      startsAt: startsAt.toISOString(),
      durationMinutes: request.durationMinutes,
      quoteRef: {
        quoteId: request.quoteRef.quoteId.toLowerCase(),
        revision: request.quoteRef.revision,
      },
    });

    try {
      return await this.uow.run(async (tx) => {
        const replay = settle(await tx.claimIdempotency(scope, key, print));
        if (replay) return replay;
        await tx.lockBeneficiary(principal.principalKind, principal.subject);
        const active = await tx.countActiveHolds(principal.principalKind, principal.subject, now);
        if (active >= HOLD_LIMITS.maxActivePerBeneficiary) {
          throw new SchedulingError('HOLD_LIMIT_REACHED', 'Too many active holds.');
        }
        const locked = await tx.lockCoveringWindow(zoneId, startsAt, endsAt);
        if (!locked) {
          throw new SchedulingError('SLOT_UNAVAILABLE', 'No bookable window for this slot.');
        }
        const current = await expireDueHoldsOf(tx, this.ids, locked, now, meta.correlationId);
        const next = holdUnits(current, 1, now, startsAt);
        const hold: HoldState = {
          id: this.ids.next(),
          windowId: locked.id,
          zoneId: locked.zoneId,
          beneficiaryKind: principal.principalKind,
          beneficiarySubject: principal.subject,
          quoteId: request.quoteRef.quoteId.toLowerCase(),
          quoteRevision: request.quoteRef.revision,
          slotStartsAt: startsAt,
          slotEndsAt: endsAt,
          units: 1,
          status: 'ACTIVE',
          expiresAt: new Date(now.getTime() + HOLD_LIMITS.ttlSeconds * 1000),
          bookingId: null,
          releaseReason: null,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        await tx.insertHold(hold);
        await tx.updateWindow(next, locked.version);
        await this.changed(tx, meta, hold);
        await tx.appendAudit({
          action: 'hold.created',
          actor: meta.actor,
          targetType: 'CAPACITY_HOLD',
          targetId: hold.id,
          correlationId: meta.correlationId,
          details: { windowId: locked.id, quoteId: hold.quoteId },
        });
        const response: StoredResponse = { status: 201, body: holdView(hold) };
        await tx.completeIdempotency(scope, key, response);
        return response;
      });
    } catch (error) {
      throw asSlotUnavailable(error);
    }
  }

  async getHold(meta: RequestMeta, holdId: string): Promise<HoldV1View> {
    assertUuid(holdId, 'holdId');
    const hold = await this.read.findHold(holdId.toLowerCase());
    if (!hold) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    if (isOperations(meta.actor)) return holdView(hold);
    this.assertBeneficiary(requirePrincipal(meta.actor), hold);
    return holdView(hold);
  }

  /**
   * Booking-only commit. Replay policy, in order:
   *   same Idempotency-Key + same body      -> the stored response
   *   hold already committed to bookingId   -> 200 with the hold (any key, any revision)
   *   otherwise                             -> live hold + matching expectedRevision
   */
  async commitHold(
    meta: RequestMeta,
    holdId: string,
    body: { readonly expectedRevision: number; readonly bookingId: string },
    rawKey: string | undefined,
  ): Promise<StoredResponse> {
    const service = requireScope(meta.actor, 'scheduling.hold.commit');
    const key = requireKey(rawKey);
    assertUuid(holdId, 'holdId');
    assertUuid(body.bookingId, 'bookingId');
    const id = holdId.toLowerCase();
    const bookingId = body.bookingId.toLowerCase();
    const known = await this.read.findHold(id);
    if (!known) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    const actor = actorKey(service);
    const scope = `${CONTRACT}:commitHold:${actor}`;
    const print = fingerprint('commitHold', actor, id, {
      expectedRevision: body.expectedRevision,
      bookingId,
    });
    const now = this.clock.now();

    const outcome = await this.uow.run(async (tx) => {
      const replay = settle(await tx.claimIdempotency(scope, key, print));
      if (replay) return replay;
      const locked = await this.lockedWindow(tx, known.windowId);
      const hold = await this.lockedHold(tx, id);
      if (isDue(hold, now)) return this.expireAndAbandon(tx, meta, locked, now, scope, key);
      const result = commit(hold, { bookingId, expectedRevision: body.expectedRevision, now });
      if (!result.replay) {
        await tx.updateHold(result.hold, hold.version);
        await tx.updateWindow(convertHeldToReserved(locked, hold.units), locked.version);
        await this.changed(tx, meta, result.hold);
        await tx.appendAudit({
          action: 'hold.committed',
          actor: meta.actor,
          targetType: 'CAPACITY_HOLD',
          targetId: hold.id,
          correlationId: meta.correlationId,
          details: { windowId: locked.id, bookingId },
        });
      }
      const response: StoredResponse = { status: 200, body: holdView(result.hold) };
      await tx.completeIdempotency(scope, key, response);
      return response;
    });
    return settleExpiry(outcome);
  }

  async releaseHold(
    meta: RequestMeta,
    holdId: string,
    body: { readonly expectedRevision: number; readonly reason: ReleaseReason },
    rawKey: string | undefined,
  ): Promise<StoredResponse> {
    const principal = requirePrincipal(meta.actor);
    const key = requireKey(rawKey);
    assertUuid(holdId, 'holdId');
    const id = holdId.toLowerCase();
    const known = await this.read.findHold(id);
    if (!known) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    this.assertBeneficiary(principal, known);
    const actor = actorKey(principal);
    const scope = `${CONTRACT}:releaseHold:${actor}`;
    const print = fingerprint('releaseHold', actor, id, {
      expectedRevision: body.expectedRevision,
      reason: body.reason,
    });
    const now = this.clock.now();

    const outcome = await this.uow.run(async (tx) => {
      const replay = settle(await tx.claimIdempotency(scope, key, print));
      if (replay) return replay;
      const locked = await this.lockedWindow(tx, known.windowId);
      const hold = await this.lockedHold(tx, id);
      if (isDue(hold, now)) return this.expireAndAbandon(tx, meta, locked, now, scope, key);
      const result = releaseByBeneficiary(hold, { ...body, now });
      await tx.updateHold(result.hold, hold.version);
      await tx.updateWindow(releaseHeldUnits(locked, hold.units), locked.version);
      await this.changed(tx, meta, result.hold);
      await tx.appendAudit({
        action: 'hold.released',
        actor: meta.actor,
        targetType: 'CAPACITY_HOLD',
        targetId: hold.id,
        correlationId: meta.correlationId,
        details: { windowId: locked.id, reason: body.reason },
      });
      const response: StoredResponse = { status: 200, body: holdView(result.hold) };
      await tx.completeIdempotency(scope, key, response);
      return response;
    });
    return settleExpiry(outcome);
  }

  // --------------------------------------------------------- availability

  /** Public: slots of one civil day in Asia/Damascus for a service duration. */
  async availability(query: {
    readonly zoneId: string;
    readonly date: string;
    readonly durationMinutes: number;
  }): Promise<AvailabilityV1View> {
    assertUuid(query.zoneId, 'zoneId');
    assertDurationMinutes(query.durationMinutes);
    const now = this.clock.now();
    const zoneId = query.zoneId.toLowerCase();
    const day = dayBounds(query.date);
    // Windows that started the day before may still yield slots starting today.
    const rows = await this.read.availability({
      zoneId,
      from: new Date(day.from.getTime() - DAY),
      to: day.to,
      now,
    });
    return dayView(zoneId, query.date, query.durationMinutes, rows, now, day);
  }

  /** Public: the first civil day within the horizon that has a slot, or today with none. */
  async earliest(query: {
    readonly zoneId: string;
    readonly durationMinutes: number;
  }): Promise<AvailabilityV1View> {
    assertUuid(query.zoneId, 'zoneId');
    assertDurationMinutes(query.durationMinutes);
    const now = this.clock.now();
    const zoneId = query.zoneId.toLowerCase();
    const today = localDateOf(now);
    const rows = await this.read.availability({
      zoneId,
      from: new Date(dayBounds(today).from.getTime() - DAY),
      to: new Date(now.getTime() + HOLD_LIMITS.horizonDays * DAY),
      now,
    });
    let day = today;
    for (let i = 0; i <= HOLD_LIMITS.horizonDays; i += 1) {
      const view = dayView(zoneId, day, query.durationMinutes, rows, now, dayBounds(day));
      if (view.earliest) return view;
      day = nextLocalDate(day);
    }
    return dayView(zoneId, today, query.durationMinutes, [], now, dayBounds(today));
  }

  // --------------------------------------------------------------- helpers

  /** Another principal's hold is reported as absent, never as forbidden. */
  private assertBeneficiary(principal: PrincipalActor, hold: HoldState): void {
    if (
      hold.beneficiaryKind !== principal.principalKind ||
      hold.beneficiarySubject !== principal.subject
    ) {
      throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    }
  }

  private async changed(
    tx: SchedulingTransaction,
    meta: RequestMeta,
    hold: HoldState,
  ): Promise<void> {
    await emit(
      tx,
      holdChangedEvent({
        eventId: this.ids.next(),
        correlationId: meta.correlationId,
        hold,
        zoneId: hold.zoneId,
        actor: eventActor(meta.actor),
      }),
    );
  }

  /**
   * The deadline passed: the expiry is a server fact and IS committed (with its
   * event); the idempotency claim is dropped so nothing is replayed, and the
   * caller is told HOLD_EXPIRED after the commit.
   */
  private async expireAndAbandon(
    tx: SchedulingTransaction,
    meta: RequestMeta,
    locked: CapacityWindowState,
    now: Date,
    scope: string,
    key: string,
  ): Promise<typeof EXPIRED> {
    const current = await expireDueHoldsOf(tx, this.ids, locked, now, meta.correlationId);
    await tx.updateWindow(current, locked.version);
    await tx.abandonIdempotency(scope, key);
    return EXPIRED;
  }

  private async lockedWindow(tx: SchedulingTransaction, id: string) {
    const window = await tx.lockWindow(id);
    if (!window) throw new SchedulingError('WINDOW_NOT_FOUND', 'Window not found.');
    return window;
  }

  private async lockedHold(tx: SchedulingTransaction, id: string): Promise<HoldState> {
    const hold = await tx.lockHold(id);
    if (!hold) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    return hold;
  }
}

function settleExpiry(outcome: StoredResponse | typeof EXPIRED): StoredResponse {
  if (outcome === EXPIRED) throw new SchedulingError('HOLD_EXPIRED', 'Hold has expired.');
  return outcome;
}

function dayBounds(date: string): { readonly from: Date; readonly to: Date } {
  return { from: startOfLocalDay(date), to: startOfLocalDay(nextLocalDate(date)) };
}

/**
 * Slots are cut from each OPEN window at its start, one service duration apart,
 * and must start inside the civil day. A window's free units are shared by every
 * slot cut from it (one unit = one crew for the whole window), so the published
 * availability never promises more than a hold can take.
 */
function dayView(
  zoneId: string,
  date: string,
  durationMinutes: number,
  rows: readonly AvailabilityRow[],
  now: Date,
  day: { readonly from: Date; readonly to: Date },
): AvailabilityV1View {
  const length = durationMinutes * MINUTE;
  const horizon = now.getTime() + HOLD_LIMITS.horizonDays * DAY;
  const slots: AvailabilityV1View['slots'][number][] = [];
  const sorted = [...rows].sort(
    (a, b) => a.window.startsAt.getTime() - b.window.startsAt.getTime(),
  );
  for (const { window, freeUnits } of sorted) {
    if (window.status !== 'OPEN' || freeUnits <= 0) continue;
    const availability = freeUnits === 1 ? 'LIMITED' : 'AVAILABLE';
    for (
      let start = window.startsAt.getTime();
      start + length <= window.endsAt.getTime() && slots.length < MAX_SLOTS;
      start += length
    ) {
      if (start <= now.getTime() || start > horizon) continue;
      if (start < day.from.getTime() || start >= day.to.getTime()) continue;
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + length).toISOString(),
        availability,
      });
    }
  }
  const first = slots[0];
  return {
    zoneId,
    date,
    timezone: BUSINESS_TIME_ZONE,
    durationMinutes,
    slots,
    earliest: first ? { startsAt: first.startsAt, endsAt: first.endsAt } : null,
    asOf: now.toISOString(),
  };
}
