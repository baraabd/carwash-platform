import {
  ATTEMPT_STATUSES,
  foldFinanceSummary,
  maskProviderReference,
  type AttemptStatus,
  type CurrencyFinanceSummary,
  type FinanceSummary,
} from '../domain';
import {
  AccessDenied,
  type AccessAuthority,
  type AttemptQueuePosition,
  type AttemptQueueRow,
  type Clock,
  type FinanceReadModel,
  type VerifiedPrincipal,
} from '../ports';
import { FINANCE_READ_PERMISSION } from './billing.service';
import { BillingApplicationError } from './billing-errors';
import { UUID, oneOf, type RequestContext } from './command-support';

/**
 * Admin finance reads (P06-B6): the finance summary and the reconciliation work
 * queue. Staff accounts holding `billing.read` only; deny by default. Views
 * carry no customer subject, no staff subject and no full provider reference.
 */
export const QUEUE_DEFAULT_LIMIT = 50;
export const QUEUE_MAX_LIMIT = 100;
const QUEUE_PARAMS = ['status', 'cursor', 'limit'] as const;
const LIMIT = /^[1-9][0-9]{0,2}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,128}$/;
const POSITION = /^(\d{1,15})\.([0-9a-f-]{36})$/;

/** Opaque to clients; strictly validated when it comes back. */
export function encodeQueueCursor(position: AttemptQueuePosition): string {
  return Buffer.from(`${position.submittedAt.getTime()}.${position.attemptId}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeQueueCursor(cursor: string): AttemptQueuePosition {
  if (!CURSOR.test(cursor)) throw new BillingApplicationError('REQUEST_INVALID');
  const match = POSITION.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  const millis = match ? Number(match[1]) : NaN;
  const attemptId = match?.[2];
  if (!attemptId || !UUID.test(attemptId) || !Number.isSafeInteger(millis))
    throw new BillingApplicationError('REQUEST_INVALID');
  // Re-encoding must reproduce the input exactly: one cursor per position.
  const position = { submittedAt: new Date(millis), attemptId };
  if (encodeQueueCursor(position) !== cursor) throw new BillingApplicationError('REQUEST_INVALID');
  return position;
}

function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BillingApplicationError('REQUEST_INVALID');
  return value;
}

export interface AttemptQueueRequest {
  readonly status: AttemptStatus;
  readonly after: AttemptQueuePosition | null;
  readonly limit: number;
}

/** Closed query: unknown or repeated parameters are refused, never ignored. */
export function parseAttemptQueueQuery(query: unknown): AttemptQueueRequest {
  if (typeof query !== 'object' || query === null || Array.isArray(query))
    throw new BillingApplicationError('REQUEST_INVALID');
  const input = query as Record<string, unknown>;
  if (Object.keys(input).some((name) => !QUEUE_PARAMS.some((allowed) => allowed === name)))
    throw new BillingApplicationError('REQUEST_INVALID');
  const status = oneOf(single(input.status), ATTEMPT_STATUSES, 'status');
  const cursor = single(input.cursor);
  const limitText = single(input.limit);
  if (limitText !== undefined && !LIMIT.test(limitText))
    throw new BillingApplicationError('REQUEST_INVALID', { field: 'limit' });
  const limit = limitText === undefined ? QUEUE_DEFAULT_LIMIT : Number(limitText);
  if (limit > QUEUE_MAX_LIMIT)
    throw new BillingApplicationError('REQUEST_INVALID', { field: 'limit' });
  return { status, after: cursor === undefined ? null : decodeQueueCursor(cursor), limit };
}

function currencyView(summary: CurrencyFinanceSummary): Record<string, unknown> {
  return {
    currency: summary.currency,
    obligations: {
      count: summary.obligations.count,
      byStatus: summary.obligations.byStatus,
      byFinancialStatus: summary.obligations.byFinancialStatus,
      billed: summary.obligations.billed.toWire(),
      verified: summary.obligations.verified.toWire(),
      outstanding: summary.obligations.outstanding.toWire(),
    },
    attempts: summary.attempts,
    cashCustody: {
      inCustody: summary.cashCustody.inCustody.toWire(),
      receiptsByStatus: summary.cashCustody.receiptsByStatus,
      handoversByStatus: summary.cashCustody.handoversByStatus,
    },
    providerCredits: {
      byStatus: summary.providerCredits.byStatus,
      confirmed: summary.providerCredits.confirmed.toWire(),
      awaitingApproval: summary.providerCredits.awaitingApproval.toWire(),
    },
    refunds: {
      byStatus: summary.refunds.byStatus,
      refunded: summary.refunds.refunded.toWire(),
      inFlight: summary.refunds.inFlight.toWire(),
      refundable: summary.refunds.refundable.toWire(),
    },
    ledger: summary.ledger,
  };
}

export function financeSummaryView(summary: FinanceSummary): Record<string, unknown> {
  return {
    asOf: summary.asOf.toISOString(),
    ledgerConsistent: summary.ledgerConsistent,
    currencies: summary.currencies.map(currencyView),
  };
}

export function attemptQueueItemView(row: AttemptQueueRow): Record<string, unknown> {
  return {
    attemptId: row.attemptId,
    obligationId: row.obligationId,
    obligationRevision: row.obligationRevision,
    intentId: row.intentId,
    method: row.method,
    status: row.status,
    reference: maskProviderReference(row.providerReference),
    claimed: row.claimed.toWire(),
    submittedAt: row.submittedAt.toISOString(),
    reconciledAt: row.reconciledAt?.toISOString() ?? null,
  };
}

export class FinanceQueryService {
  constructor(
    private readonly deps: {
      readonly readModel: FinanceReadModel;
      readonly authority: AccessAuthority;
      readonly clock: Clock;
    },
  ) {}

  /** A staff account with `billing.read`; guests never read finance data. */
  private async financeReader(context: RequestContext): Promise<VerifiedPrincipal> {
    let principal: VerifiedPrincipal;
    try {
      principal = await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new BillingApplicationError(error.reason);
      throw new BillingApplicationError('AUTH_UNAVAILABLE');
    }
    if (principal.kind !== 'account' || !principal.permissions.includes(FINANCE_READ_PERMISSION))
      throw new BillingApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  async summary(context: RequestContext): Promise<Record<string, unknown>> {
    await this.financeReader(context);
    const asOf = this.deps.clock.now();
    return financeSummaryView(foldFinanceSummary(await this.deps.readModel.financeFacts(), asOf));
  }

  async attemptQueue(context: RequestContext, query: unknown): Promise<Record<string, unknown>> {
    await this.financeReader(context);
    const request = parseAttemptQueueQuery(query);
    const asOf = this.deps.clock.now();
    const rows = await this.deps.readModel.attemptQueue({
      status: request.status,
      after: request.after,
      limit: request.limit + 1,
    });
    const page = rows.slice(0, request.limit);
    const last = page[page.length - 1];
    return {
      asOf: asOf.toISOString(),
      status: request.status,
      items: page.map(attemptQueueItemView),
      nextCursor:
        rows.length > request.limit && last
          ? encodeQueueCursor({ submittedAt: last.submittedAt, attemptId: last.attemptId })
          : null,
    };
  }
}
