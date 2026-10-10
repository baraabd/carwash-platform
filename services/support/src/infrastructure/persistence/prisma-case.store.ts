import {
  CASE_ACTIONS,
  CASE_KINDS,
  CASE_STATUSES,
  DECISION_STATUSES,
  EVIDENCE_KINDS,
  OWNER_OPERATIONS,
  REASON_CODES,
  SUBJECT_TYPES,
  TERMINAL_STATUSES,
  type CaseStatus,
  type DecisionStatus,
  type Evidence,
} from '../../domain';
import {
  CaseConflict,
  type CaseDetail,
  type CaseEventRecord,
  type CaseListFilter,
  type CaseReader,
  type CaseRecord,
  type CaseStore,
  type CaseUnitOfWork,
  type DecisionRecord,
  type OutboxEvent,
  type OwnerRequest,
  type SubjectSnapshot,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;
type CaseRow = Prisma.SupportCaseGetPayload<object>;
type DecisionRow = Prisma.ResolutionRequestGetPayload<object>;
type EventRow = Prisma.CaseEventGetPayload<object>;

const IN_FLIGHT: readonly DecisionStatus[] = [
  'AWAITING_APPROVAL',
  'EXECUTING',
  'OUTCOME_UNKNOWN',
  'BLOCKED_ON_OWNER',
];

function member<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`CORRUPT_ROW_${value}`);
  return found;
}

function activeSlot(status: CaseStatus): number | null {
  return TERMINAL_STATUSES.includes(status) ? null : 1;
}

function inflightSlot(status: DecisionStatus): number | null {
  return IN_FLIGHT.includes(status) ? 1 : null;
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const text = JSON.stringify(error.meta ?? {}) + error.message;
    if (text.includes('support_case_active_subject_key') || text.includes('active_slot'))
      throw new CaseConflict('ACTIVE_SUBJECT');
    if (text.includes('support_case_open_key_key') || text.includes('open_key'))
      throw new CaseConflict('OPEN_KEY');
    throw new CaseConflict('DECISION');
  }
  throw error;
}

function toCase(row: CaseRow): CaseRecord {
  const snapshot = row.snapshot as unknown as SubjectSnapshot;
  return {
    id: row.id,
    kind: member(row.kind, CASE_KINDS),
    status: member(row.status, CASE_STATUSES),
    subject: {
      type: member(row.subjectType, SUBJECT_TYPES),
      id: row.subjectId,
      parentId: row.subjectParentId,
    },
    summary: row.summary,
    snapshot,
    openedBy: row.openedBy,
    openedAt: row.openedAt,
    revision: row.revision,
    updatedAt: row.updatedAt,
    openKey: row.openKey,
    openFingerprint: row.openFingerprint,
  };
}

function toEvidence(value: Prisma.JsonValue): readonly Evidence[] {
  if (!Array.isArray(value)) throw new Error('CORRUPT_EVIDENCE');
  return value.map((item) => {
    const record = item as { kind?: string; reference?: string };
    if (typeof record.kind !== 'string' || typeof record.reference !== 'string')
      throw new Error('CORRUPT_EVIDENCE');
    return { kind: member(record.kind, EVIDENCE_KINDS), reference: record.reference };
  });
}

function toDecision(row: DecisionRow): DecisionRecord {
  const ownerRequest: OwnerRequest | null =
    row.ownerOperation && row.ownerTargetId && row.ownerKey && row.ownerBody
      ? {
          operation: member(row.ownerOperation, OWNER_OPERATIONS),
          targetId: row.ownerTargetId,
          key: row.ownerKey,
          body: row.ownerBody as Readonly<Record<string, unknown>>,
        }
      : null;
  return {
    caseId: row.caseId,
    decisionNo: row.decisionNo,
    action: member(row.action, CASE_ACTIONS),
    reasonCode: member(row.reasonCode, REASON_CODES),
    reasonNote: row.reasonNote,
    evidence: toEvidence(row.evidence),
    amount:
      row.amountCurrency !== null && row.amountMinor !== null && row.amountScale !== null
        ? {
            currency: row.amountCurrency,
            // Decimal(20,0) to its exact integer text; never through a float.
            amountMinor: row.amountMinor.toFixed(0),
            scale: row.amountScale,
          }
        : null,
    window:
      row.windowStartsAt && row.windowEndsAt
        ? { startsAt: row.windowStartsAt.toISOString(), endsAt: row.windowEndsAt.toISOString() }
        : null,
    status: member(row.status, DECISION_STATUSES),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    idempotencyKey: row.idempotencyKey,
    fingerprint: row.fingerprint,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    approvalNote: row.approvalNote,
    approvalKey: row.approvalKey,
    ownerRequest,
    ownerHttpStatus: row.ownerHttpStatus,
    ownerCode: row.ownerCode,
    ownerState: row.ownerState,
    executionAttempts: row.executionAttempts,
    executionFence: row.executionFence,
    lastExecutedAt: row.lastExecutedAt,
  };
}

