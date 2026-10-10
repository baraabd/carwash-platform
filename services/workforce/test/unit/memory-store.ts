import type {
  AvailabilityState,
  CapacityCandidate,
  OperatorState,
  ShiftState,
  VerificationCaseState,
} from '../../src/domain';
import type {
  AuditAppend,
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
    const outbox: OutboxAppend[] = [];
    const audit: AuditAppend[] = [];
    const tx = new MemoryTransaction(operators, skills, availability, cases, outbox, audit);
    const result = await work(tx);
    this.replace(this.operators, operators);
    this.replace(this.skills, skills);
    this.replace(this.availability, availability);
    this.replace(this.cases, cases);
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
  listShifts(): Promise<ShiftState[]> {
    return settle(() => {
      return [];
    });
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
  lockShift(): Promise<ShiftState | null> {
    return settle(() => {
      return null;
    });
  }
  findShiftByIdempotency(): Promise<ShiftState | null> {
    return settle(() => {
      return null;
    });
  }
  insertShift(): Promise<InsertShiftResult> {
    return settle(() => {
      return 'CREATED';
    });
  }
  updateShift(): Promise<void> {
    return Promise.resolve();
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
