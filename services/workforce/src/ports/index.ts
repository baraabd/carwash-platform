/**
 * Workforce ports: what the application needs from the outside world.
 *
 * Framework-free. Adapters live in infrastructure/ and transport/.
 */
import type {
  OperatorState,
  ShiftState,
  VerificationCaseState,
  WorkforceEvent,
} from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export const WORKFORCE_SCOPES = [
  'workforce.operator.read',
  'workforce.eligibility.read',
] as const;
export type WorkforceScope = (typeof WORKFORCE_SCOPES)[number];

export type Actor =
  | {
      readonly kind: 'USER';
      readonly subject: string;
      readonly permissions: readonly string[];
    }
  | {
      readonly kind: 'SERVICE';
      readonly clientId: string;
      readonly scopes: readonly WorkforceScope[];
    }
  | { readonly kind: 'SYSTEM'; readonly component: string };

export interface RequestMeta {
  readonly actor: Actor;
  readonly correlationId: string;
}

export interface OutboxAppend {
  readonly event: WorkforceEvent;
  readonly exchange: string;
  readonly routingKey: string;
}

export interface AuditAppend {
  readonly action: string;
  readonly actor: Actor;
  readonly targetType: 'OPERATOR' | 'VERIFICATION_CASE' | 'WORK_GRANT' | 'WORK_SHIFT';
  readonly targetId: string;
  readonly correlationId: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export type InsertResult = 'CREATED' | 'DUPLICATE';
export type InsertShiftResult = 'CREATED' | 'DUPLICATE_IDEMPOTENCY_KEY' | 'OVERLAPS';

export interface WorkforceTransaction {
  lockOperator(id: string): Promise<OperatorState | null>;
  lockOperatorBySubject(subject: string): Promise<OperatorState | null>;
  insertOperator(operator: OperatorState): Promise<InsertResult>;
  updateOperator(operator: OperatorState, expectedVersion: number): Promise<void>;

  listSkills(operatorId: string): Promise<string[]>;
  insertSkill(input: {
    readonly id: string;
    readonly operatorId: string;
    readonly skillCode: string;
    readonly grantedBy: string;
    readonly grantedAt: Date;
  }): Promise<InsertResult>;
  removeSkill(operatorId: string, skillCode: string): Promise<boolean>;

  lockVerificationCase(id: string): Promise<VerificationCaseState | null>;
  findPendingCase(operatorId: string): Promise<VerificationCaseState | null>;
  findCaseByIdempotency(requester: string, key: string): Promise<VerificationCaseState | null>;
  insertVerificationCase(state: VerificationCaseState): Promise<InsertResult>;
  updateVerificationCase(
    state: VerificationCaseState,
    expectedVersion: number,
  ): Promise<void>;

  lockShift(id: string): Promise<ShiftState | null>;
  findShiftByIdempotency(requester: string, key: string): Promise<ShiftState | null>;
  insertShift(state: ShiftState): Promise<InsertShiftResult>;
  updateShift(state: ShiftState, expectedVersion: number): Promise<void>;

  appendEvent(entry: OutboxAppend): Promise<void>;
  appendAudit(entry: AuditAppend): Promise<void>;
}

export interface WorkforceUnitOfWork {
  run<T>(work: (tx: WorkforceTransaction) => Promise<T>): Promise<T>;
}

export interface WorkforceReadModel {
  findOperator(id: string): Promise<OperatorState | null>;
  findOperatorBySubject(subject: string): Promise<OperatorState | null>;
  listSkills(operatorId: string): Promise<string[]>;
  findVerificationCase(id: string): Promise<VerificationCaseState | null>;
  listShifts(operatorId: string, from: Date, to: Date): Promise<ShiftState[]>;
  eligibleOperators(input: {
    readonly zoneId: string;
    readonly at: Date;
    readonly skillCode?: string;
  }): Promise<
    Array<{
      readonly operator: OperatorState;
      readonly skillCodes: readonly string[];
    }>
  >;
}