function toEvent(row: EventRow): CaseEventRecord {
  return {
    id: row.id,
    caseId: row.caseId,
    occurredAt: row.occurredAt,
    actorSubject: row.actorSubject,
    action: row.action,
    decisionNo: row.decisionNo,
    fromStatus: row.fromStatus === null ? null : member(row.fromStatus, CASE_STATUSES),
    toStatus: member(row.toStatus, CASE_STATUSES),
    outcome: row.outcome,
    correlationId: row.correlationId,
  };
}

async function decisionsOf(db: Db, caseId: string): Promise<readonly DecisionRecord[]> {
  const rows = await db.resolutionRequest.findMany({
    where: { caseId },
    orderBy: { decisionNo: 'asc' },
  });
  return rows.map(toDecision);
}

class PrismaCaseUnitOfWork implements CaseUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async lockCase(id: string): Promise<CaseRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.support_case WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.supportCase.findUnique({ where: { id } });
    return row ? toCase(row) : null;
  }

  async caseByOpenKey(actor: string, key: string): Promise<CaseRecord | null> {
    const row = await this.tx.supportCase.findUnique({
      where: { openedBy_openKey: { openedBy: actor, openKey: key } },
    });
    return row ? toCase(row) : null;
  }

  async activeCaseFor(kind: CaseRecord['kind'], subject: CaseRecord['subject']) {
    const row = await this.tx.supportCase.findFirst({
      where: { kind, subjectType: subject.type, subjectId: subject.id, activeSlot: 1 },
    });
    return row ? toCase(row) : null;
  }

  async insertCase(record: CaseRecord): Promise<void> {
    try {
      await this.tx.supportCase.create({
        data: {
          id: record.id,
          kind: record.kind,
          status: record.status,
          subjectType: record.subject.type,
          subjectId: record.subject.id,
          subjectParentId: record.subject.parentId,
          summary: record.summary,
          snapshot: record.snapshot as unknown as Prisma.InputJsonObject,
          openedBy: record.openedBy,
          openedAt: record.openedAt,
          revision: record.revision,
          updatedAt: record.updatedAt,
          openKey: record.openKey,
          openFingerprint: record.openFingerprint,
          activeSlot: activeSlot(record.status),
        },
      });
    } catch (error) {
      conflict(error);
    }
  }

  async updateCase(
    id: string,
    expectedRevision: number,
    patch: { readonly status: CaseStatus; readonly updatedAt: Date },
  ): Promise<boolean> {
    const result = await this.tx.supportCase.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        status: patch.status,
        updatedAt: patch.updatedAt,
        revision: expectedRevision + 1,
        activeSlot: activeSlot(patch.status),
      },
    });
    return result.count === 1;
  }

  decisions(caseId: string): Promise<readonly DecisionRecord[]> {
    return decisionsOf(this.tx, caseId);
  }

  async decisionByKey(caseId: string, actor: string, key: string) {
    const row = await this.tx.resolutionRequest.findUnique({
      where: {
        caseId_decidedBy_idempotencyKey: { caseId, decidedBy: actor, idempotencyKey: key },
      },
    });
    return row ? toDecision(row) : null;
  }

  async insertDecision(record: DecisionRecord): Promise<void> {
    try {
      await this.tx.resolutionRequest.create({
        data: {
          caseId: record.caseId,
          decisionNo: record.decisionNo,
          action: record.action,
          reasonCode: record.reasonCode,
          reasonNote: record.reasonNote,
          evidence: record.evidence.map((e) => ({ kind: e.kind, reference: e.reference })),
          amountCurrency: record.amount?.currency ?? null,
          amountMinor: record.amount ? new Prisma.Decimal(record.amount.amountMinor) : null,
          amountScale: record.amount?.scale ?? null,
          windowStartsAt: record.window ? new Date(record.window.startsAt) : null,
          windowEndsAt: record.window ? new Date(record.window.endsAt) : null,
          status: record.status,
          decidedBy: record.decidedBy,
          decidedAt: record.decidedAt,
          idempotencyKey: record.idempotencyKey,
          fingerprint: record.fingerprint,
          ...ownerColumns(record.ownerRequest),
          executionAttempts: record.executionAttempts,
          executionFence: record.executionFence,
          lastExecutedAt: record.lastExecutedAt,
          inflightSlot: inflightSlot(record.status),
        },
      });
    } catch (error) {
      conflict(error);
    }
  }

  async updateDecision(
    caseId: string,
    decisionNo: number,
    expectedFence: number,
    patch: Parameters<CaseUnitOfWork['updateDecision']>[3],
  ): Promise<boolean> {
    const result = await this.tx.resolutionRequest.updateMany({
      where: { caseId, decisionNo, executionFence: expectedFence },
      data: {
        ...(patch.status !== undefined
          ? { status: patch.status, inflightSlot: inflightSlot(patch.status) }
          : {}),
        ...(patch.approvedBy !== undefined ? { approvedBy: patch.approvedBy } : {}),
        ...(patch.approvedAt !== undefined ? { approvedAt: patch.approvedAt } : {}),
        ...(patch.approvalNote !== undefined ? { approvalNote: patch.approvalNote } : {}),
        ...(patch.approvalKey !== undefined ? { approvalKey: patch.approvalKey } : {}),
        ...(patch.ownerRequest !== undefined ? ownerColumns(patch.ownerRequest) : {}),
        ...(patch.ownerHttpStatus !== undefined ? { ownerHttpStatus: patch.ownerHttpStatus } : {}),
        ...(patch.ownerCode !== undefined ? { ownerCode: patch.ownerCode } : {}),
        ...(patch.ownerState !== undefined ? { ownerState: patch.ownerState } : {}),
        ...(patch.executionAttempts !== undefined
          ? { executionAttempts: patch.executionAttempts }
          : {}),
        ...(patch.executionFence !== undefined ? { executionFence: patch.executionFence } : {}),
        ...(patch.lastExecutedAt !== undefined ? { lastExecutedAt: patch.lastExecutedAt } : {}),
      },
    });
    return result.count === 1;
  }

  async appendEvent(event: CaseEventRecord): Promise<void> {
    await this.tx.caseEvent.create({ data: { ...event } });
  }

  async enqueue(event: OutboxEvent): Promise<void> {
    await this.tx.outboxMessage.create({
      data: {
        id: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
      },
    });
  }
}

