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
        if (outcome === 'MATCHED') {
          const { creditId, expectedCreditRevision } = request.body;
          // Old frozen decisions contain no selected credit. Do not silently
          // infer a record or revive the prohibited manual MATCHED command.
          if (typeof creditId !== 'string' || typeof expectedCreditRevision !== 'number')
            return Promise.resolve({ kind: 'UNAVAILABLE', code: 'OWNER_CAPABILITY_UNPUBLISHED' });
          return ownerPost(
            this.endpoint,
            `${BILLING}/payment-attempts/${request.targetId}/statement-credit-allocation`,
            auth,
            request.key,
            { creditId, expectedCreditRevision, expectedRevision, observedAmount },
            (body) => attemptStatus(body, request.targetId),
          );
        }
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
        return this.refund(auth, request);
      default:
        throw new Error('NOT_A_BILLING_OPERATION');
    }
  }

  private async refund(auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome> {
    const { expectedRevision, amount, reasonCode } = request.body;
    const reason = reasonCode === 'PAID_AFTER_CANCELLATION' ? 'BOOKING_CANCELLED' : reasonCode;
    // Never invent a refund reason from an ambiguous historical support decision.
    if (
      ![
        'BOOKING_CANCELLED',
        'SERVICE_NOT_DELIVERED',
        'DUPLICATE_PAYMENT',
        'SERVICE_QUALITY',
        'PRICE_CORRECTION',
      ].includes(String(reason))
    )
      return { kind: 'UNAVAILABLE', code: 'REFUND_REASON_REQUIRED' };
    const selected: { refundId?: string } = {};
    const requested = await ownerPost(
      this.endpoint,
      `${BILLING}/obligations/${request.targetId}/refunds`,
      auth,
      request.key,
      { expectedRevision, amount, reason },
      (body) => {
        const refund = record(body);
        if (id(refund.obligationId) !== request.targetId) return null;
        selected.refundId = id(refund.refundId);
        return state(refund.status);
      },
    );
    const refundId = selected.refundId;
    if (requested.kind !== 'APPLIED' || refundId === undefined) return requested;
    // A replayed request may still carry its original REQUESTED receipt. Read the
    // refund's current fact; Support never records the financial outcome itself.
    try {
      const read = await ownerGet(this.endpoint, `${BILLING}/refunds/${refundId}`, auth);
      if (read.status !== 200) return { kind: 'UNKNOWN', code: 'OWNER_UNAVAILABLE' };
      const refund = record(read.body);
      if (id(refund.refundId) !== refundId || id(refund.obligationId) !== request.targetId)
        return { kind: 'UNKNOWN', code: 'OWNER_INVALID_RESPONSE' };
      const status = state(refund.status);
      if (status === 'SUCCEEDED') return { kind: 'APPLIED', ownerStatus: 200, ownerState: status };
      if (status === 'REQUESTED' || status === 'OUTCOME_UNKNOWN')
        return { kind: 'PENDING', ownerStatus: 200, ownerState: status, code: 'REFUND_PENDING' };
      if (status === 'FAILED') return { kind: 'REJECTED', ownerStatus: 409, code: 'REFUND_FAILED' };
      return { kind: 'UNKNOWN', code: 'OWNER_INVALID_RESPONSE' };
    } catch {
      return { kind: 'UNKNOWN', code: 'OWNER_UNAVAILABLE' };
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
