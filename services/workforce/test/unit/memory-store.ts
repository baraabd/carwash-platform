import { overlaps } from '../../src/domain';
import type {
  AvailabilityExceptionState,
  AvailabilityState,
  EquipmentState,
  ServiceAreaState,
  WeeklyScheduleState,
  CapacityCandidate,
  OperatorState,
  ShiftState,
  VerificationCaseState,
} from '../../src/domain';
import type {
  AuditAppend,
  InsertExceptionResult,
  InsertResult,
  InsertShiftResult,
  OutboxAppend,
  WorkforceReadModel,
  WorkforceTransaction,
  WorkforceUnitOfWork,
} from '../../src/ports';

/** Runs synchronous fake logic as a promise: a throw becomes a rejection. */
function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * In-memory stand-in for the ports, used by application-level unit tests only.
 * It models single-writer semantics (no concurrency); the real row locks,
 * constraints and races are proven by test/integration/*.pg.spec.ts.
 */
export class MemoryStore implements WorkforceUnitOfWork, WorkforceReadModel {
  readonly operators = new Map<string, OperatorState>();
  readonly skills = new Map<string, Set<string>>();
  readonly availability = new Map<string, AvailabilityState>();
  readonly outbox: OutboxAppend[] = [];
  readonly audit: AuditAppend[] = [];
  readonly cases = new Map<string, VerificationCaseState>();
  readonly profile = new ProfileTables();
  readonly shifts = new Map<string, ShiftState>();
  transactions = 0;
  candidates: CapacityCandidate[] = [];
  lastCandidateQuery: Parameters<WorkforceReadModel['listCapacityCandidates']>[0] | null = null;

  async run<T>(work: (tx: WorkforceTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    // Commit-or-nothing: work on copies, apply only when the callback succeeds.
    const operators = new Map(this.operators);
    const skills = new Map([...this.skills].map(([k, v]) => [k, new Set(v)]));
    const availability = new Map(this.availability);
    const cases = new Map(this.cases);
    const profile = this.profile.copy();
    const shifts = new Map(this.shifts);
    const outbox: OutboxAppend[] = [];
    const audit: AuditAppend[] = [];
    const tx = new MemoryTransaction(
      operators,
      skills,
      availability,
      cases,
      outbox,
      audit,
      profile,
      shifts,
    );
    const result = await work(tx);
    this.replace(this.operators, operators);
    this.replace(this.skills, skills);
    this.replace(this.availability, availability);
    this.replace(this.cases, cases);
    this.profile.adopt(profile);
    this.replace(this.shifts, shifts);
    this.outbox.push(...outbox);
    this.audit.push(...audit);
    return result;
  }

  private replace<K, V>(target: Map<K, V>, source: Map<K, V>): void {
    target.clear();
    for (const [k, v] of source) target.set(k, v);
  }

  findOperator(id: string): Promise<OperatorState | null> {
    return settle(() => {
      return this.operators.get(id) ?? null;
    });
  }
  findOperatorBySubject(subject: string): Promise<OperatorState | null> {
    return settle(() => {
      return [...this.operators.values()].find((o) => o.identitySubject === subject) ?? null;
    });
  }
  listSkills(operatorId: string): Promise<string[]> {
    return settle(() => {
      return [...(this.skills.get(operatorId) ?? [])].sort();
    });
  }
  findVerificationCase(id: string): Promise<VerificationCaseState | null> {
    return settle(() => {
      return this.cases.get(id) ?? null;
    });
  }
  listShifts(operatorId: string, from: Date, to: Date): Promise<ShiftState[]> {
    return settle(() =>
      [...this.shifts.values()]
        .filter((s) => s.operatorId === operatorId && overlaps(s, { startsAt: from, endsAt: to }))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }
  findServiceArea(operatorId: string): Promise<ServiceAreaState | null> {
    return settle(() => this.profile.areas.get(operatorId) ?? null);
  }
  findSchedule(operatorId: string): Promise<WeeklyScheduleState | null> {
    return settle(() => this.profile.schedules.get(operatorId) ?? null);
  }
  listExceptions(operatorId: string, from: Date, to: Date): Promise<AvailabilityExceptionState[]> {
    return settle(() => this.profile.exceptionsOf(operatorId, from, to, false));
  }
  listEquipment(operatorId: string): Promise<EquipmentState[]> {
    return settle(() => this.profile.equipmentOf(operatorId));
  }
  latestVerificationCase(operatorId: string): Promise<VerificationCaseState | null> {
    return settle(
      () =>
        [...this.cases.values()]
          .filter((c) => c.operatorId === operatorId)
          .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())[0] ?? null,
    );
  }
  findAvailability(operatorId: string): Promise<AvailabilityState | null> {
    return settle(() => {
      return this.availability.get(operatorId) ?? null;
    });
  }
  listCapacityCandidates(
    input: Parameters<WorkforceReadModel['listCapacityCandidates']>[0],
  ): Promise<CapacityCandidate[]> {
    return settle(() => {
      this.lastCandidateQuery = input;
      return this.candidates
        .filter((c) => input.afterOperatorId === null || c.operator.id > input.afterOperatorId)
        .sort((a, b) => (a.operator.id < b.operator.id ? -1 : 1))
        .slice(0, input.limit);
    });
  }
  eligibleOperators(): Promise<
    Array<{ readonly operator: OperatorState; readonly skillCodes: readonly string[] }>
  > {
    return settle(() => {
      return [];
    });
  }
}

class MemoryTransaction implements WorkforceTransaction {
  constructor(
    private readonly operators: Map<string, OperatorState>,
    private readonly skills: Map<string, Set<string>>,
    private readonly availability: Map<string, AvailabilityState>,
    private readonly cases: Map<string, VerificationCaseState>,
    private readonly outbox: OutboxAppend[],
    private readonly audit: AuditAppend[],
    private readonly profile: ProfileTables,
    private readonly shifts: Map<string, ShiftState>,
  ) {}