function ownerColumns(request: OwnerRequest | null) {
  return request
    ? {
        ownerOperation: request.operation,
        ownerTargetId: request.targetId,
        ownerKey: request.key,
        ownerBody: request.body as Prisma.InputJsonObject,
      }
    : {
        ownerOperation: null,
        ownerTargetId: null,
        ownerKey: null,
        ownerBody: Prisma.DbNull,
      };
}

export class PrismaCaseStore implements CaseStore, CaseReader {
  constructor(private readonly client: PrismaClient) {}

  transaction<T>(work: (uow: CaseUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new PrismaCaseUnitOfWork(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async list(filter: CaseListFilter): Promise<readonly CaseRecord[]> {
    if (filter.kinds.length === 0) return [];
    const rows = await this.client.supportCase.findMany({
      where: {
        kind: { in: [...filter.kinds] },
        ...(filter.statuses ? { status: { in: [...filter.statuses] } } : {}),
        ...(filter.subject
          ? { subjectType: filter.subject.type, subjectId: filter.subject.id }
          : {}),
        ...(filter.cursor
          ? {
              OR: [
                { openedAt: { gt: filter.cursor.openedAt } },
                { openedAt: filter.cursor.openedAt, id: { gt: filter.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      take: filter.limit,
    });
    return rows.map(toCase);
  }

  async detail(id: string): Promise<CaseDetail | null> {
    // One snapshot: the case, its decisions and its audit agree with each other.
    return this.client.$transaction(
      async (tx) => {
        const row = await tx.supportCase.findUnique({ where: { id } });
        if (!row) return null;
        const events = await tx.caseEvent.findMany({
          where: { caseId: id },
          orderBy: { seq: 'asc' },
        });
        return {
          record: toCase(row),
          decisions: await decisionsOf(tx, id),
          events: events.map(toEvent),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
