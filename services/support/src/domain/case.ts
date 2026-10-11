/**
 * Support owns exception CASES: the staff record of a payment or booking
 * exception, the reasoned decision taken on it and what the owning service
 * answered when that decision was carried out.
 *
 * Support never owns money or booking state. A decision that changes a fact
 * is executed by that fact's owner (Billing or Booking), with the deciding
 * staff member's own authority, and the case records the owner's answer.
 * "Approved" in a case therefore never means "paid", "refunded" or
 * "cancelled": only the owner's APPLIED answer does, and an unknowable answer
 * stays OUTCOME_UNKNOWN until the same command is replayed.
 */

export const CASE_KINDS = [
  'PAYMENT_REVIEW',
  'REFUND',
  'LATE_PAYMENT',
  'BOOKING_CANCELLATION',
  'BOOKING_RESCHEDULE',
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/** Which staff function a kind belongs to; it decides who may see and decide it. */
export type CaseDesk = 'FINANCE' | 'OPERATIONS';

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

/** A case in these states is finished; a new case may be opened for the subject. */
export const TERMINAL_STATUSES: readonly CaseStatus[] = ['RESOLVED', 'CLOSED'];

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

/** The owner operation a decision is carried out with; DISMISS has none. */
export const OWNER_OPERATIONS = [
  'billing.reconcile',
  'billing.refund',
  'booking.cancel',
  'booking.reschedule',
] as const;
export type OwnerOperation = (typeof OWNER_OPERATIONS)[number];

export type Approval = 'SINGLE' | 'FOUR_EYES';

export const EVIDENCE_KINDS = [
  'PROVIDER_STATEMENT',
  'BANK_STATEMENT',
  'CUSTOMER_MESSAGE',
  'CALL_NOTE',
  'MEDIA_OBJECT',
  'OWNER_RECORD',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const REASON_CODES = [
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
export type ReasonCode = (typeof REASON_CODES)[number];

export type CaseRuleCode =
  | 'INVALID_KIND'
  | 'INVALID_SUBJECT'
  | 'SUBJECT_KIND_MISMATCH'
  | 'INVALID_SUMMARY'
  | 'INVALID_ACTION'
  | 'ACTION_NOT_ALLOWED_FOR_KIND'
  | 'INVALID_REASON'
  | 'REASON_NOT_ALLOWED_FOR_KIND'
  | 'REASON_NOTE_REQUIRED'
  | 'INVALID_EVIDENCE'
  | 'EVIDENCE_REQUIRED'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_NOT_ALLOWED'
  | 'INVALID_WINDOW'
  | 'WINDOW_REQUIRED'
  | 'WINDOW_NOT_ALLOWED'
  | 'CASE_NOT_DECIDABLE'
  | 'CASE_NOT_AWAITING_APPROVAL'
  | 'SAME_PERSON_APPROVAL'
  | 'APPROVAL_DECISION_REQUIRED'
  | 'NOTHING_TO_EXECUTE';

export class CaseRuleError extends Error {
  constructor(readonly code: CaseRuleCode) {
    super(code);
    this.name = 'CaseRuleError';
  }
}

export interface ActionPolicy {
  readonly operation: OwnerOperation | null;
  readonly approval: Approval;
  /** Money-affecting decisions must cite at least one piece of evidence. */
  readonly evidence: 'REQUIRED' | 'OPTIONAL';
  readonly amount: 'REQUIRED' | 'NONE';
  readonly window: 'REQUIRED' | 'NONE';
}

export interface KindPolicy {
  readonly desk: CaseDesk;
  readonly subject: SubjectType;
  readonly actions: Readonly<Partial<Record<CaseAction, ActionPolicy>>>;
  readonly reasons: readonly ReasonCode[];
}

const DISMISS: ActionPolicy = {
  operation: null,
  approval: 'SINGLE',
  evidence: 'OPTIONAL',
  amount: 'NONE',
  window: 'NONE',
};
const RECONCILE_WITH_AMOUNT: ActionPolicy = {
  operation: 'billing.reconcile',
  approval: 'SINGLE',
  evidence: 'REQUIRED',
  amount: 'REQUIRED',
  window: 'NONE',
};
/** A refund moves money back out: a second finance reviewer must approve it. */
const REFUND: ActionPolicy = {
  operation: 'billing.refund',
  approval: 'FOUR_EYES',
  evidence: 'REQUIRED',
  amount: 'REQUIRED',
  window: 'NONE',
};

export const KIND_POLICIES: Readonly<Record<CaseKind, KindPolicy>> = {
  PAYMENT_REVIEW: {
    desk: 'FINANCE',
    subject: 'billing.payment-attempt',
    actions: {
      APPROVE_MATCH: RECONCILE_WITH_AMOUNT,
      REJECT_MISMATCH: RECONCILE_WITH_AMOUNT,
      MARK_UNKNOWN: {
        operation: 'billing.reconcile',
        approval: 'SINGLE',
        evidence: 'OPTIONAL',
        amount: 'NONE',
        window: 'NONE',
      },
      DISMISS,
    },
    reasons: [
      'PROVIDER_CONFIRMED',
      'PROVIDER_AMOUNT_DIFFERS',
      'PROVIDER_NO_RECORD',
      'PROVIDER_UNREACHABLE',
      'DUPLICATE_PAYMENT',
      'ALREADY_HANDLED',
      'OTHER',
    ],
  },
  REFUND: {
    desk: 'FINANCE',
    subject: 'billing.obligation',
    actions: { REFUND, DISMISS },
    reasons: [
      'DUPLICATE_PAYMENT',
      'SERVICE_NOT_DELIVERED',
      'PAID_AFTER_CANCELLATION',
      'CUSTOMER_REQUEST',
      'OPERATIONAL_ERROR',
      'ALREADY_HANDLED',
      'OTHER',
    ],
  },
  LATE_PAYMENT: {
    desk: 'FINANCE',
    subject: 'billing.payment-attempt',
    actions: { ACCEPT_LATE_PAYMENT: RECONCILE_WITH_AMOUNT, REFUND, DISMISS },
    reasons: [
      'PAID_AFTER_CANCELLATION',
      'PAID_AFTER_DEADLINE',
      'PROVIDER_CONFIRMED',
      'ALREADY_HANDLED',
      'OTHER',
    ],
  },
  BOOKING_CANCELLATION: {
    desk: 'OPERATIONS',
    subject: 'booking',
    actions: {
      CANCEL_BOOKING: {
        operation: 'booking.cancel',
        approval: 'SINGLE',
        evidence: 'OPTIONAL',
        amount: 'NONE',
        window: 'NONE',
      },
      DISMISS,
    },
    reasons: [
      'CUSTOMER_REQUEST',
      'TECHNICIAN_UNAVAILABLE',
      'WEATHER_OR_SAFETY',
      'OPERATIONAL_ERROR',
      'ALREADY_HANDLED',
      'OTHER',
    ],
  },
  BOOKING_RESCHEDULE: {
    desk: 'OPERATIONS',
    subject: 'booking',
    actions: {
      RESCHEDULE_BOOKING: {
        operation: 'booking.reschedule',
        approval: 'SINGLE',
        evidence: 'OPTIONAL',
        amount: 'NONE',
        window: 'REQUIRED',
      },
      DISMISS,
    },
    reasons: [
      'CUSTOMER_REQUEST',
      'TECHNICIAN_UNAVAILABLE',
      'WEATHER_OR_SAFETY',
      'OPERATIONAL_ERROR',
      'ALREADY_HANDLED',
      'OTHER',
    ],
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Opaque references only: no spaces, so a phone number or a name cannot be pasted whole. */
const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$/;
const CURRENCY = /^[A-Z]{3}$/;
const AMOUNT_MINOR = /^(0|[1-9][0-9]{0,17})$/;
const MAX_EVIDENCE = 5;
const NOTE_MIN = 10;
const NOTE_MAX = 500;
const SUMMARY_MAX = 200;
const MAX_WINDOW_MS = 12 * 3_600_000;

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: CaseRuleCode,
): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new CaseRuleError(code);
  return found;
}

export interface CaseSubject {
  readonly type: SubjectType;
  /** The attempt, obligation or booking id. */
  readonly id: string;
  /** For payment-attempt subjects: the obligation the attempt belongs to. */
  readonly parentId: string | null;
}

export function caseSubject(kind: CaseKind, raw: unknown): CaseSubject {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new CaseRuleError('INVALID_SUBJECT');
  const record = raw as Record<string, unknown>;
  const type = oneOf(record.type, SUBJECT_TYPES, 'INVALID_SUBJECT');
  if (type !== KIND_POLICIES[kind].subject) throw new CaseRuleError('SUBJECT_KIND_MISMATCH');
  const allowedKeys =
    type === 'billing.payment-attempt' ? ['type', 'id', 'parentId'] : ['type', 'id'];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key)))
    throw new CaseRuleError('INVALID_SUBJECT');
  const id = record.id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new CaseRuleError('INVALID_SUBJECT');
  let parentId: string | null = null;
  if (type === 'billing.payment-attempt') {
    if (typeof record.parentId !== 'string' || !UUID.test(record.parentId))
      throw new CaseRuleError('INVALID_SUBJECT');
    parentId = record.parentId.toLowerCase();
  }
  return { type, id: id.toLowerCase(), parentId };
}

