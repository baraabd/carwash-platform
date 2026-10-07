import { randomUUID } from 'node:crypto';
import { traceHeaders } from '@carwash/service-kit';
import type {
  DecisionReason,
  EmploymentStatus,
  OperatorState,
  ShiftState,
  ShiftStatus,
  SuspensionReason,
  VerificationCaseState,
  VerificationCaseStatus,
  VerificationStatus,
} from '../../domain';
import type {
  Actor,
  AuditAppend,
  InsertResult,
  InsertShiftResult,
  OutboxAppend,
  WorkforceReadModel,
  WorkforceTransaction,
  WorkforceUnitOfWork,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

interface OperatorRow {
  id: string;
  identity_subject: string;
  display_name: string;
  home_zone_id: string;
  employment_status: string;
  suspension_reason: string | null;
  verification_status: string;
  verified_until: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface CaseRow {
  id: string;
  operator_id: string;
  status: string;
  evidence_refs: string[];
  submitted_by: string;
  submitted_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  valid_until: Date | null;
  requester: string;
  idempotency_key: string;
  request_fingerprint: string;
  version: number;
}
interface ShiftRow {
  id: string;
  operator_id: string;
  zone_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  requester: string;
  idempotency_key: string;
  request_fingerprint: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const OPERATOR_COLUMNS = `id::text, identity_subject::text, display_name, home_zone_id::text,
 employment_status, suspension_reason, verification_status, verified_until, version, created_at, updated_at`;
const CASE_COLUMNS = `id::text, operator_id::text, status, evidence_refs::text[], submitted_by::text,
 submitted_at, decided_by::text, decided_at, decision_reason, valid_until, requester,
 idempotency_key, request_fingerprint, version`;
const SHIFT_COLUMNS = `id::text, operator_id::text, zone_id::text, starts_at, ends_at, status,
 requester, idempotency_key, request_fingerprint, version, created_at, updated_at`;

export class ConcurrencyViolation extends Error {
  constructor(what: string) {
    super(`${what}_VERSION_MISMATCH`);
    this.name = 'ConcurrencyViolation';
  }
}

export function sqlState(error: unknown): string | undefined {
  const cause = (
    error as {
      meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
    }
  ).meta?.driverAdapterError?.cause;
  const code = cause?.code ?? cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}
export function isTransientConflict(error: unknown): boolean {
  const state = sqlState(error);
  return state === '40P01' || state === '40001';
}

function toOperator(row: OperatorRow): OperatorState {
  return {
    id: row.id,
    identitySubject: row.identity_subject,
    displayName: row.display_name,
    homeZoneId: row.home_zone_id,
    employmentStatus: row.employment_status as EmploymentStatus,
    suspensionReason: row.suspension_reason as SuspensionReason | null,
    verificationStatus: row.verification_status as VerificationStatus,
    verifiedUntil: row.verified_until,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function toCase(row: CaseRow): VerificationCaseState {
  return {
    id: row.id,
    operatorId: row.operator_id,
    status: row.status as VerificationCaseStatus,
    evidenceRefs: row.evidence_refs,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason as DecisionReason | null,
    validUntil: row.valid_until,
    requester: row.requester,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    version: row.version,
  };
}
function toShift(row: ShiftRow): ShiftState {
  return {
    id: row.id,
    operatorId: row.operator_id,
    zoneId: row.zone_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as ShiftStatus,
    requester: row.requester,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function actorId(actor: Actor): string {
  if (actor.kind === 'USER') return actor.subject;
  if (actor.kind === 'SERVICE') return actor.clientId;
  return actor.component;
}

class PrismaWorkforceTransaction implements WorkforceTransaction {
  constructor(private readonly tx: Tx) {}

  async lockOperator(id: string): Promise<OperatorState | null> {
    const [row] = await this.tx.$queryRawUnsafe<OperatorRow[]>(
      `SELECT ${OPERATOR_COLUMNS} FROM app.operator WHERE id = $1::uuid FOR UPDATE`,
      id,
    );
    return row ? toOperator(row) : null;
  }

  async lockOperatorBySubject(subject: string): Promise<OperatorState | null> {
    const [row] = await this.tx.$queryRawUnsafe<OperatorRow[]>(
      `SELECT ${OPERATOR_COLUMNS} FROM app.operator WHERE identity_subject = $1::uuid FOR UPDATE`,
      subject,
    );
    return row ? toOperator(row) : null;
  }

  async insertOperator(operator: OperatorState): Promise<InsertResult> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO app.operator
        (id, identity_subject, display_name, home_zone_id, employment_status, suspension_reason,
         verification_status, verified_until, version, created_at, updated_at)
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (identity_subject) DO NOTHING RETURNING id::text`,
      operator.id,
      operator.identitySubject,
      operator.displayName,
      operator.homeZoneId,
      operator.employmentStatus,
      operator.suspensionReason,
      operator.verificationStatus,
      operator.verifiedUntil,
      operator.version,
      operator.createdAt,
      operator.updatedAt,
    );
    return rows.length === 1 ? 'CREATED' : 'DUPLICATE';
  }

  async updateOperator(operator: OperatorState, expectedVersion: number): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.operator SET display_name=$3, home_zone_id=$4::uuid, employment_status=$5,
       suspension_reason=$6, verification_status=$7, verified_until=$8, version=$9, updated_at=$10
       WHERE id=$1::uuid AND version=$2 RETURNING id::text`,
      operator.id,
      expectedVersion,
      operator.displayName,
      operator.homeZoneId,
      operator.employmentStatus,
      operator.suspensionReason,
      operator.verificationStatus,
      operator.verifiedUntil,
      operator.version,
      operator.updatedAt,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('OPERATOR');
  }

  async listSkills(operatorId: string): Promise<string[]> {
    const rows = await this.tx.$queryRawUnsafe<{ skill_code: string }[]>(
      `SELECT skill_code FROM app.work_grant WHERE operator_id=$1::uuid ORDER BY skill_code`,
      operatorId,
    );
    return rows.map((row) => row.skill_code);
  }

  async insertSkill(input: {
    readonly id: string;
    readonly operatorId: string;
    readonly skillCode: string;
    readonly grantedBy: string;
    readonly grantedAt: Date;
  }): Promise<InsertResult> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO app.work_grant (id,operator_id,skill_code,granted_by,granted_at)
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5)
       ON CONFLICT (operator_id,skill_code) DO NOTHING RETURNING id::text`,
      input.id,
      input.operatorId,
      input.skillCode,
      input.grantedBy,
      input.grantedAt,
    );
    return rows.length === 1 ? 'CREATED' : 'DUPLICATE';
  }

  async removeSkill(operatorId: string, skillCode: string): Promise<boolean> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `DELETE FROM app.work_grant WHERE operator_id=$1::uuid AND skill_code=$2 RETURNING id::text`,
      operatorId,
      skillCode,
    );
    return rows.length === 1;
  }

  async lockVerificationCase(id: string): Promise<VerificationCaseState | null> {
    const [row] = await this.tx.$queryRawUnsafe<CaseRow[]>(
      `SELECT ${CASE_COLUMNS} FROM app.verification_case WHERE id=$1::uuid FOR UPDATE`,
      id,
    );
    return row ? toCase(row) : null;
  }

  async findPendingCase(operatorId: string): Promise<VerificationCaseState | null> {
    const [row] = await this.tx.$queryRawUnsafe<CaseRow[]>(
      `SELECT ${CASE_COLUMNS} FROM app.verification_case
       WHERE pending_operator_id=$1::uuid LIMIT 1`,
      operatorId,
    );
    return row ? toCase(row) : null;
  }

  async findCaseByIdempotency(
    requester: string,
    key: string,
  ): Promise<VerificationCaseState | null> {
    const [row] = await this.tx.$queryRawUnsafe<CaseRow[]>(
      `SELECT ${CASE_COLUMNS} FROM app.verification_case
       WHERE requester=$1 AND idempotency_key=$2 LIMIT 1`,
      requester,
      key,
    );
    return row ? toCase(row) : null;
  }

  async insertVerificationCase(state: VerificationCaseState): Promise<InsertResult> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO app.verification_case
       (id,operator_id,pending_operator_id,status,evidence_refs,submitted_by,submitted_at,
        decided_by,decided_at,decision_reason,valid_until,requester,idempotency_key,
        request_fingerprint,version)
       VALUES ($1::uuid,$2::uuid,$2::uuid,$3,$4::uuid[],$5::uuid,$6,$7::uuid,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING RETURNING id::text`,
      state.id,
      state.operatorId,
      state.status,
      state.evidenceRefs,
      state.submittedBy,
      state.submittedAt,
      state.decidedBy,
      state.decidedAt,
      state.decisionReason,
      state.validUntil,
      state.requester,
      state.idempotencyKey,
      state.requestFingerprint,
      state.version,
    );
    return rows.length === 1 ? 'CREATED' : 'DUPLICATE';
  }

  async updateVerificationCase(
    state: VerificationCaseState,
    expectedVersion: number,
  ): Promise<void> {
    const pending = state.status === 'PENDING_REVIEW' ? state.operatorId : null;
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.verification_case SET pending_operator_id=$3::uuid,status=$4,evidence_refs=$5::uuid[],
       decided_by=$6::uuid,decided_at=$7,decision_reason=$8,valid_until=$9,version=$10
       WHERE id=$1::uuid AND version=$2 RETURNING id::text`,
      state.id,
      expectedVersion,
      pending,
      state.status,
      state.evidenceRefs,
      state.decidedBy,
      state.decidedAt,
      state.decisionReason,
      state.validUntil,
      state.version,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('VERIFICATION_CASE');
  }

  async lockShift(id: string): Promise<ShiftState | null> {
    const [row] = await this.tx.$queryRawUnsafe<ShiftRow[]>(
      `SELECT ${SHIFT_COLUMNS} FROM app.work_shift WHERE id=$1::uuid FOR UPDATE`,
      id,
    );
    return row ? toShift(row) : null;
  }

  async findShiftByIdempotency(requester: string, key: string): Promise<ShiftState | null> {
    const [row] = await this.tx.$queryRawUnsafe<ShiftRow[]>(
      `SELECT ${SHIFT_COLUMNS} FROM app.work_shift
       WHERE requester=$1 AND idempotency_key=$2 LIMIT 1`,
      requester,
      key,
    );
    return row ? toShift(row) : null;
  }

  async insertShift(state: ShiftState): Promise<InsertShiftResult> {
    await this.tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended('workforce.shift:' || $1::text,0))`,
      state.operatorId,
    );
    const replay = await this.findShiftByIdempotency(state.requester, state.idempotencyKey);
    if (replay) return 'DUPLICATE_IDEMPOTENCY_KEY';
    await this.tx.$executeRawUnsafe('SAVEPOINT insert_shift');
    try {
      const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO app.work_shift
         (id,operator_id,zone_id,starts_at,ends_at,status,requester,idempotency_key,
          request_fingerprint,version,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id::text`,
        state.id,
        state.operatorId,
        state.zoneId,
        state.startsAt,
        state.endsAt,
        state.status,
        state.requester,
        state.idempotencyKey,
        state.requestFingerprint,
        state.version,
        state.createdAt,
        state.updatedAt,
      );
      await this.tx.$executeRawUnsafe('RELEASE SAVEPOINT insert_shift');
      return rows.length === 1 ? 'CREATED' : 'DUPLICATE_IDEMPOTENCY_KEY';
    } catch (error) {
      if (sqlState(error) !== '23P01') throw error;
      await this.tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT insert_shift');
      return 'OVERLAPS';
    }
  }

  async updateShift(state: ShiftState, expectedVersion: number): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.work_shift SET status=$3,version=$4,updated_at=$5
       WHERE id=$1::uuid AND version=$2 RETURNING id::text`,
      state.id,
      expectedVersion,
      state.status,
      state.version,
      state.updatedAt,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('SHIFT');
  }

  async appendEvent(entry: OutboxAppend): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.outbox_message
       (id,event_id,event_type,exchange,routing_key,payload,correlation_id,trace_parent)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8)`,
      randomUUID(),
      entry.event.eventId,
      entry.event.eventType,
      entry.exchange,
      entry.routingKey,
      JSON.stringify(entry.event),
      entry.event.correlationId,
      traceHeaders()['traceparent'] ?? null,
    );
  }

  async appendAudit(entry: AuditAppend): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.audit_entry
       (id,actor_kind,actor_id,action,target_type,target_id,correlation_id,details)
       VALUES ($1::uuid,$2,$3,$4,$5,$6::uuid,$7::uuid,$8::jsonb)`,
      randomUUID(),
      entry.actor.kind,
      actorId(entry.actor),
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.correlationId,
      JSON.stringify(entry.details),
    );
  }
}

export class PrismaWorkforceStore implements WorkforceUnitOfWork, WorkforceReadModel {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: {
      readonly transactionTimeoutMs?: number;
      readonly maxWaitMs?: number;
      readonly conflictAttempts?: number;
    } = {},
  ) {}

  async run<T>(work: (tx: WorkforceTransaction) => Promise<T>): Promise<T> {
    const attempts = this.options.conflictAttempts ?? 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(
          (tx) => work(new PrismaWorkforceTransaction(tx)),
          {
            isolationLevel: 'ReadCommitted',
            maxWait: this.options.maxWaitMs ?? 5_000,
            timeout: this.options.transactionTimeoutMs ?? 10_000,
          },
        );
      } catch (error) {
        if (!isTransientConflict(error) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
      }
    }
  }

  async findOperator(id: string): Promise<OperatorState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<OperatorRow[]>(
      `SELECT ${OPERATOR_COLUMNS} FROM app.operator WHERE id=$1::uuid`,
      id,
    );
    return row ? toOperator(row) : null;
  }

  async findOperatorBySubject(subject: string): Promise<OperatorState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<OperatorRow[]>(
      `SELECT ${OPERATOR_COLUMNS} FROM app.operator WHERE identity_subject=$1::uuid`,
      subject,
    );
    return row ? toOperator(row) : null;
  }

  async listSkills(operatorId: string): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ skill_code: string }[]>(
      `SELECT skill_code FROM app.work_grant WHERE operator_id=$1::uuid ORDER BY skill_code`,
      operatorId,
    );
    return rows.map((row) => row.skill_code);
  }

  async findVerificationCase(id: string): Promise<VerificationCaseState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<CaseRow[]>(
      `SELECT ${CASE_COLUMNS} FROM app.verification_case WHERE id=$1::uuid`,
      id,
    );
    return row ? toCase(row) : null;
  }

  async listShifts(operatorId: string, from: Date, to: Date): Promise<ShiftState[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<ShiftRow[]>(
      `SELECT ${SHIFT_COLUMNS} FROM app.work_shift
       WHERE operator_id=$1::uuid AND ends_at>$2 AND starts_at<$3
       ORDER BY starts_at LIMIT 500`,
      operatorId,
      from,
      to,
    );
    return rows.map(toShift);
  }

  async eligibleOperators(input: {
    readonly zoneId: string;
    readonly at: Date;
    readonly skillCode?: string;
  }): Promise<Array<{ readonly operator: OperatorState; readonly skillCodes: readonly string[] }>> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<OperatorRow & { skill_codes: string[] }>
    >(
      `SELECT o.id::text,o.identity_subject::text,o.display_name,o.home_zone_id::text,
        o.employment_status,o.suspension_reason,o.verification_status,o.verified_until,
        o.version,o.created_at,o.updated_at,
        COALESCE(array_agg(g.skill_code ORDER BY g.skill_code)
          FILTER (WHERE g.skill_code IS NOT NULL), ARRAY[]::text[]) AS skill_codes
       FROM app.operator o
       JOIN app.work_shift s ON s.operator_id=o.id
        AND s.status='ACTIVE' AND s.zone_id=$1::uuid AND s.starts_at <= $2 AND s.ends_at > $2
       LEFT JOIN app.work_grant g ON g.operator_id=o.id
       GROUP BY o.id
       HAVING ($3::text IS NULL OR bool_or(g.skill_code=$3))
       ORDER BY o.id LIMIT 500`,
      input.zoneId,
      input.at,
      input.skillCode ?? null,
    );
    return rows.map((row) => ({ operator: toOperator(row), skillCodes: row.skill_codes }));
  }
}
