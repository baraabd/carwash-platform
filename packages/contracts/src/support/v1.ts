import type { OwnerContract } from '../common/route';
import { parseNonNegativeMoney, type Money } from '../common/money';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  closed,
  integer,
  list,
  oneOf,
  record,
  text,
  uuid,
} from '../common/wire';

/**
 * support.v1 — owner: Support service (Lane D). Staff exception cases
 * (payment review, refund, late payment, booking cancellation/reschedule).
 *
 * Published from Lane D request CR-D-P04-02/04 and conformed to the MERGED
 * provider (PR #126, P04-D1): tests/production/E/contracts-product.test.mjs runs
 * its controller and outbox functions from the exact source and parses them here.
 *
 * Owner rules (not expressible on the wire):
 *  - Support records reasons, evidence and decisions; it never writes money or
 *    booking state. An owner command (Billing/Booking) carries a decision out,
 *    on behalf of the deciding staff member, with a frozen per-decision key;
 *  - REFUND needs four eyes: a different `billing.refund` holder approves
 *    (SAME_PERSON_APPROVAL);
 *  - OUTCOME_UNKNOWN is not decidable: only a resend of the same frozen command
 *    may settle it. BLOCKED_ON_OWNER means the owner was never asked;
 *  - another desk's case is indistinguishable from a missing one (404).
 * Free text (summary, reason note, approval note) stays inside Support: never
 * in events, logs or URLs.
 *
 * Customer complaint intake is NOT in this major: no approved customer screen
 * or owner flow exists (DESIGN_LOCK §7). It is listed as pending, not inferred.
 */
const READ = 'permission:support.cases.read|billing.read|operations.dispatch';
const WRITE = 'permission:billing.reconcile|billing.refund|operations.dispatch';

export const SUPPORT_V1 = {
  id: 'support.v1',
  owner: 'support',
  prefix: '/internal/v1/support',
  routes: {
    listCases: { method: 'GET', path: '/cases', access: READ, paged: true },
    openCase: { method: 'POST', path: '/cases', access: WRITE, idempotent: true },
    getCase: { method: 'GET', path: '/cases/:caseId', access: READ },
    getCaseSubjectCurrent: { method: 'GET', path: '/cases/:caseId/current', access: READ },
    decideCase: {
      method: 'POST',
      path: '/cases/:caseId/decisions',
      access: WRITE,
      idempotent: true,
    },
    approveDecision: {
      method: 'POST',
      path: '/cases/:caseId/decisions/:decisionNo/approval',
      access: 'permission:billing.refund',
      idempotent: true,
    },
    /** Resends the decision's FROZEN owner command; the key only de-duplicates the resend. */
    resendDecision: {
      method: 'POST',
      path: '/cases/:caseId/decisions/:decisionNo/execution',
      access: WRITE,
      idempotent: true,
    },
  },
  reasons: [
    'CASE_ALREADY_OPEN',
    'CASE_CHANGED',
    'SUBJECT_NOT_ELIGIBLE',
    'SUBJECT_KIND_MISMATCH',
    'CASE_NOT_DECIDABLE',
    'CASE_NOT_AWAITING_APPROVAL',
    'SAME_PERSON_APPROVAL',
    'ACTION_NOT_ALLOWED_FOR_KIND',
    'REASON_NOT_ALLOWED_FOR_KIND',
    'REASON_NOTE_REQUIRED',
    'EVIDENCE_REQUIRED',
    'AMOUNT_REQUIRED',
    'WINDOW_REQUIRED',
    'NOTHING_TO_EXECUTE',
  ],
} as const satisfies OwnerContract;