  lockOperator(id: string): Promise<OperatorState | null> {
    return settle(() => {
      return this.operators.get(id) ?? null;
    });
  }
  lockOperatorBySubject(subject: string): Promise<OperatorState | null> {
    return settle(() => {
      return [...this.operators.values()].find((o) => o.identitySubject === subject) ?? null;
    });
  }
  readOperatorBySubject(subject: string): Promise<OperatorState | null> {
    return this.lockOperatorBySubject(subject);
  }
  insertOperator(operator: OperatorState): Promise<InsertResult> {
    return settle(() => {
      if (
        [...this.operators.values()].some((o) => o.identitySubject === operator.identitySubject)
      ) {
        return 'DUPLICATE';
      }
      this.operators.set(operator.id, operator);
      return 'CREATED';
    });
  }
  updateOperator(operator: OperatorState, expectedVersion: number): Promise<void> {
    return settle(() => {
      const current = this.operators.get(operator.id);
      if (!current || current.version !== expectedVersion) throw new Error('VERSION_MISMATCH');
      this.operators.set(operator.id, operator);
    });
  }
  listSkills(operatorId: string): Promise<string[]> {
    return settle(() => {
      return [...(this.skills.get(operatorId) ?? [])].sort();
    });
  }
  insertSkill(input: {
    readonly operatorId: string;
    readonly skillCode: string;
  }): Promise<InsertResult> {
    return settle(() => {
      const set = this.skills.get(input.operatorId) ?? new Set<string>();
      if (set.has(input.skillCode)) return 'DUPLICATE';
      set.add(input.skillCode);
      this.skills.set(input.operatorId, set);
      return 'CREATED';
    });
  }
  removeSkill(operatorId: string, skillCode: string): Promise<boolean> {
    return settle(() => {
      return this.skills.get(operatorId)?.delete(skillCode) ?? false;
    });
  }
  lockVerificationCase(id: string): Promise<VerificationCaseState | null> {
    return settle(() => {
      return this.cases.get(id) ?? null;
    });
  }
  findPendingCase(operatorId: string): Promise<VerificationCaseState | null> {
    return settle(() => {
      return (
        [...this.cases.values()].find(
          (c) => c.operatorId === operatorId && c.status === 'PENDING_REVIEW',
        ) ?? null
      );
    });
  }
  findCaseByIdempotency(requester: string, key: string): Promise<VerificationCaseState | null> {
    return settle(() => {
      return (
        [...this.cases.values()].find(
          (c) => c.requester === requester && c.idempotencyKey === key,
        ) ?? null
      );
    });
  }
  insertVerificationCase(state: VerificationCaseState): Promise<InsertResult> {
    return settle(() => {
      this.cases.set(state.id, state);
      return 'CREATED';
    });
  }
  updateVerificationCase(state: VerificationCaseState): Promise<void> {
    return settle(() => {
      this.cases.set(state.id, state);
    });
  }
  lockShift(id: string): Promise<ShiftState | null> {
    return settle(() => this.shifts.get(id) ?? null);
  }
  findShiftByIdempotency(requester: string, key: string): Promise<ShiftState | null> {
    return settle(
      () =>
        [...this.shifts.values()].find(
          (s) => s.requester === requester && s.idempotencyKey === key,
        ) ?? null,
    );
  }
  findShiftsByIdempotencyKeys(requester: string, keys: readonly string[]): Promise<ShiftState[]> {
    return settle(() =>
      [...this.shifts.values()].filter(
        (s) => s.requester === requester && keys.includes(s.idempotencyKey),
      ),
    );
  }
  insertShift(state: ShiftState): Promise<InsertShiftResult> {
    return settle(() => {
      const all = [...this.shifts.values()];
      if (
        all.some(
          (s) => s.requester === state.requester && s.idempotencyKey === state.idempotencyKey,
        )
      ) {
        return 'DUPLICATE_IDEMPOTENCY_KEY';
      }
      if (
        all.some(
          (s) => s.operatorId === state.operatorId && s.status === 'ACTIVE' && overlaps(s, state),
        )
      ) {
        return 'OVERLAPS';
      }
      this.shifts.set(state.id, state);
      return 'CREATED';
    });
  }
  updateShift(state: ShiftState): Promise<void> {
    return settle(() => {
      this.shifts.set(state.id, state);
    });
  }
  lockServiceArea(operatorId: string): Promise<ServiceAreaState | null> {
    return settle(() => this.profile.areas.get(operatorId) ?? null);
  }
  readServiceArea(operatorId: string): Promise<ServiceAreaState | null> {
    return this.lockServiceArea(operatorId);
  }
  saveServiceArea(state: ServiceAreaState, expectedRevision: number): Promise<boolean> {
    return settle(() => {
      if ((this.profile.areas.get(state.operatorId)?.revision ?? 0) !== expectedRevision)
        return false;
      this.profile.areas.set(state.operatorId, state);
      return true;
    });
  }
  lockSchedule(operatorId: string): Promise<WeeklyScheduleState | null> {
    return settle(() => this.profile.schedules.get(operatorId) ?? null);
  }
  saveSchedule(state: WeeklyScheduleState, expectedRevision: number): Promise<boolean> {
    return settle(() => {
      if ((this.profile.schedules.get(state.operatorId)?.revision ?? 0) !== expectedRevision) {
        return false;
      }
      this.profile.schedules.set(state.operatorId, state);
      return true;
    });
  }
  findExceptionByIdempotency(
    requester: string,
    key: string,
  ): Promise<AvailabilityExceptionState | null> {
    return settle(
      () =>
        [...this.profile.exceptions.values()].find(
          (e) => e.requester === requester && e.idempotencyKey === key,
        ) ?? null,
    );
  }
  insertException(state: AvailabilityExceptionState): Promise<InsertExceptionResult> {
    return settle(() => {
      const all = [...this.profile.exceptions.values()];
      if (
        all.some(
          (e) => e.requester === state.requester && e.idempotencyKey === state.idempotencyKey,
        )
      ) {
        return 'DUPLICATE_IDEMPOTENCY_KEY';
      }
      if (
        all.some(
          (e) => e.operatorId === state.operatorId && e.status === 'ACTIVE' && overlaps(e, state),
        )
      ) {
        return 'OVERLAPS';
      }
      this.profile.exceptions.set(state.id, state);
      return 'CREATED';
    });
  }
  lockException(id: string): Promise<AvailabilityExceptionState | null> {
    return settle(() => this.profile.exceptions.get(id) ?? null);
  }
  updateException(state: AvailabilityExceptionState, expectedVersion: number): Promise<void> {
    return settle(() => {
      if (this.profile.exceptions.get(state.id)?.version !== expectedVersion) {
        throw new Error('VERSION_MISMATCH');
      }
      this.profile.exceptions.set(state.id, state);
    });
  }
  listActiveExceptions(
    operatorId: string,
    from: Date,
    to: Date,
  ): Promise<AvailabilityExceptionState[]> {
    return settle(() => this.profile.exceptionsOf(operatorId, from, to, true));
  }
  lockEquipment(operatorId: string): Promise<EquipmentState[]> {
    return settle(() => this.profile.equipmentOf(operatorId));
  }
  insertEquipment(state: EquipmentState): Promise<InsertResult> {
    return settle(() => {
      if (this.profile.equipmentOf(state.operatorId).some((e) => e.kind === state.kind)) {
        return 'DUPLICATE';
      }
      this.profile.equipment.set(state.id, state);
      return 'CREATED';
    });
  }
  updateEquipment(state: EquipmentState, expectedRevision: number): Promise<void> {
    return settle(() => {
      if (this.profile.equipment.get(state.id)?.revision !== expectedRevision) {
        throw new Error('VERSION_MISMATCH');
      }
      this.profile.equipment.set(state.id, state);
    });
  }
  lockAvailability(operatorId: string): Promise<AvailabilityState | null> {
    return settle(() => {
      return this.availability.get(operatorId) ?? null;
    });
  }
  insertAvailability(state: AvailabilityState): Promise<InsertResult> {
    return settle(() => {
      if (this.availability.has(state.operatorId)) return 'DUPLICATE';
      this.availability.set(state.operatorId, state);
      return 'CREATED';
    });
  }
  updateAvailability(state: AvailabilityState, expectedRevision: number): Promise<boolean> {
    return settle(() => {
      const current = this.availability.get(state.operatorId);
      if (!current || current.revision !== expectedRevision) return false;
      this.availability.set(state.operatorId, state);
      return true;
    });
  }
  appendEvent(entry: OutboxAppend): Promise<void> {
    return settle(() => {
      this.outbox.push(entry);
    });
  }
  appendAudit(entry: AuditAppend): Promise<void> {
    return settle(() => {
      this.audit.push(entry);
    });
  }
}

/** P05-C1 aggregates, copied per transaction like the other maps. */
export class ProfileTables {
  readonly areas = new Map<string, ServiceAreaState>();
  readonly schedules = new Map<string, WeeklyScheduleState>();
  readonly exceptions = new Map<string, AvailabilityExceptionState>();
  readonly equipment = new Map<string, EquipmentState>();

  copy(): ProfileTables {
    const next = new ProfileTables();
    for (const [k, v] of this.areas) next.areas.set(k, v);
    for (const [k, v] of this.schedules) next.schedules.set(k, v);
    for (const [k, v] of this.exceptions) next.exceptions.set(k, v);
    for (const [k, v] of this.equipment) next.equipment.set(k, v);
    return next;
  }

  adopt(source: ProfileTables): void {
    for (const key of ['areas', 'schedules', 'exceptions', 'equipment'] as const) {
      const target: Map<string, unknown> = this[key];
      target.clear();
      for (const [k, v] of source[key]) target.set(k, v);
    }
  }

  exceptionsOf(
    operatorId: string,
    from: Date,
    to: Date,
    activeOnly: boolean,
  ): AvailabilityExceptionState[] {
    return [...this.exceptions.values()]
      .filter(
        (e) =>
          e.operatorId === operatorId &&
          (!activeOnly || e.status === 'ACTIVE') &&
          overlaps(e, { startsAt: from, endsAt: to }),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  equipmentOf(operatorId: string): EquipmentState[] {
    return [...this.equipment.values()]
      .filter((e) => e.operatorId === operatorId)
      .sort((a, b) => (a.kind < b.kind ? -1 : 1));
  }
}
