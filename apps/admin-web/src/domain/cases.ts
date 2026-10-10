/**
 * Exception cases as the console presents them. Support owns the case and
 * its decisions; Billing and Booking own the facts. These rules only decide
 * which controls to offer and refuse an incomplete form before sending: every
 * rule is enforced again by Support and by the owner.
 *
 * Import-free on purpose (Node type stripping runs the unit tests directly).
 */
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
export const ACTIVE_STATUSES: readonly CaseStatus[] = CASE_STATUSES.filter(
  (s) => s !== 'RESOLVED' && s !== 'CLOSED',
);

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

export const EVIDENCE_KINDS = [
  'PROVIDER_STATEMENT',
  'BANK_STATEMENT',
  'CUSTOMER_MESSAGE',
  'CALL_NOTE',
  'MEDIA_OBJECT',
  'OWNER_RECORD',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type Desk = 'FINANCE' | 'OPERATIONS';

interface ActionRule {
  /** The permission the owner demands; null: the desk's open grant (DISMISS). */
  readonly permission: string | null;
  readonly amount: boolean;
  readonly evidence: boolean;
  readonly window: boolean;
  readonly fourEyes: boolean;
}

const rule = (permission: string | null, flags: Partial<ActionRule> = {}): ActionRule => ({
  permission,
  amount: false,
  evidence: false,
  window: false,
  fourEyes: false,
  ...flags,
});
const MATCH = rule('billing.reconcile', { amount: true, evidence: true });
const REFUND = rule('billing.refund', { amount: true, evidence: true, fourEyes: true });
const DISMISS = rule(null);

export const KINDS: Readonly<
  Record<
    CaseKind,
    {
      readonly desk: Desk;
      readonly actions: Readonly<Partial<Record<CaseAction, ActionRule>>>;
      readonly reasons: readonly ReasonCode[];
    }
  >
> = {
  PAYMENT_REVIEW: {
    desk: 'FINANCE',
    actions: {
      APPROVE_MATCH: MATCH,
      REJECT_MISMATCH: MATCH,
      MARK_UNKNOWN: rule('billing.reconcile'),
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
    actions: { ACCEPT_LATE_PAYMENT: MATCH, REFUND, DISMISS },
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
    actions: { CANCEL_BOOKING: rule('operations.dispatch'), DISMISS },
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
    actions: { RESCHEDULE_BOOKING: rule('operations.dispatch', { window: true }), DISMISS },
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

const DESK_OPEN: Readonly<Record<Desk, readonly string[]>> = {
  FINANCE: ['billing.reconcile', 'billing.refund'],
  OPERATIONS: ['operations.dispatch'],
};

export function actionRule(kind: CaseKind, action: CaseAction): ActionRule | null {
  return KINDS[kind].actions[action] ?? null;
}

/** A new decision may be taken only when nothing is in flight with an owner. */
export function isDecidable(status: CaseStatus): boolean {
  return status === 'OPEN' || status === 'OWNER_REJECTED' || status === 'BLOCKED_ON_OWNER';
}

export function decidableActions(
  kind: CaseKind,
  status: CaseStatus,
  permissions: readonly string[],
): CaseAction[] {
  if (!isDecidable(status)) return [];
  return CASE_ACTIONS.filter((action) => {
    const r = actionRule(kind, action);
    if (!r) return false;
    const needed = r.permission === null ? DESK_OPEN[KINDS[kind].desk] : [r.permission];
    return needed.some((p) => permissions.includes(p));
  });
}

export function canOpenKind(kind: CaseKind, permissions: readonly string[]): boolean {
  return DESK_OPEN[KINDS[kind].desk].some((p) => permissions.includes(p));
}

/** Four-eyes: a different `billing.refund` holder than the proposer. */
export function canApprove(input: {
  readonly caseStatus: CaseStatus;
  readonly decisionStatus: DecisionStatus;
  readonly proposer: string;
  readonly viewer: string;
  readonly permissions: readonly string[];
}): boolean {
  return (
    input.caseStatus === 'AWAITING_APPROVAL' &&
    input.decisionStatus === 'AWAITING_APPROVAL' &&
    input.permissions.includes('billing.refund') &&
    input.proposer.toLowerCase() !== input.viewer.toLowerCase()
  );
}

/** Only these are resent, and always as the same frozen command. */
export function isResendable(status: DecisionStatus): boolean {
  return status === 'EXECUTING' || status === 'OUTCOME_UNKNOWN' || status === 'BLOCKED_ON_OWNER';
}

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Derived from the case status only (Support stores no priority): an unknown
 * or refused owner answer needs a person first; finished cases need none.
 */
export function priority(status: CaseStatus): Priority {
  if (status === 'OUTCOME_UNKNOWN' || status === 'OWNER_REJECTED') return 'HIGH';
  if (status === 'RESOLVED' || status === 'CLOSED') return 'LOW';
  return 'MEDIUM';
}

/** "45m", "6h", "3d" — the reference's compact age. */
export function age(openedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(openedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/* ------------------------------ decision form ------------------------------ */

export interface ExactAmount {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}

export type AmountCheck =
  | { readonly ok: true; readonly value: ExactAmount }
  | {
      readonly ok: false;
      readonly problem: 'AMOUNT_REQUIRED' | 'AMOUNT_INVALID' | 'AMOUNT_TOO_PRECISE';
    };

export type DecisionProblem =
  | 'ACTION_REQUIRED'
  | 'REASON_REQUIRED'
  | 'NOTE_TOO_SHORT'
  | 'NOTE_TOO_LONG'
  | 'EVIDENCE_REQUIRED'
  | 'EVIDENCE_INVALID'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_TOO_PRECISE'
  | 'WINDOW_INVALID';

export interface DecisionDraft {
  readonly action: CaseAction;
  readonly reason: { readonly code: ReasonCode; readonly note: string };
  readonly evidence?: readonly { readonly kind: EvidenceKind; readonly reference: string }[];
  readonly amount?: ExactAmount;
  readonly window?: { readonly startsAt: string; readonly endsAt: string };
}

const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Syria keeps UTC+3 all year; service windows are entered in Damascus time. */
const DAMASCUS_OFFSET = '+03:00';

/** A Damascus date and two times → exact UTC instants; end after start, ≤ 12 h, in the future. */
export function damascusWindow(
  date: string,
  start: string,
  end: string,
  now: number,
): { readonly startsAt: string; readonly endsAt: string } | null {
  if (!DATE.test(date) || !TIME.test(start) || !TIME.test(end)) return null;
  const startsAt = Date.parse(`${date}T${start}:00${DAMASCUS_OFFSET}`);
  const endsAt = Date.parse(`${date}T${end}:00${DAMASCUS_OFFSET}`);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return null;
  if (startsAt <= now || endsAt <= startsAt || endsAt - startsAt > 12 * 3_600_000) return null;
  return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
}

export function validateDecision(input: {
  readonly kind: CaseKind;
  readonly action: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly evidence: readonly { readonly kind: string; readonly reference: string }[];
  readonly amount: AmountCheck | null;
  readonly window: { readonly startsAt: string; readonly endsAt: string } | null;
}): { ok: true; value: DecisionDraft } | { ok: false; problem: DecisionProblem } {
  const action = CASE_ACTIONS.find((a) => a === input.action);
  const r = action ? actionRule(input.kind, action) : null;
  if (!action || !r) return { ok: false, problem: 'ACTION_REQUIRED' };
  const code = KINDS[input.kind].reasons.find((c) => c === input.reasonCode);
  if (!code) return { ok: false, problem: 'REASON_REQUIRED' };
  const note = input.note.trim();
  if (note.length < 10) return { ok: false, problem: 'NOTE_TOO_SHORT' };
  if (note.length > 500) return { ok: false, problem: 'NOTE_TOO_LONG' };
  const filled = input.evidence.filter((e) => e.reference.trim() !== '');
  const evidence: { kind: EvidenceKind; reference: string }[] = [];
  for (const e of filled) {
    const kind = EVIDENCE_KINDS.find((k) => k === e.kind);
    const reference = e.reference.trim();
    if (!kind || !EVIDENCE_REFERENCE.test(reference))
      return { ok: false, problem: 'EVIDENCE_INVALID' };
    evidence.push({ kind, reference });
  }
  if (evidence.length > 5) return { ok: false, problem: 'EVIDENCE_INVALID' };
  if (r.evidence && evidence.length === 0) return { ok: false, problem: 'EVIDENCE_REQUIRED' };
  let amount: ExactAmount | undefined;
  if (r.amount) {
    if (!input.amount) return { ok: false, problem: 'AMOUNT_REQUIRED' };
    if (!input.amount.ok) return { ok: false, problem: input.amount.problem };
    if (action === 'REFUND' && input.amount.value.amountMinor === '0')
      return { ok: false, problem: 'AMOUNT_INVALID' };
    amount = input.amount.value;
  }
  if (r.window && !input.window) return { ok: false, problem: 'WINDOW_INVALID' };
  return {
    ok: true,
    value: {
      action,
      reason: { code, note },
      ...(evidence.length > 0 ? { evidence } : {}),
      ...(amount ? { amount } : {}),
      ...(r.window && input.window ? { window: input.window } : {}),
    },
  };
}

const DESK_READ: Readonly<Record<Desk, readonly string[]>> = {
  FINANCE: ['billing.read', 'support.cases.read'],
  OPERATIONS: ['operations.dispatch', 'support.cases.read'],
};

/** The kinds this viewer's desk may read (Support answers 404 for the others). */
export function readableKinds(permissions: readonly string[]): CaseKind[] {
  return CASE_KINDS.filter((kind) =>
    DESK_READ[KINDS[kind].desk].some((p) => permissions.includes(p)),
  );
}