/** A short staff summary. Free text stays inside Support: never in events or logs. */
export function caseSummary(raw: unknown): string {
  if (typeof raw !== 'string') throw new CaseRuleError('INVALID_SUMMARY');
  const text = raw.trim();
  if (text.length < 3 || text.length > SUMMARY_MAX || hasControl(text))
    throw new CaseRuleError('INVALID_SUMMARY');
  return text;
}

function hasControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x0a) || code === 0x7f) return true;
  }
  return false;
}

export interface Reason {
  readonly code: ReasonCode;
  readonly note: string;
}

/** Every manual decision states a reason code AND an explanatory note. */
export function reason(kind: CaseKind, raw: unknown): Reason {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new CaseRuleError('INVALID_REASON');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'code' && key !== 'note'))
    throw new CaseRuleError('INVALID_REASON');
  const code = oneOf(record.code, REASON_CODES, 'INVALID_REASON');
  if (!KIND_POLICIES[kind].reasons.includes(code))
    throw new CaseRuleError('REASON_NOT_ALLOWED_FOR_KIND');
  if (typeof record.note !== 'string') throw new CaseRuleError('REASON_NOTE_REQUIRED');
  const note = record.note.trim();
  if (note.length < NOTE_MIN) throw new CaseRuleError('REASON_NOTE_REQUIRED');
  if (note.length > NOTE_MAX || hasControl(note)) throw new CaseRuleError('INVALID_REASON');
  return { code, note };
}

