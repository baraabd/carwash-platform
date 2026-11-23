import {
  WorkforceError,
  assertInServiceArea,
  canTakeNewWork,
  cancelException,
  createException,
  createShift,
  equipmentBlocks,
  expandWeek,
  initialAvailability,
  initialSchedule,
  initialServiceArea,
  operationalReadiness,
  overlaps,
  parseApplyCommand,
  parseEquipmentKind,
  parseEquipmentRequirementCommand,
  parseEquipmentStatusCommand,
  parseExceptionCommand,
  parseScheduleCommand,
  registerEquipment,
  replaceSchedule,
  replaceServiceArea,
  reportEquipmentStatus,
  serviceZoneIds,
  setEquipmentBlock,
  setEquipmentRequirement,
  type AvailabilityExceptionState,
  type AvailabilityState,
  type EquipmentState,
  type OperatorState,
  type Readiness,
  type ServiceAreaState,
  type ShiftState,
  type VerificationCaseState,
  type WeeklyScheduleState,
  type WeeklyWindow,
} from '../domain';
import type {
  Clock,
  IdGenerator,
  RequestMeta,
  WorkforceReadModel,
  WorkforceTransaction,
  WorkforceUnitOfWork,
} from '../ports';
import { requirePermission } from './authorization';
import {
  appendEligibility,
  appendShift,
  assertIdempotencyKey,
  idempotencyReused,
  requestFingerprint,
  requester,
} from './support';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Horizon of shifts and exceptions in the profile read model. */
export const PROFILE_HORIZON_DAYS = 14;

/** Everything the technician app shows about its own operational profile. */
export interface OperatorProfile {
  readonly operator: OperatorState;
  readonly skillCodes: readonly string[];
  readonly readiness: Readiness;
  readonly latestVerification: VerificationCaseState | null;
  readonly availability: AvailabilityState;
  readonly serviceArea: ServiceAreaState;
  readonly serviceZoneIds: readonly string[];
  readonly schedule: WeeklyScheduleState;
  readonly upcomingShifts: readonly ShiftState[];
  readonly exceptions: readonly AvailabilityExceptionState[];
  readonly equipment: readonly EquipmentState[];
  readonly asOf: Date;
}

export type ScheduleSkipReason = 'PAST' | 'EXCEPTION' | 'OVERLAPS' | 'ZONE_OUTSIDE_SERVICE_AREA';

export interface ScheduleApplication {
  readonly created: readonly ShiftState[];
  /** Shifts this week/revision already created (replay of the same apply). */
  readonly existing: readonly ShiftState[];
  readonly skipped: ReadonlyArray<{
    readonly window: WeeklyWindow;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly reason: ScheduleSkipReason;
  }>;
}

/**
 * P05-C1 application service: the technician's operational profile — service
 * area, weekly availability and its application to dated shifts, availability
 * exceptions and equipment / service-vehicle readiness.
 *
 * Authorization: the technician acts on its own operator only (resolved from
 * the Identity subject, never from a path id); operations act on any operator
 * with `operations.dispatch`. Every mutation is one local transaction with its
 * audit row; an equipment change that moves the block also moves the
 * eligibility revision and writes the published event in that transaction.
 */
