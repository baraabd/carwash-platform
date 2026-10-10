import type { MoneyWire, ReconcileDraft } from '../domain/finance';
import {
  INSTANT,
  UUID,
  integer,
  list,
  nullableText,
  object,
  request,
  text,
  type Result,
} from './http';
import { money } from './kpis';

/**
 * Billing reads and the reconciliation command, through the Gateway routes
 * requested in CR-D-P03-02. Billing alone decides whether money was received;
 * the console shows Billing's answer and never infers "paid".
 */
export interface Attempt {
  readonly attemptId: string;
  readonly method: string;
  readonly status: string;
  /** Billing returns only a mask of the provider reference. */
  readonly reference: string;
  readonly claimed: MoneyWire;
  readonly submittedAt: string;
  readonly reconciledAt: string | null;
}

export interface Obligation {
  readonly obligationId: string;
  readonly revision: number;
  readonly status: string;
  readonly financialStatus: string;
  readonly amount: MoneyWire;
  readonly verified: MoneyWire;
  readonly outstanding: MoneyWire;
  readonly method: string | null;
  readonly attempts: readonly Attempt[];
  readonly updatedAt: string;
}

const CODE = /^[A-Z_]{2,32}$/;

function obligation(raw: unknown): Obligation {
  const o = object(raw, '$');
  const intent = o.activeIntent === null ? null : object(o.activeIntent, 'activeIntent');
  return {
    obligationId: text(o.obligationId, 'obligationId', UUID),
    revision: integer(o.revision, 'revision'),
    status: text(o.status, 'status', CODE),
    financialStatus: text(o.financialStatus, 'financialStatus', CODE),
    amount: money(o.amount, 'amount'),
    verified: money(o.verified, 'verified'),
    outstanding: money(o.outstanding, 'outstanding'),
    method: intent ? text(intent.method, 'activeIntent.method', CODE) : null,
    attempts: list(o.attempts, 'attempts', (v, p) => {
      const a = object(v, p);
      return {
        attemptId: text(a.attemptId, `${p}.attemptId`, UUID),
        method: text(a.method, `${p}.method`, CODE),
        status: text(a.status, `${p}.status`, CODE),
        reference: text(a.reference, `${p}.reference`, /^…[A-Za-z0-9]{1,8}$/),
        claimed: money(a.claimed, `${p}.claimed`),
        submittedAt: text(a.submittedAt, `${p}.submittedAt`, INSTANT),
        reconciledAt: nullableText(a.reconciledAt, `${p}.reconciledAt`, INSTANT),
      };
    }),
    updatedAt: text(o.updatedAt, 'updatedAt', INSTANT),
  };
}

export function readObligation(obligationId: string): Promise<Result<Obligation>> {
  return request(`/admin/billing/obligations/${encodeURIComponent(obligationId)}`, {
    read: obligation,
  });
}

export function reconcileAttempt(input: {
  readonly attemptId: string;
  readonly expectedRevision: number;
  readonly draft: ReconcileDraft;
  readonly key: string;
}): Promise<Result<Obligation>> {
  return request(
    `/admin/billing/payment-attempts/${encodeURIComponent(input.attemptId)}/reconciliation`,
    {
      method: 'POST',
      body: {
        expectedRevision: input.expectedRevision,
        outcome: input.draft.outcome,
        observedAmount: input.draft.observedAmount,
      },
      idempotencyKey: input.key,
      // Billing answers with the obligation as it stands after the command.
      read: obligation,
    },
  );
}