export interface Evidence {
  readonly kind: EvidenceKind;
  readonly reference: string;
}

export function evidenceList(raw: unknown): readonly Evidence[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EVIDENCE) throw new CaseRuleError('INVALID_EVIDENCE');
  const seen = new Set<string>();
  return raw.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new CaseRuleError('INVALID_EVIDENCE');
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== 'kind' && key !== 'reference'))
      throw new CaseRuleError('INVALID_EVIDENCE');
    const kind = oneOf(record.kind, EVIDENCE_KINDS, 'INVALID_EVIDENCE');
    if (typeof record.reference !== 'string' || !EVIDENCE_REFERENCE.test(record.reference))
      throw new CaseRuleError('INVALID_EVIDENCE');
    const key = `${kind}|${record.reference}`;
    if (seen.has(key)) throw new CaseRuleError('INVALID_EVIDENCE');
    seen.add(key);
    return { kind, reference: record.reference };
  });
}

/**
 * Exact money as the owner's wire shape: integer minor units as a decimal
 * string with an explicit currency and scale. It is never a float and never
 * rescaled here; the owner decides whether the currency and scale are usable.
 */
export interface ExactAmount {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}

export function exactAmount(raw: unknown): ExactAmount {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new CaseRuleError('INVALID_AMOUNT');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'amountMinor,currency,scale')
    throw new CaseRuleError('INVALID_AMOUNT');
  const { currency, amountMinor, scale } = record;
  if (
    typeof currency !== 'string' ||
    !CURRENCY.test(currency) ||
    typeof amountMinor !== 'string' ||
    !AMOUNT_MINOR.test(amountMinor) ||
    typeof scale !== 'number' ||
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > 3
  )
    throw new CaseRuleError('INVALID_AMOUNT');
  return { currency, amountMinor, scale };
}