export class OperatorProfileService {
  constructor(
    private readonly uow: WorkforceUnitOfWork,
    private readonly read: WorkforceReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // -------------------------------------------------------------------------
  // Read model
  // -------------------------------------------------------------------------

  async myProfile(meta: RequestMeta): Promise<OperatorProfile> {
    const user = requirePermission(meta.actor, 'work.read:assigned');
    const operator = await this.read.findOperatorBySubject(user.subject);
    if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
    return this.profileOf(operator);
  }

  async operatorProfile(meta: RequestMeta, operatorId: string): Promise<OperatorProfile> {
    requirePermission(meta.actor, 'operations.dispatch');
    const operator = await this.read.findOperator(operatorId);
    if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
    return this.profileOf(operator);
  }

  private async profileOf(operator: OperatorState): Promise<OperatorProfile> {
    const asOf = this.clock.now();
    const until = new Date(asOf.getTime() + PROFILE_HORIZON_DAYS * DAY_MS);
    const [
      skillCodes,
      latestVerification,
      availability,
      area,
      schedule,
      shifts,
      exceptions,
      equipment,
    ] = await Promise.all([
      this.read.listSkills(operator.id),
      this.read.latestVerificationCase(operator.id),
      this.read.findAvailability(operator.id),
      this.read.findServiceArea(operator.id),
      this.read.findSchedule(operator.id),
      this.read.listShifts(operator.id, asOf, until),
      this.read.listExceptions(operator.id, asOf, until),
      this.read.listEquipment(operator.id),
    ]);
    const serviceArea = area ?? initialServiceArea(operator.id);
    return {
      operator,
      skillCodes,
      readiness: operationalReadiness(operator, skillCodes, asOf),
      latestVerification,
      availability: availability ?? initialAvailability(operator.id),
      serviceArea,
      serviceZoneIds: serviceZoneIds(operator, serviceArea),
      schedule: schedule ?? initialSchedule(operator.id),
      upcomingShifts: shifts.filter((shift) => shift.status === 'ACTIVE'),
      exceptions: exceptions.filter((exception) => exception.status === 'ACTIVE'),
      equipment,
      asOf,
    };
  }

  // -------------------------------------------------------------------------
  // Service area (operations)
  // -------------------------------------------------------------------------

  async setServiceArea(
    meta: RequestMeta,
    operatorId: string,
    body: unknown,
  ): Promise<{ operator: OperatorState; area: ServiceAreaState }> {
    requirePermission(meta.actor, 'operations.dispatch');
    const command = parseServiceAreaBody(body);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await tx.lockOperator(operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      const current = (await tx.lockServiceArea(operator.id)) ?? initialServiceArea(operator.id);
      const { next, changed } = replaceServiceArea(operator, current, command, now);
      if (!changed) return { operator, area: current };
      if (!(await tx.saveServiceArea(next, current.revision))) {
        throw new WorkforceError('REVISION_CONFLICT', 'Service area changed; refetch and retry.');
      }
      await tx.appendAudit({
        action: 'SERVICE_AREA_CHANGED',
        actor: meta.actor,
        targetType: 'OPERATOR',
        targetId: operator.id,
        correlationId: meta.correlationId,
        details: { revision: next.revision, zoneCount: next.extraZoneIds.length + 1 },
      });
      return { operator, area: next };
    });
  }

  // -------------------------------------------------------------------------
  // Weekly schedule (technician)
  // -------------------------------------------------------------------------