export const CASE_KINDS = [
  'PAYMENT_REVIEW',
  'REFUND',
  'LATE_PAYMENT',
  'BOOKING_CANCELLATION',
  'BOOKING_RESCHEDULE',
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
export const CASE_STATUSES = [
  'OPEN',
  'AWAITING_APPROVAL',
  'EXECUTING',
  'OUTCOME_UNKNOWN',
  'BLOCKED_ON_OWNER',
  'OWNER_REJECTED',
  'RESOLVED',
  'CLOSED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const SUBJECT_TYPES = ['billing.payment-attempt', 'billing.obligation', 'booking'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const CASE_ACTIONS = [
  'APPROVE_MATCH',
  'REJECT_MISMATCH',
  'MARK_UNKNOWN',
  'ACCEPT_LATE_PAYMENT',
  'REFUND',
  'CANCEL_BOOKING',
  'RESCHEDULE_BOOKING',
  'DISMISS',
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];
export const OWNER_OPERATIONS = [
  'billing.reconcile',
  'billing.refund',
  'booking.cancel',
  'booking.reschedule',
] as const;
export type OwnerOperation = (typeof OWNER_OPERATIONS)[number];
export const DECISION_STATUSES = [
  'AWAITING_APPROVAL',
  'REJECTED_BY_APPROVER',
  'EXECUTING',
  'APPLIED',
  'OWNER_REJECTED',
  'OUTCOME_UNKNOWN',
  'BLOCKED_ON_OWNER',
  'NO_OWNER_ACTION',
  'SUPERSEDED',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const EVIDENCE_KINDS = [
  'PROVIDER_STATEMENT',
  'BANK_STATEMENT',
  'CUSTOMER_MESSAGE',
  'CALL_NOTE',
  'MEDIA_OBJECT',
  'OWNER_RECORD',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const CASE_REASON_CODES = [
  'PROVIDER_CONFIRMED',
  'PROVIDER_AMOUNT_DIFFERS',
  'PROVIDER_NO_RECORD',
  'PROVIDER_UNREACHABLE',
  'DUPLICATE_PAYMENT',
  'SERVICE_NOT_DELIVERED',
  'PAID_AFTER_CANCELLATION',
  'PAID_AFTER_DEADLINE',
  'CUSTOMER_REQUEST',
  'TECHNICIAN_UNAVAILABLE',
  'WEATHER_OR_SAFETY',
  'OPERATIONAL_ERROR',
  'ALREADY_HANDLED',
  'OTHER',
] as const;
export type CaseReasonCode = (typeof CASE_REASON_CODES)[number];

/** Which subject type each kind is opened on (provider KIND_POLICIES). */
export const CASE_KIND_SUBJECT: Readonly<Record<CaseKind, SubjectType>> = {
  PAYMENT_REVIEW: 'billing.payment-attempt',
  REFUND: 'billing.obligation',
  LATE_PAYMENT: 'billing.payment-attempt',
  BOOKING_CANCELLATION: 'booking',
  BOOKING_RESCHEDULE: 'booking',
};

const SUMMARY_MAX = 200;
const NOTE = { min: 10, max: 500 } as const;
export const MAX_CASE_EVIDENCE = 5;
const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$/;
const DECISION_NO = /^[1-9][0-9]{0,5}$/;
const COMMAND_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const OWNER_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_HISTORY = 200;

export interface CaseSubjectV1 {
  readonly type: SubjectType;
  readonly id: string;
  /** Payment-attempt subjects: the obligation the attempt belongs to; null otherwise. */
  readonly parentId: string | null;
}

function parseSubject(value: unknown, path: string, allowMissingParent: boolean): CaseSubjectV1 {
  const raw = record(value, path);
  const type = oneOf(raw.type, `${path}.type`, SUBJECT_TYPES);
  const attempt = type === 'billing.payment-attempt';
  const v = attempt
    ? closed(value, path, ['type', 'id', 'parentId'])
    : closed(value, path, ['type', 'id'], allowMissingParent ? [] : ['parentId']);
  const parentId = attempt ? uuid(v.parentId, `${path}.parentId`) : null;
  if (!attempt && v.parentId !== undefined && v.parentId !== null)
    throw new ContractViolation('UNEXPECTED_PARENT', `${path}.parentId`);
  return { type, id: uuid(v.id, `${path}.id`), parentId };
}

export interface EvidenceV1 {
  readonly kind: EvidenceKind;
  readonly reference: string;
}

function parseEvidence(value: unknown, path: string): EvidenceV1[] {
  const items = list(value, path, MAX_CASE_EVIDENCE, (item, at) => {
    const v = closed(item, at, ['kind', 'reference']);
    return {
      kind: oneOf(v.kind, `${at}.kind`, EVIDENCE_KINDS),
      reference: text(v.reference, `${at}.reference`, {
        min: 4,
        max: 120,
        pattern: EVIDENCE_REFERENCE,
      }),
    };
  });
  if (new Set(items.map((e) => `${e.kind}|${e.reference}`)).size !== items.length)
    throw new ContractViolation('DUPLICATE_EVIDENCE', path);
  return items;
}

export interface ServiceWindowV1 {
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
}

function parseWindow(value: unknown, path: string): ServiceWindowV1 {
  const v = closed(value, path, ['startsAt', 'endsAt']);
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  if (endsAt <= startsAt) throw new ContractViolation('INVALID_WINDOW', path);
  return { startsAt, endsAt };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface OpenCaseRequestV1 {
  readonly kind: CaseKind;
  readonly subject: CaseSubjectV1;
  readonly summary: string;
}

export function parseOpenCaseRequestV1(value: unknown): OpenCaseRequestV1 {
  const v = closed(value, '$', ['kind', 'subject', 'summary']);
  const kind = oneOf(v.kind, '$.kind', CASE_KINDS);
  const subject = parseSubject(v.subject, '$.subject', true);
  if (subject.type !== CASE_KIND_SUBJECT[kind])
    throw new ContractViolation('SUBJECT_KIND_MISMATCH', '$.subject.type');
  return { kind, subject, summary: text(v.summary, '$.summary', { min: 3, max: SUMMARY_MAX }) };
}

export interface DecideCaseRequestV1 {
  readonly action: CaseAction;
  readonly reason: { readonly code: CaseReasonCode; readonly note: string };
  readonly evidence?: readonly EvidenceV1[];
  readonly amount?: Money;
  readonly window?: ServiceWindowV1;
}

/** Per-kind action/reason/amount/window applicability is the owner's rule set. */
export function parseDecideCaseRequestV1(value: unknown): DecideCaseRequestV1 {
  const v = closed(value, '$', ['action', 'reason'], ['evidence', 'amount', 'window']);
  const reason = closed(v.reason, '$.reason', ['code', 'note']);
  return {
    action: oneOf(v.action, '$.action', CASE_ACTIONS),
    reason: {
      code: oneOf(reason.code, '$.reason.code', CASE_REASON_CODES),
      note: text(reason.note, '$.reason.note', NOTE),
    },
    ...(v.evidence === undefined ? {} : { evidence: parseEvidence(v.evidence, '$.evidence') }),
    ...(v.amount === undefined ? {} : { amount: parsePositiveMoney(v.amount, '$.amount') }),
    ...(v.window === undefined ? {} : { window: parseWindow(v.window, '$.window') }),
  };
}

export interface ApproveDecisionRequestV1 {
  readonly approve: boolean;
  readonly note: string;
}

export function parseApproveDecisionRequestV1(value: unknown): ApproveDecisionRequestV1 {
  const v = closed(value, '$', ['approve', 'note']);
  if (typeof v.approve !== 'boolean') throw new ContractViolation('EXPECTED_BOOLEAN', '$.approve');
  return { approve: v.approve, note: text(v.note, '$.note', NOTE) };
}

export function parseDecisionNo(value: unknown, path: string): number {
  if (typeof value === 'string' && DECISION_NO.test(value)) return Number(value);
  return integer(value, path, 1, 999_999);
}

function parsePositiveMoney(value: unknown, path: string): Money {
  const amount = parseNonNegativeMoney(value, path);
  if (amount.amountMinor === '0') throw new ContractViolation('ZERO_AMOUNT', path);
  return amount;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AuthorityV1 {
  readonly owner: string;
  readonly reads: string;
}

function parseAuthority(value: unknown, path: string): AuthorityV1[] {
  return list(value, path, 10, (item, at) => {
    const v = closed(item, at, ['owner', 'reads']);
    return {
      owner: text(v.owner, `${at}.owner`, { max: 32, pattern: /^[a-z][a-z-]{1,31}$/ }),
      reads: text(v.reads, `${at}.reads`, { max: 200 }),
    };
  });
}

export interface SubjectSnapshotV1 {
  readonly owner: 'billing' | 'booking';
  readonly readAt: UtcTimestamp;
  /** Flat owner facts captured when the case opened (ids, statuses, amounts as text). */
  readonly state: Readonly<Record<string, string | number | null>>;
}

function parseSnapshot(value: unknown, path: string): SubjectSnapshotV1 {
  const v = closed(value, path, ['owner', 'readAt', 'state']);
  const state = record(v.state, `${path}.state`);
  const entries = Object.entries(state);
  if (entries.length > 40) throw new ContractViolation('TOO_MANY_ITEMS', `${path}.state`);
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key))
      throw new ContractViolation('INVALID_FORMAT', `${path}.state.${key}`);
    if (item === null || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isSafeInteger(item))
        throw new ContractViolation('INVALID_INTEGER', `${path}.state.${key}`);
      continue;
    }
    text(item, `${path}.state.${key}`, { min: 0, max: 120 });
  }
  return {
    owner: oneOf(v.owner, `${path}.owner`, ['billing', 'booking'] as const),
    readAt: parseUtc(v.readAt, `${path}.readAt`),
    state: state as Readonly<Record<string, string | number | null>>,
  };
}

export interface CaseV1 {
  readonly caseId: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly subject: CaseSubjectV1;
  readonly summary: string;
  readonly snapshot: SubjectSnapshotV1;
  /** Staff Identity subject (staff-only view). */
  readonly openedBy: string;
  readonly openedAt: UtcTimestamp;
  readonly revision: number;
  readonly updatedAt: UtcTimestamp;
}

export function parseCaseV1(value: unknown, path = '$'): CaseV1 {
  const v = closed(value, path, [
    'caseId',
    'kind',
    'status',
    'subject',
    'summary',
    'snapshot',
    'openedBy',
    'openedAt',
    'revision',
    'updatedAt',
  ]);
  const kind = oneOf(v.kind, `${path}.kind`, CASE_KINDS);
  // The provider serialises a non-attempt subject with `parentId: null`.
  const subject = parseSubject(v.subject, `${path}.subject`, false);
  if (subject.type !== CASE_KIND_SUBJECT[kind])
    throw new ContractViolation('SUBJECT_KIND_MISMATCH', `${path}.subject.type`);
  const snapshot = parseSnapshot(v.snapshot, `${path}.snapshot`);
  if (snapshot.owner !== (subject.type === 'booking' ? 'booking' : 'billing'))
    throw new ContractViolation('SNAPSHOT_OWNER_MISMATCH', `${path}.snapshot.owner`);
  return {
    caseId: uuid(v.caseId, `${path}.caseId`),
    kind,
    status: oneOf(v.status, `${path}.status`, CASE_STATUSES),
    subject,
    summary: text(v.summary, `${path}.summary`, { min: 3, max: SUMMARY_MAX }),
    snapshot,
    openedBy: uuid(v.openedBy, `${path}.openedBy`),
    openedAt: parseUtc(v.openedAt, `${path}.openedAt`),
    revision: parseRevision(v.revision, `${path}.revision`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export interface DecisionOwnerV1 {
  readonly operation: OwnerOperation;
  readonly targetId: string;
  /** The frozen owner Idempotency-Key reused by every resend. */
  readonly commandKey: string;
  readonly httpStatus: number | null;
  readonly code: string | null;
  readonly state: string | null;
  readonly attempts: number;
  readonly lastSentAt: UtcTimestamp | null;
}

export interface DecisionV1 {
  readonly decisionNo: number;
  readonly action: CaseAction;
  readonly status: DecisionStatus;
  readonly reason: { readonly code: CaseReasonCode; readonly note: string };
  readonly evidence: readonly EvidenceV1[];
  readonly amount: Money | null;
  readonly window: ServiceWindowV1 | null;
  readonly decidedBy: string;
  readonly decidedAt: UtcTimestamp;
  readonly approval: {
    readonly by: string;
    readonly at: UtcTimestamp | null;
    readonly note: string | null;
  } | null;
  readonly owner: DecisionOwnerV1 | null;
}

function parseDecisionOwner(value: unknown, path: string): DecisionOwnerV1 {
  const v = closed(value, path, [
    'operation',
    'targetId',
    'commandKey',
    'httpStatus',
    'code',
    'state',
    'attempts',
    'lastSentAt',
  ]);
  return {
    operation: oneOf(v.operation, `${path}.operation`, OWNER_OPERATIONS),
    targetId: uuid(v.targetId, `${path}.targetId`),
    commandKey: text(v.commandKey, `${path}.commandKey`, {
      min: 16,
      max: 128,
      pattern: COMMAND_KEY,
    }),
    httpStatus:
      v.httpStatus === null ? null : integer(v.httpStatus, `${path}.httpStatus`, 100, 599),
    code: v.code === null ? null : text(v.code, `${path}.code`, { max: 64, pattern: OWNER_CODE }),
    state:
      v.state === null
        ? null
        : text(v.state, `${path}.state`, { max: 64, pattern: /^[A-Za-z0-9_.-]{1,64}$/ }),
    attempts: integer(v.attempts, `${path}.attempts`, 0, 1000),
    lastSentAt: v.lastSentAt === null ? null : parseUtc(v.lastSentAt, `${path}.lastSentAt`),
  };
}

export function parseDecisionV1(value: unknown, path = '$'): DecisionV1 {
  const v = closed(value, path, [
    'decisionNo',
    'action',
    'status',
    'reason',
    'evidence',
    'amount',
    'window',
    'decidedBy',
    'decidedAt',
    'approval',
    'owner',
  ]);
  const reason = closed(v.reason, `${path}.reason`, ['code', 'note']);
  const status = oneOf(v.status, `${path}.status`, DECISION_STATUSES);
  const owner = v.owner === null ? null : parseDecisionOwner(v.owner, `${path}.owner`);
  // An owner was asked exactly when the decision left the pre-execution states.
  const unsent: readonly DecisionStatus[] = [
    'AWAITING_APPROVAL',
    'REJECTED_BY_APPROVER',
    'BLOCKED_ON_OWNER',
    'NO_OWNER_ACTION',
    'SUPERSEDED',
  ];
  if (!unsent.includes(status) && owner === null)
    throw new ContractViolation('OWNER_COMMAND_REQUIRED', `${path}.owner`);
  let approval: DecisionV1['approval'] = null;
  if (v.approval !== null) {
    const a = closed(v.approval, `${path}.approval`, ['by', 'at', 'note']);
    approval = {
      by: uuid(a.by, `${path}.approval.by`),
      at: a.at === null ? null : parseUtc(a.at, `${path}.approval.at`),
      note: a.note === null ? null : text(a.note, `${path}.approval.note`, NOTE),
    };
  }
  const decidedBy = uuid(v.decidedBy, `${path}.decidedBy`);
  if (approval && approval.by === decidedBy)
    throw new ContractViolation('SAME_PERSON_APPROVAL', `${path}.approval.by`);
  return {
    decisionNo: integer(v.decisionNo, `${path}.decisionNo`, 1, 999_999),
    action: oneOf(v.action, `${path}.action`, CASE_ACTIONS),
    status,
    reason: {
      code: oneOf(reason.code, `${path}.reason.code`, CASE_REASON_CODES),
      note: text(reason.note, `${path}.reason.note`, NOTE),
    },
    evidence: parseEvidence(v.evidence, `${path}.evidence`),
    amount: v.amount === null ? null : parsePositiveMoney(v.amount, `${path}.amount`),
    window: v.window === null ? null : parseWindow(v.window, `${path}.window`),
    decidedBy,
    decidedAt: parseUtc(v.decidedAt, `${path}.decidedAt`),
    approval,
    owner,
  };
}

export interface CaseEventV1 {
  readonly at: UtcTimestamp;
  readonly actor: string;
  readonly action: string;
  readonly decisionNo: number | null;
  readonly from: CaseStatus | null;
  readonly to: CaseStatus;
  readonly outcome: string | null;
  readonly correlationId: string;
}

function parseCaseEvent(value: unknown, path: string): CaseEventV1 {
  const v = closed(value, path, [
    'at',
    'actor',
    'action',
    'decisionNo',
    'from',
    'to',
    'outcome',
    'correlationId',
  ]);
  return {
    at: parseUtc(v.at, `${path}.at`),
    actor: uuid(v.actor, `${path}.actor`),
    action: text(v.action, `${path}.action`, { max: 64, pattern: /^[a-z][a-z.-]{1,63}$/ }),
    decisionNo:
      v.decisionNo === null ? null : integer(v.decisionNo, `${path}.decisionNo`, 1, 999_999),
    from: v.from === null ? null : oneOf(v.from, `${path}.from`, CASE_STATUSES),
    to: oneOf(v.to, `${path}.to`, CASE_STATUSES),
    outcome:
      v.outcome === null
        ? null
        : text(v.outcome, `${path}.outcome`, { max: 64, pattern: OWNER_CODE }),
    correlationId: text(v.correlationId, `${path}.correlationId`, {
      max: 128,
      pattern: /^[A-Za-z0-9._:-]{8,128}$/,
    }),
  };
}

export interface CaseDetailV1 {
  readonly authority: readonly AuthorityV1[];
  readonly case: CaseV1;
  readonly decisions: readonly DecisionV1[];
  readonly events: readonly CaseEventV1[];
}

export function parseCaseDetailV1(value: unknown, path = '$'): CaseDetailV1 {
  const v = closed(value, path, ['authority', 'case', 'decisions', 'events']);
  const decisions = list(v.decisions, `${path}.decisions`, MAX_HISTORY, (d, at) =>
    parseDecisionV1(d, at),
  );
  decisions.forEach((d, index) => {
    if (d.decisionNo !== index + 1)
      throw new ContractViolation('DECISIONS_NOT_SEQUENTIAL', `${path}.decisions[${index}]`);
  });
  return {
    authority: parseAuthority(v.authority, `${path}.authority`),
    case: parseCaseV1(v.case, `${path}.case`),
    decisions,
    events: list(v.events, `${path}.events`, MAX_HISTORY, (e, at) => parseCaseEvent(e, at)),
  };
}

export interface CasePageV1 {
  readonly authority: readonly AuthorityV1[];
  readonly items: readonly CaseV1[];
  readonly nextCursor: string | null;
}

export function parseCasePageV1(value: unknown, path = '$'): CasePageV1 {
  const v = closed(value, path, ['authority', 'items', 'nextCursor']);
  return {
    authority: parseAuthority(v.authority, `${path}.authority`),
    items: list(v.items, `${path}.items`, 100, (c, at) => parseCaseV1(c, at)),
    nextCursor:
      v.nextCursor === null
        ? null
        : text(v.nextCursor, `${path}.nextCursor`, {
            min: 8,
            max: 120,
            pattern: /^[A-Za-z0-9_-]+$/,
          }),
  };
}

export const CASE_LIST_QUERY = [
  'kind',
  'status',
  'subjectType',
  'subjectId',
  'limit',
  'cursor',
] as const;

/**
 * GET /cases/:caseId/current — what the subject's OWNER says now, read on behalf
 * of the caller. Support keeps none of it; statuses are the owner's vocabulary.
 */
export interface ObligationStateV1 {
  readonly obligationId: string;
  readonly revision: number;
  readonly status: string;
  readonly financialStatus: string;
  readonly amount: Money;
  readonly verified: Money;
  readonly outstanding: Money;
  readonly attempts: readonly {
    readonly attemptId: string;
    readonly status: string;
    readonly method: string;
    readonly claimed: Money;
  }[];
}

export interface BookingStateV1 {
  readonly bookingId: string;
  readonly revision: number;
  readonly status: string;
  readonly confirmation: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
}

export type CaseSubjectCurrentV1 =
  | {
      readonly owner: 'billing';
      readonly readAt: UtcTimestamp;
      readonly obligation: ObligationStateV1;
    }
  | { readonly owner: 'booking'; readonly readAt: UtcTimestamp; readonly booking: BookingStateV1 };

/** The provider normalises owner states to this shape (owner-http.ts `state`). */
const OWNER_STATE = /^[A-Z][A-Z_]{1,39}$/;
const ownerState = (value: unknown, path: string) =>
  text(value, path, { max: 40, pattern: OWNER_STATE });

export function parseCaseSubjectCurrentV1(
  value: unknown,
  path = '$',
): { readonly authority: readonly AuthorityV1[]; readonly current: CaseSubjectCurrentV1 } {
  const v = closed(value, path, ['authority', 'current']);
  const at = `${path}.current`;
  const owner = oneOf(record(v.current, at).owner, `${at}.owner`, ['billing', 'booking'] as const);
  let current: CaseSubjectCurrentV1;
  if (owner === 'booking') {
    const c = closed(v.current, at, ['owner', 'readAt', 'booking']);
    const b = closed(c.booking, `${at}.booking`, [
      'bookingId',
      'revision',
      'status',
      'confirmation',
      'startsAt',
      'endsAt',
    ]);
    const window = parseWindow({ startsAt: b.startsAt, endsAt: b.endsAt }, `${at}.booking`);
    current = {
      owner,
      readAt: parseUtc(c.readAt, `${at}.readAt`),
      booking: {
        bookingId: uuid(b.bookingId, `${at}.booking.bookingId`),
        revision: parseRevision(b.revision, `${at}.booking.revision`),
        status: ownerState(b.status, `${at}.booking.status`),
        confirmation: ownerState(b.confirmation, `${at}.booking.confirmation`),
        ...window,
      },
    };
  } else {
    const c = closed(v.current, at, ['owner', 'readAt', 'obligation']);
    const o = closed(c.obligation, `${at}.obligation`, [
      'obligationId',
      'revision',
      'status',
      'financialStatus',
      'amount',
      'verified',
      'outstanding',
      'attempts',
    ]);
    const p = `${at}.obligation`;
    current = {
      owner,
      readAt: parseUtc(c.readAt, `${at}.readAt`),
      obligation: {
        obligationId: uuid(o.obligationId, `${p}.obligationId`),
        revision: parseRevision(o.revision, `${p}.revision`),
        status: ownerState(o.status, `${p}.status`),
        financialStatus: ownerState(o.financialStatus, `${p}.financialStatus`),
        amount: parseNonNegativeMoney(o.amount, `${p}.amount`),
        verified: parseNonNegativeMoney(o.verified, `${p}.verified`),
        outstanding: parseNonNegativeMoney(o.outstanding, `${p}.outstanding`),
        attempts: list(o.attempts, `${p}.attempts`, 50, (item, aAt) => {
          const a = closed(item, aAt, ['attemptId', 'status', 'method', 'claimed']);
          return {
            attemptId: uuid(a.attemptId, `${aAt}.attemptId`),
            status: ownerState(a.status, `${aAt}.status`),
            method: ownerState(a.method, `${aAt}.method`),
            claimed: parseNonNegativeMoney(a.claimed, `${aAt}.claimed`),
          };
        }),
      },
    };
  }
  return { authority: parseAuthority(v.authority, `${path}.authority`), current };
}
