import {
  CASE_ACTIONS,
  CASE_KINDS,
  CASE_STATUSES,
  DECISION_STATUSES,
  EVIDENCE_KINDS,
  REASON_CODES,
  type CaseAction,
  type CaseKind,
  type CaseStatus,
  type DecisionDraft,
  type DecisionStatus,
  type ExactAmount,
} from '../domain/cases';
import {
  INSTANT,
  UUID,
  integer,
  list,
  nullableText,
  object,
  oneOf,
  request,
  text,
  type Result,
} from './http';
import { formatMoney } from '../domain/finance';
import { money } from './kpis';

/**
 * Support's exception cases through the Gateway routes requested in
 * CR-D-P04-04. Support records decisions and the owner's answer; Billing and
 * Booking keep the facts. The console never shows "paid", "refunded" or
 * "cancelled" unless the owner's own answer says so.
 */
export interface CaseSubject {
  readonly type: 'billing.payment-attempt' | 'billing.obligation' | 'booking';
  readonly id: string;
  readonly parentId: string | null;
}

export interface CaseSummary {
  readonly caseId: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly subject: CaseSubject;
  readonly summary: string;
  readonly snapshot: {
    readonly owner: 'billing' | 'booking';
    readonly readAt: string;
    readonly state: Readonly<Record<string, string | number | null>>;
  };
  readonly openedBy: string;
  readonly openedAt: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface Decision {
  readonly decisionNo: number;
  readonly action: CaseAction;
  readonly status: DecisionStatus;
  readonly reason: { readonly code: string; readonly note: string };
  readonly evidence: readonly { readonly kind: string; readonly reference: string }[];
  readonly amount: ExactAmount | null;
  readonly window: { readonly startsAt: string; readonly endsAt: string } | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly approval: {
    readonly by: string;
    readonly at: string | null;
    readonly note: string | null;
  } | null;
  readonly owner: {
    readonly operation: string;
    readonly httpStatus: number | null;
    readonly code: string | null;
    readonly state: string | null;
    readonly attempts: number;
    readonly lastSentAt: string | null;
  } | null;
}

export interface AuditEntry {
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly decisionNo: number | null;
  readonly from: string | null;
  readonly to: string;
  readonly outcome: string | null;
  readonly correlationId: string;
}

export interface CaseDetail {
  readonly case: CaseSummary;
  readonly decisions: readonly Decision[];
  readonly events: readonly AuditEntry[];
}

export interface CasePage {
  readonly items: readonly CaseSummary[];
  readonly nextCursor: string | null;
}

const CODE = /^[A-Z][A-Z0-9_:.-]{0,95}$/;
const SNAPSHOT_KEY = /^[a-zA-Z]{1,40}$/;

function subject(raw: unknown, path: string): CaseSubject {
  const s = object(raw, path);
  return {
    type: oneOf(
      s.type,
      ['billing.payment-attempt', 'billing.obligation', 'booking'] as const,
      `${path}.type`,
    ),
    id: text(s.id, `${path}.id`, UUID),
    parentId: nullableText(s.parentId, `${path}.parentId`, UUID),
  };
}

function snapshot(raw: unknown, path: string): CaseSummary['snapshot'] {
  const s = object(raw, path);
  const state = object(s.state, `${path}.state`);
  const entries = Object.entries(state);
  if (entries.length > 20) throw new Error('MALFORMED');
  const clean: Record<string, string | number | null> = {};
  for (const [key, value] of entries) {
    if (!SNAPSHOT_KEY.test(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isSafeInteger(value))
    )
      clean[key] = typeof value === 'string' ? value.slice(0, 64) : value;
  }
  return {
    owner: oneOf(s.owner, ['billing', 'booking'] as const, `${path}.owner`),
    readAt: text(s.readAt, `${path}.readAt`, INSTANT),
    state: clean,
  };
}

function caseSummary(raw: unknown, path: string): CaseSummary {
  const c = object(raw, path);
  return {
    caseId: text(c.caseId, `${path}.caseId`, UUID),
    kind: oneOf(c.kind, CASE_KINDS, `${path}.kind`),
    status: oneOf(c.status, CASE_STATUSES, `${path}.status`),
    subject: subject(c.subject, `${path}.subject`),
    summary: text(c.summary, `${path}.summary`).slice(0, 200),
    snapshot: snapshot(c.snapshot, `${path}.snapshot`),
    openedBy: text(c.openedBy, `${path}.openedBy`, UUID),
    openedAt: text(c.openedAt, `${path}.openedAt`, INSTANT),
    revision: integer(c.revision, `${path}.revision`),
    updatedAt: text(c.updatedAt, `${path}.updatedAt`, INSTANT),
  };
}

function decision(raw: unknown, path: string): Decision {
  const d = object(raw, path);
  const reason = object(d.reason, `${path}.reason`);
  const approval = d.approval === null ? null : object(d.approval, `${path}.approval`);
  const owner = d.owner === null ? null : object(d.owner, `${path}.owner`);
  const window = d.window === null ? null : object(d.window, `${path}.window`);
  return {
    decisionNo: integer(d.decisionNo, `${path}.decisionNo`),
    action: oneOf(d.action, CASE_ACTIONS, `${path}.action`),
    status: oneOf(d.status, DECISION_STATUSES, `${path}.status`),
    reason: {
      code: oneOf(reason.code, REASON_CODES, `${path}.reason.code`),
      note: text(reason.note, `${path}.reason.note`).slice(0, 500),
    },
    evidence: list(d.evidence, `${path}.evidence`, (v, p) => {
      const e = object(v, p);
      return {
        kind: oneOf(e.kind, EVIDENCE_KINDS, `${p}.kind`),
        reference: text(e.reference, `${p}.reference`, /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$/),
      };
    }),
    amount: d.amount === null ? null : money(d.amount, `${path}.amount`),
    window: window
      ? {
          startsAt: text(window.startsAt, `${path}.window.startsAt`, INSTANT),
          endsAt: text(window.endsAt, `${path}.window.endsAt`, INSTANT),
        }
      : null,
    decidedBy: text(d.decidedBy, `${path}.decidedBy`, UUID),
    decidedAt: text(d.decidedAt, `${path}.decidedAt`, INSTANT),
    approval: approval
      ? {
          by: text(approval.by, `${path}.approval.by`, UUID),
          at: nullableText(approval.at, `${path}.approval.at`, INSTANT),
          note: nullableText(approval.note, `${path}.approval.note`),
        }
      : null,
    owner: owner
      ? {
          operation: text(owner.operation, `${path}.owner.operation`, /^[a-z]+\.[a-z]+$/),
          httpStatus:
            owner.httpStatus === null
              ? null
              : integer(owner.httpStatus, `${path}.owner.httpStatus`),
          code: nullableText(owner.code, `${path}.owner.code`, CODE),
          state: nullableText(owner.state, `${path}.owner.state`, CODE),
          attempts: integer(owner.attempts, `${path}.owner.attempts`),
          lastSentAt: nullableText(owner.lastSentAt, `${path}.owner.lastSentAt`, INSTANT),
        }
      : null,
  };
}

function audit(raw: unknown, path: string): AuditEntry {
  const e = object(raw, path);
  return {
    at: text(e.at, `${path}.at`, INSTANT),
    actor: text(e.actor, `${path}.actor`, UUID),
    action: text(e.action, `${path}.action`, /^[a-z]+\.[a-z-]+$/),
    decisionNo: e.decisionNo === null ? null : integer(e.decisionNo, `${path}.decisionNo`),
    from: e.from === null ? null : oneOf(e.from, CASE_STATUSES, `${path}.from`),
    to: oneOf(e.to, CASE_STATUSES, `${path}.to`),
    outcome: nullableText(e.outcome, `${path}.outcome`, CODE),
    correlationId: text(e.correlationId, `${path}.correlationId`, UUID),
  };
}

function detail(raw: unknown): CaseDetail {
  const d = object(raw, '$');
  return {
    case: caseSummary(d.case, 'case'),
    decisions: list(d.decisions, 'decisions', decision),
    events: list(d.events, 'events', audit),
  };
}

export function listCases(query: {
  readonly kind?: readonly CaseKind[];
  readonly status?: readonly CaseStatus[];
  readonly subject?: { readonly type: CaseSubject['type']; readonly id: string };
  readonly limit?: number;
  readonly cursor?: string | null;
}): Promise<Result<CasePage>> {
  return request('/admin/cases', {
    query: {
      kind: query.kind && query.kind.length > 0 ? query.kind.join(',') : undefined,
      status: query.status && query.status.length > 0 ? query.status.join(',') : undefined,
      subjectType: query.subject?.type,
      subjectId: query.subject?.id,
      limit: query.limit === undefined ? undefined : String(query.limit),
      cursor: query.cursor ?? undefined,
    },
    read: (raw) => {
      const page = object(raw, '$');
      return {
        items: list(page.items, 'items', caseSummary),
        nextCursor: nullableText(page.nextCursor, 'nextCursor', /^[A-Za-z0-9_-]{8,200}$/),
      };
    },
  });
}

export function readCase(caseId: string): Promise<Result<CaseDetail>> {
  return request(`/admin/cases/${encodeURIComponent(caseId)}`, { read: detail });
}

export interface CurrentState {
  readonly owner: 'billing' | 'booking';
  readonly readAt: string;
  readonly status: string;
  readonly revision: number;
  readonly lines: readonly (readonly [string, string])[];
}

/** The subject as its owner reports it NOW (read by Support as the caller). */
export function currentState(caseId: string): Promise<Result<CurrentState>> {
  return request(`/admin/cases/${encodeURIComponent(caseId)}/current`, {
    read: (raw) => {
      const current = object(object(raw, '$').current, 'current');
      const owner = oneOf(current.owner, ['billing', 'booking'] as const, 'current.owner');
      const readAt = text(current.readAt, 'current.readAt', INSTANT);
      if (owner === 'booking') {
        const b = object(current.booking, 'current.booking');
        return {
          owner,
          readAt,
          status: text(b.status, 'booking.status', CODE),
          revision: integer(b.revision, 'booking.revision'),
          lines: [
            ['confirmation', text(b.confirmation, 'booking.confirmation', CODE)],
            ['startsAt', text(b.startsAt, 'booking.startsAt', INSTANT)],
            ['endsAt', text(b.endsAt, 'booking.endsAt', INSTANT)],
          ],
        };
      }
      const o = object(current.obligation, 'current.obligation');
      return {
        owner,
        readAt,
        status: text(o.financialStatus, 'obligation.financialStatus', CODE),
        revision: integer(o.revision, 'obligation.revision'),
        lines: [
          ['obligationStatus', text(o.status, 'obligation.status', CODE)],
          ['verified', formatMoney(money(o.verified, 'obligation.verified'))],
          ['outstanding', formatMoney(money(o.outstanding, 'obligation.outstanding'))],
          ...list(o.attempts, 'obligation.attempts', (v, p) => {
            const a = object(v, p);
            return [
              `attempt:${text(a.attemptId, `${p}.attemptId`, UUID)}`,
              text(a.status, `${p}.status`, CODE),
            ] as const;
          }),
        ],
      };
    },
  });
}

export function openCase(input: {
  readonly kind: CaseKind;
  readonly subject: CaseSubject;
  readonly summary: string;
  readonly key: string;
}): Promise<Result<CaseDetail>> {
  const { type, id, parentId } = input.subject;
  return request('/admin/cases', {
    method: 'POST',
    body: {
      kind: input.kind,
      subject: type === 'billing.payment-attempt' ? { type, id, parentId } : { type, id },
      summary: input.summary,
    },
    idempotencyKey: input.key,
    read: detail,
  });
}

export function decide(
  caseId: string,
  draft: DecisionDraft,
  key: string,
): Promise<Result<CaseDetail>> {
  return request(`/admin/cases/${encodeURIComponent(caseId)}/decisions`, {
    method: 'POST',
    body: draft,
    idempotencyKey: key,
    read: detail,
  });
}

export function approveDecision(
  caseId: string,
  decisionNo: number,
  input: { readonly approve: boolean; readonly note: string },
  key: string,
): Promise<Result<CaseDetail>> {
  return request(`/admin/cases/${encodeURIComponent(caseId)}/decisions/${decisionNo}/approval`, {
    method: 'POST',
    body: input,
    idempotencyKey: key,
    read: detail,
  });
}

export function resendDecision(caseId: string, decisionNo: number): Promise<Result<CaseDetail>> {
  return request(`/admin/cases/${encodeURIComponent(caseId)}/decisions/${decisionNo}/execution`, {
    method: 'POST',
    body: {},
    read: detail,
  });
}