  async setSchedule(meta: RequestMeta, body: unknown): Promise<WeeklyScheduleState> {
    const user = requirePermission(meta.actor, 'work.execute:assigned');
    const command = parseScheduleCommand(body);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await this.lockSelf(tx, user.subject);
      const area = (await tx.readServiceArea(operator.id)) ?? initialServiceArea(operator.id);
      for (const window of command.windows) assertInServiceArea(operator, area, window.zoneId);
      const current = (await tx.lockSchedule(operator.id)) ?? initialSchedule(operator.id);
      const { next, changed } = replaceSchedule(current, command, now);
      if (!changed) return current;
      if (!(await tx.saveSchedule(next, current.revision))) {
        throw new WorkforceError('REVISION_CONFLICT', 'Schedule changed; refetch and retry.');
      }
      await tx.appendAudit({
        action: 'WEEKLY_SCHEDULE_CHANGED',
        actor: meta.actor,
        targetType: 'OPERATOR',
        targetId: operator.id,
        correlationId: meta.correlationId,
        details: { revision: next.revision, windows: next.windows.length, timeZone: next.timeZone },
      });
      return next;
    });
  }

  /**
   * Turns one local week of the schedule into ACTIVE shifts. Each occurrence
   * is an ordinary shift with a key derived from (week, schedule revision,
   * window), so repeating the same apply returns the same shifts and never
   * duplicates. Occurrences in the past, inside an ACTIVE exception, outside
   * the current service area or overlapping an existing shift are skipped and
   * reported, never forced.
   */
  async applySchedule(meta: RequestMeta, body: unknown): Promise<ScheduleApplication> {
    const user = requirePermission(meta.actor, 'work.execute:assigned');
    const command = parseApplyCommand(body);
    const now = this.clock.now();
    const requestBy = requester(meta.actor);
    return this.uow.run(async (tx) => {
      const operator = await this.lockSelf(tx, user.subject);
      if (!canTakeNewWork(operator)) {
        throw new WorkforceError('OPERATOR_NOT_ACTIVE', 'Operator cannot declare new work.');
      }
      const schedule = (await tx.lockSchedule(operator.id)) ?? initialSchedule(operator.id);
      const occurrences = expandWeek(schedule, command, now);
      const area = (await tx.readServiceArea(operator.id)) ?? initialServiceArea(operator.id);
      const zones = serviceZoneIds(operator, area);
      const first = occurrences[0];
      const last = occurrences[occurrences.length - 1];
      const blocked =
        first === undefined || last === undefined
          ? []
          : await tx.listActiveExceptions(operator.id, first.startsAt, last.endsAt);
      const replays = new Map(
        (
          await tx.findShiftsByIdempotencyKeys(
            requestBy,
            occurrences.map((occurrence) => occurrence.key),
          )
        ).map((shift) => [shift.idempotencyKey, shift]),
      );
      const result: {
        created: ShiftState[];
        existing: ShiftState[];
        skipped: Array<ScheduleApplication['skipped'][number]>;
      } = { created: [], existing: [], skipped: [] };
      for (const occurrence of occurrences) {
        const skip = (reason: ScheduleSkipReason) =>
          result.skipped.push({
            window: occurrence.window,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            reason,
          });
        const fingerprint = requestFingerprint({
          operatorId: operator.id,
          zoneId: occurrence.window.zoneId,
          startsAt: occurrence.startsAt.toISOString(),
          endsAt: occurrence.endsAt.toISOString(),
        });
        const replay = replays.get(occurrence.key);
        if (replay) {
          if (replay.requestFingerprint !== fingerprint) idempotencyReused();
          result.existing.push(replay);
          continue;
        }
        if (occurrence.startsAt.getTime() <= now.getTime()) {
          skip('PAST');
          continue;
        }
        if (!zones.includes(occurrence.window.zoneId)) {
          skip('ZONE_OUTSIDE_SERVICE_AREA');
          continue;
        }
        if (blocked.some((exception) => overlaps(exception, occurrence))) {
          skip('EXCEPTION');
          continue;
        }
        const shift = createShift({
          id: this.ids.next(),
          operatorId: operator.id,
          zoneId: occurrence.window.zoneId,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          requester: requestBy,
          idempotencyKey: occurrence.key,
          requestFingerprint: fingerprint,
          now,
        });
        const inserted = await tx.insertShift(shift);
        if (inserted === 'OVERLAPS') {
          skip('OVERLAPS');
          continue;
        }
        if (inserted !== 'CREATED') {
          const again = await tx.findShiftByIdempotency(requestBy, occurrence.key);
          if (again?.requestFingerprint !== fingerprint) idempotencyReused();
          result.existing.push(again);
          continue;
        }
        await appendShift(tx, this.ids, this.clock, meta, shift);
        result.created.push(shift);
      }
      await tx.appendAudit({
        action: 'WEEKLY_SCHEDULE_APPLIED',
        actor: meta.actor,
        targetType: 'OPERATOR',
        targetId: operator.id,
        correlationId: meta.correlationId,
        details: {
          revision: schedule.revision,
          created: result.created.length,
          existing: result.existing.length,
          skipped: result.skipped.length,
        },
      });
      return result;
    });
  }

  // -------------------------------------------------------------------------
  // Availability exceptions (technician for itself, operations for anyone)
  // -------------------------------------------------------------------------

  async createMyException(
    meta: RequestMeta,
    body: unknown,
    idempotencyKey: string,
  ): Promise<AvailabilityExceptionState> {
    const user = requirePermission(meta.actor, 'work.execute:assigned');
    return this.createException(meta, body, idempotencyKey, (tx) =>
      this.lockSelf(tx, user.subject),
    );
  }

  async createOperatorException(
    meta: RequestMeta,
    operatorId: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<AvailabilityExceptionState> {
    requirePermission(meta.actor, 'operations.dispatch');
    return this.createException(meta, body, idempotencyKey, async (tx) => {
      const operator = await tx.lockOperator(operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      return operator;
    });
  }

  private async createException(
    meta: RequestMeta,
    body: unknown,
    idempotencyKey: string,
    target: (tx: WorkforceTransaction) => Promise<OperatorState>,
  ): Promise<AvailabilityExceptionState> {
    const command = parseExceptionCommand(body);
    assertIdempotencyKey(idempotencyKey);
    const requestBy = requester(meta.actor);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await target(tx);
      const fingerprint = requestFingerprint({
        operatorId: operator.id,
        startsAt: command.startsAt.toISOString(),
        endsAt: command.endsAt.toISOString(),
        reason: command.reason,
      });
      const replay = await tx.findExceptionByIdempotency(requestBy, idempotencyKey);
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) idempotencyReused();
        return replay;
      }
      const state = createException({
        id: this.ids.next(),
        operatorId: operator.id,
        command,
        requester: requestBy,
        idempotencyKey,
        requestFingerprint: fingerprint,
        now,
      });
      const inserted = await tx.insertException(state);
      if (inserted === 'OVERLAPS') {
        throw new WorkforceError('EXCEPTION_OVERLAPS', 'Exception overlaps an active exception.');
      }
      if (inserted !== 'CREATED') {
        const again = await tx.findExceptionByIdempotency(requestBy, idempotencyKey);
        if (again?.requestFingerprint !== fingerprint) idempotencyReused();
        return again;
      }
      await tx.appendAudit({
        action: 'AVAILABILITY_EXCEPTION_CREATED',
        actor: meta.actor,
        targetType: 'AVAILABILITY_EXCEPTION',
        targetId: state.id,
        correlationId: meta.correlationId,
        details: {
          operatorId: operator.id,
          reason: state.reason,
          startsAt: state.startsAt.toISOString(),
          endsAt: state.endsAt.toISOString(),
        },
      });
      return state;
    });
  }

  /** The technician cancels its own exception; operations cancel any. Repeat = refusal. */
  async cancelException(
    meta: RequestMeta,
    exceptionId: string,
  ): Promise<AvailabilityExceptionState> {
    if (meta.actor.kind !== 'USER') throw new WorkforceError('FORBIDDEN', 'User caller required.');
    const actor = meta.actor;
    const isOperations = actor.permissions.includes('operations.dispatch');
    if (!isOperations) requirePermission(actor, 'work.execute:assigned');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.lockException(exceptionId);
      if (!current) throw new WorkforceError('EXCEPTION_NOT_FOUND', 'Exception not found.');
      const operator = await tx.lockOperator(current.operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      if (!isOperations) {
        // Not the owner: answer as not found, never confirm another's exception exists.
        if (operator.identitySubject !== actor.subject) {
          throw new WorkforceError('EXCEPTION_NOT_FOUND', 'Exception not found.');
        }
      }
      const next = cancelException(current, now);
      await tx.updateException(next, current.version);
      await tx.appendAudit({
        action: 'AVAILABILITY_EXCEPTION_CANCELLED',
        actor: meta.actor,
        targetType: 'AVAILABILITY_EXCEPTION',
        targetId: next.id,
        correlationId: meta.correlationId,
        details: { operatorId: operator.id },
      });
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Equipment / service vehicle
  // -------------------------------------------------------------------------

  async registerEquipment(
    meta: RequestMeta,
    operatorId: string,
    body: unknown,
  ): Promise<EquipmentState> {
    requirePermission(meta.actor, 'operations.dispatch');
    const input = parseRegisterBody(body);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await tx.lockOperator(operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      const state = registerEquipment({
        id: this.ids.next(),
        operatorId: operator.id,
        kind: input.kind,
        required: input.required,
        now,
      });
      if ((await tx.insertEquipment(state)) !== 'CREATED') {
        throw new WorkforceError('EQUIPMENT_EXISTS', 'Equipment of this kind is registered.');
      }
      await tx.appendAudit({
        action: 'EQUIPMENT_REGISTERED',
        actor: meta.actor,
        targetType: 'EQUIPMENT',
        targetId: state.id,
        correlationId: meta.correlationId,
        details: { operatorId: operator.id, kind: state.kind, required: state.required },
      });
      // A new item starts READY: it can never block on registration.
      return state;
    });
  }

  async setEquipmentRequirement(
    meta: RequestMeta,
    operatorId: string,
    rawKind: string,
    body: unknown,
  ): Promise<EquipmentState> {
    requirePermission(meta.actor, 'operations.dispatch');
    const kind = parseEquipmentKind(rawKind);
    const command = parseEquipmentRequirementCommand(body);
    return this.changeEquipment(
      meta,
      async (tx) => {
        const operator = await tx.lockOperator(operatorId);
        if (!operator) {
          throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
        }
        return operator;
      },
      kind,
      (item, now) => setEquipmentRequirement(item, command, now),
      'EQUIPMENT_REQUIREMENT_CHANGED',
    );
  }

  async reportMyEquipment(
    meta: RequestMeta,
    rawKind: string,
    body: unknown,
  ): Promise<EquipmentState> {
    const user = requirePermission(meta.actor, 'work.execute:assigned');
    const kind = parseEquipmentKind(rawKind);
    const command = parseEquipmentStatusCommand(body);
    return this.changeEquipment(
      meta,
      (tx) => this.lockSelf(tx, user.subject),
      kind,
      (item, now) => reportEquipmentStatus(item, command, now),
      'EQUIPMENT_STATUS_REPORTED',
    );
  }

  async reportOperatorEquipment(
    meta: RequestMeta,
    operatorId: string,
    rawKind: string,
    body: unknown,
  ): Promise<EquipmentState> {
    requirePermission(meta.actor, 'operations.dispatch');
    const kind = parseEquipmentKind(rawKind);
    const command = parseEquipmentStatusCommand(body);
    return this.changeEquipment(
      meta,
      async (tx) => {
        const operator = await tx.lockOperator(operatorId);
        if (!operator) {
          throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
        }
        return operator;
      },
      kind,
      (item, now) => reportEquipmentStatus(item, command, now),
      'EQUIPMENT_STATUS_REPORTED',
    );
  }

  /**
   * Lock order: operator -> its equipment rows. The block is recomputed from
   * all items after the change; when it moved, the operator row moves its
   * version and eligibility revision and the published event is appended,
   * all in this transaction.
   */
  private async changeEquipment(
    meta: RequestMeta,
    target: (tx: WorkforceTransaction) => Promise<OperatorState>,
    kind: EquipmentState['kind'],
    change: (
      item: EquipmentState,
      now: Date,
    ) => { readonly next: EquipmentState; readonly changed: boolean },
    action: 'EQUIPMENT_STATUS_REPORTED' | 'EQUIPMENT_REQUIREMENT_CHANGED',
  ): Promise<EquipmentState> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await target(tx);
      const items = await tx.lockEquipment(operator.id);
      const item = items.find((candidate) => candidate.kind === kind);
      if (!item) throw new WorkforceError('EQUIPMENT_NOT_FOUND', 'Equipment not registered.');
      const { next, changed } = change(item, now);
      if (!changed) return item;
      await tx.updateEquipment(next, item.revision);
      const blocked = equipmentBlocks(
        items.map((candidate) => (candidate.id === next.id ? next : candidate)),
      );
      const projected = setEquipmentBlock(operator, blocked, now);
      if (projected !== operator) {
        await tx.updateOperator(projected, operator.version);
        await appendEligibility(tx, this.ids, meta, operator, projected);
      }
      await tx.appendAudit({
        action,
        actor: meta.actor,
        targetType: 'EQUIPMENT',
        targetId: next.id,
        correlationId: meta.correlationId,
        details: {
          operatorId: operator.id,
          kind: next.kind,
          status: next.status,
          issue: next.issue,
          required: next.required,
          revision: next.revision,
          operatorBlocked: blocked,
        },
      });
      return next;
    });
  }

  private async lockSelf(tx: WorkforceTransaction, subject: string): Promise<OperatorState> {
    const operator = await tx.lockOperatorBySubject(subject);
    if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
    return operator;
  }
}

