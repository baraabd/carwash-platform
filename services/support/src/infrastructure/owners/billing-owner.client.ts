import type { OwnerOutcome } from '../../domain';
import {
  OwnerReadError,
  type BillingOwner,
  type ObligationState,
  type OnBehalfOf,
  type OwnerRequest,
} from '../../ports';
import {
  id,
  money,
  ownerGet,
  ownerPost,
  record,
  revision,
  state,
  type OwnerEndpoint,
} from './owner-http';

const BILLING = '/internal/v1/billing';

/**
 * Billing's documented HTTP API (billing.v1, requested from Lane E as
 * CR-D-P02-03), called with the deciding staff member's own credential.
 *
 * Tolerant reader: only ids, revisions, statuses and exact amounts are kept.
 * The masked provider reference, the owner and the cash receipt are dropped.
 */
export class BillingOwnerClient implements BillingOwner {
  constructor(private readonly endpoint: OwnerEndpoint) {}

  async obligation(auth: OnBehalfOf, obligationId: string): Promise<ObligationState | null> {
    const response = await ownerGet(this.endpoint, `${BILLING}/obligations/${obligationId}`, auth);
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403)
      throw new OwnerReadError('OWNER_FORBIDDEN');
    if (response.status !== 200) throw new OwnerReadError('OWNER_UNAVAILABLE');
    return obligationState(response.body);
  }

  execute(auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome> {
    switch (request.operation) {
      case 'billing.reconcile': {
        const { expectedRevision, outcome, observedAmount } = request.body;
        return ownerPost(
          this.endpoint,
          `${BILLING}/payment-attempts/${request.targetId}/reconciliation`,
          auth,
          request.key,
          { expectedRevision, outcome, observedAmount },
          (body) => attemptStatus(body, request.targetId),
        );
      }
      case 'billing.refund':
        // Billing publishes no refund or reversal command yet (CR-D-P04-01).
        // Nothing is sent, so nothing can have happened: BLOCKED_ON_OWNER.
        return Promise.resolve({ kind: 'UNAVAILABLE', code: 'OWNER_CAPABILITY_UNPUBLISHED' });
      default:
        throw new Error('NOT_A_BILLING_OPERATION');
    }
  }
}

function obligationState(body: unknown): ObligationState {
  const o = record(body);
  if (!Array.isArray(o.attempts) || o.attempts.length > 20)
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return {
    obligationId: id(o.obligationId),
    revision: revision(o.revision),
    status: state(o.status),
    financialStatus: state(o.financialStatus),
    amount: money(o.amount),
    verified: money(o.verified),
    outstanding: money(o.outstanding),
    attempts: o.attempts.map((raw: unknown) => {
      const a = record(raw);
      return {
        attemptId: id(a.attemptId),
        status: state(a.status),
        method: state(a.method),
        claimed: money(a.claimed),
      };
    }),
  };
}

function attemptStatus(body: unknown, attemptId: string): string | null {
  try {
    return obligationState(body).attempts.find((a) => a.attemptId === attemptId)?.status ?? null;
  } catch {
    return null;
  }
}