export interface ServiceWindow {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** A proposed new service window: UTC instants, start before end, bounded length. */
export function serviceWindow(raw: unknown, now: Date): ServiceWindow {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new CaseRuleError('INVALID_WINDOW');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'endsAt,startsAt')
    throw new CaseRuleError('INVALID_WINDOW');
  const starts = instant(record.startsAt);
  const ends = instant(record.endsAt);
  if (starts.getTime() <= now.getTime() || ends.getTime() <= starts.getTime())
    throw new CaseRuleError('INVALID_WINDOW');
  if (ends.getTime() - starts.getTime() > MAX_WINDOW_MS) throw new CaseRuleError('INVALID_WINDOW');
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

function instant(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)
  )
    throw new CaseRuleError('INVALID_WINDOW');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CaseRuleError('INVALID_WINDOW');
  return date;
}

export interface DecisionInput {
  readonly action: CaseAction;
  readonly reason: Reason;
  readonly evidence: readonly Evidence[];
  readonly amount: ExactAmount | null;
  readonly window: ServiceWindow | null;
}

/** Validates a decision against its kind's policy; the shape is closed. */
export function decisionInput(
  kind: CaseKind,
  raw: Record<string, unknown>,
  now: Date,
): DecisionInput {
  const action = oneOf(raw.action, CASE_ACTIONS, 'INVALID_ACTION');
  const policy = KIND_POLICIES[kind].actions[action];
  if (!policy) throw new CaseRuleError('ACTION_NOT_ALLOWED_FOR_KIND');
  const parsedReason = reason(kind, raw.reason);
  const evidence = evidenceList(raw.evidence);
  if (policy.evidence === 'REQUIRED' && evidence.length === 0)
    throw new CaseRuleError('EVIDENCE_REQUIRED');
  let amount: ExactAmount | null = null;
  if (policy.amount === 'REQUIRED') {
    if (raw.amount === undefined || raw.amount === null) throw new CaseRuleError('AMOUNT_REQUIRED');
    amount = exactAmount(raw.amount);
    if (action === 'REFUND' && amount.amountMinor === '0')
      throw new CaseRuleError('INVALID_AMOUNT');
  } else if (raw.amount !== undefined && raw.amount !== null) {
    throw new CaseRuleError('AMOUNT_NOT_ALLOWED');
  }
  let window: ServiceWindow | null = null;
  if (policy.window === 'REQUIRED') {
    if (raw.window === undefined || raw.window === null) throw new CaseRuleError('WINDOW_REQUIRED');
    window = serviceWindow(raw.window, now);
  } else if (raw.window !== undefined && raw.window !== null) {
    throw new CaseRuleError('WINDOW_NOT_ALLOWED');
  }
  return { action, reason: parsedReason, evidence, amount, window };
}

export function actionPolicy(kind: CaseKind, action: CaseAction): ActionPolicy {
  const policy = KIND_POLICIES[kind].actions[action];
  if (!policy) throw new CaseRuleError('ACTION_NOT_ALLOWED_FOR_KIND');
  return policy;
}

/** Where a case goes when a decision is recorded on it. */
export interface DecisionPlan {
  readonly decisionStatus: DecisionStatus;
  readonly caseStatus: CaseStatus;
  /** True when the owner must now be asked to carry the decision out. */
  readonly execute: boolean;
}

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

/**
 * A new decision may be recorded only while no other decision is in flight.
 * BLOCKED_ON_OWNER is decidable because the owner was never asked (the
 * capability is unpublished), so nothing can have happened; the blocked
 * decision is then SUPERSEDED. OUTCOME_UNKNOWN is NOT decidable: the owner may
 * have acted, so only a resend of the same command may settle it.
 */