function parseServiceAreaBody(body: unknown): {
  readonly zoneIds: readonly string[];
  readonly expectedRevision: number;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WorkforceError('INVALID_INPUT', 'Body must be a JSON object.');
  }
  if (Object.keys(body).sort().join(',') !== 'expectedRevision,zoneIds') {
    throw new WorkforceError('INVALID_INPUT', 'Body must be exactly {zoneIds, expectedRevision}.');
  }
  const zoneIds: unknown = Reflect.get(body, 'zoneIds');
  const expectedRevision: unknown = Reflect.get(body, 'expectedRevision');
  if (
    !Array.isArray(zoneIds) ||
    !zoneIds.every((zone): zone is string => typeof zone === 'string')
  ) {
    throw new WorkforceError('INVALID_INPUT', 'zoneIds must be an array of UUIDs.');
  }
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw new WorkforceError('INVALID_INPUT', 'expectedRevision must be a non-negative integer.');
  }
  return { zoneIds, expectedRevision };
}

function parseRegisterBody(body: unknown): {
  readonly kind: EquipmentState['kind'];
  readonly required: boolean;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WorkforceError('INVALID_INPUT', 'Body must be a JSON object.');
  }
  if (Object.keys(body).sort().join(',') !== 'kind,required') {
    throw new WorkforceError('INVALID_INPUT', 'Body must be exactly {kind, required}.');
  }
  const required: unknown = Reflect.get(body, 'required');
  if (typeof required !== 'boolean') {
    throw new WorkforceError('INVALID_INPUT', 'required must be a boolean.');
  }
  return { kind: parseEquipmentKind(Reflect.get(body, 'kind')), required };
}