export const DECIDABLE_STATUSES: readonly CaseStatus[] = [
  'OPEN',
  'OWNER_REJECTED',
  'BLOCKED_ON_OWNER',
];

export function planDecision(input: {
  readonly kind: CaseKind;
  readonly caseStatus: CaseStatus;
  readonly action: CaseAction;
}): DecisionPlan {
  if (!DECIDABLE_STATUSES.includes(input.caseStatus)) throw new CaseRuleError('CASE_NOT_DECIDABLE');
  const policy = actionPolicy(input.kind, input.action);
  if (policy.operation === null)
    return { decisionStatus: 'NO_OWNER_ACTION', caseStatus: 'CLOSED', execute: false };
  if (policy.approval === 'FOUR_EYES')
    return { decisionStatus: 'AWAITING_APPROVAL', caseStatus: 'AWAITING_APPROVAL', execute: false };
  return { decisionStatus: 'EXECUTING', caseStatus: 'EXECUTING', execute: true };
}

/**
 * Four-eyes: the approver must be a different person from the one who
 * proposed. Approval sends the decision to its owner; rejection reopens the
 * case for a different decision.
 */
export function planApproval(input: {
  readonly caseStatus: CaseStatus;
  readonly decisionStatus: DecisionStatus;
  readonly proposer: string;
  readonly approver: string;
  readonly approve: boolean;
}): DecisionPlan {
  if (input.caseStatus !== 'AWAITING_APPROVAL' || input.decisionStatus !== 'AWAITING_APPROVAL')
    throw new CaseRuleError('CASE_NOT_AWAITING_APPROVAL');
  if (input.proposer.toLowerCase() === input.approver.toLowerCase())
    throw new CaseRuleError('SAME_PERSON_APPROVAL');
  return input.approve
    ? { decisionStatus: 'EXECUTING', caseStatus: 'EXECUTING', execute: true }
    : { decisionStatus: 'REJECTED_BY_APPROVER', caseStatus: 'OPEN', execute: false };
}

/** Only an in-flight, unknown or owner-blocked decision is re-sent, always with its own key. */
export const RESENDABLE_STATUSES: readonly DecisionStatus[] = [
  'EXECUTING',
  'OUTCOME_UNKNOWN',
  'BLOCKED_ON_OWNER',
];

export function assertResendable(status: DecisionStatus): void {
  if (!RESENDABLE_STATUSES.includes(status)) throw new CaseRuleError('NOTHING_TO_EXECUTE');
}

/** What the owner answered, classified so that nothing unknown becomes success. */
export type OwnerOutcome =
  | { readonly kind: 'APPLIED'; readonly ownerStatus: number; readonly ownerState: string | null }
  | { readonly kind: 'REJECTED'; readonly ownerStatus: number; readonly code: string }
  | { readonly kind: 'UNKNOWN'; readonly code: string }
  | { readonly kind: 'UNAVAILABLE'; readonly code: string };

export function outcomeStatuses(outcome: OwnerOutcome): {
  readonly decisionStatus: DecisionStatus;
  readonly caseStatus: CaseStatus;
} {
  switch (outcome.kind) {
    case 'APPLIED':
      return { decisionStatus: 'APPLIED', caseStatus: 'RESOLVED' };
    case 'REJECTED':
      return { decisionStatus: 'OWNER_REJECTED', caseStatus: 'OWNER_REJECTED' };
    case 'UNKNOWN':
      return { decisionStatus: 'OUTCOME_UNKNOWN', caseStatus: 'OUTCOME_UNKNOWN' };
    case 'UNAVAILABLE':
      return { decisionStatus: 'BLOCKED_ON_OWNER', caseStatus: 'BLOCKED_ON_OWNER' };
  }
}

/**
 * The owner's idempotency key for one decision. It is derived, never random,
 * so every resend of the same decision is the SAME owner command and the
 * owner acts at most once.
 */
export function ownerCommandKey(caseId: string, decisionNo: number): string {
  return `support-${caseId.replaceAll('-', '').toLowerCase()}-d${decisionNo}`;
}
