import { Money } from '../../domain';
import type {
  SubscriptionFundingClaim,
  SubscriptionFundingNamespace,
  SubscriptionFundingStore,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';

type ClaimRow = Omit<SubscriptionFundingClaim, 'amount'> & {
  currency: string;
  amountMinor: bigint;
};

/** All accesses use the caller's local Billing transaction and credit-first refund fence. */
export class PrismaSubscriptionFundingStore implements SubscriptionFundingStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lockCommand(
    clientId: string,
    operation: 'CLAIM' | 'RELEASE',
    key: string,
  ): Promise<string | null> {
    const lock = JSON.stringify(['subscription-funding-command', clientId, operation, key]);
    await this.tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))::text`;
    const rows = await this.tx.$queryRaw<Array<{ fingerprint: string }>>`
      SELECT fingerprint FROM app.subscription_funding_command
      WHERE client_id=${clientId} AND operation=${operation} AND idempotency_key=${key}`;
    return rows[0]?.fingerprint ?? null;
  }

  async bindCommand(input: {
    clientId: string;
    operation: 'CLAIM' | 'RELEASE';
    key: string;
    fingerprint: string;
    recordedAt: Date;
    correlationId: string;
  }): Promise<void> {
    await this.tx.$executeRaw`INSERT INTO app.subscription_funding_command
      (client_id,operation,idempotency_key,fingerprint,recorded_at,correlation_id)
      VALUES (${input.clientId},${input.operation},${input.key},${input.fingerprint},${input.recordedAt},${input.correlationId}::uuid)`;
  }

  async lockSubscription(subscriptionId: string): Promise<void> {
    await this.tx
      .$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`subscription-funding:${subscriptionId}`}, 0))::text`;
  }

  async namespace(subscriptionId: string): Promise<SubscriptionFundingNamespace | null> {
    const rows = await this.tx.$queryRaw<SubscriptionFundingNamespace[]>`
      SELECT subscription_id AS "subscriptionId", client_id AS "clientId",
        customer_subject AS "customerSubject", created_at AS "createdAt",
        released_at AS "releasedAt", correlation_id AS "correlationId"
      FROM app.subscription_funding_namespace WHERE subscription_id=${subscriptionId}::uuid`;
    return rows[0] ?? null;
  }

  async insertNamespace(record: SubscriptionFundingNamespace): Promise<void> {
    await this.tx.$executeRaw`
      INSERT INTO app.subscription_funding_namespace
        (subscription_id, client_id, customer_subject, created_at, released_at, correlation_id)
      VALUES (${record.subscriptionId}::uuid, ${record.clientId}, ${record.customerSubject}::uuid,
        ${record.createdAt}, ${record.releasedAt}, ${record.correlationId}::uuid)`;
  }

  async releaseNamespace(subscriptionId: string, at: Date): Promise<void> {
    await this.tx.$executeRaw`
      UPDATE app.subscription_funding_namespace SET released_at=${at}
      WHERE subscription_id=${subscriptionId}::uuid AND released_at IS NULL`;
  }

  private toClaim(row: ClaimRow): SubscriptionFundingClaim {
    const { currency, amountMinor, ...claim } = row;
    return { ...claim, amount: Money.of(currency, amountMinor) };
  }

  async forObligation(obligationId: string): Promise<SubscriptionFundingClaim | null> {
    const rows = await this.tx.$queryRaw<ClaimRow[]>`
      SELECT obligation_id AS "obligationId", credit_id AS "creditId",
        subscription_id AS "subscriptionId", period_no AS "periodNo", quote_id AS "quoteId",
        currency, amount_minor AS "amountMinor", claimed_at AS "claimedAt",
        released_at AS "releasedAt", correlation_id AS "correlationId"
      FROM app.subscription_funding_claim WHERE obligation_id=${obligationId}::uuid`;
    return rows[0] ? this.toClaim(rows[0]) : null;
  }

  async forPeriod(
    subscriptionId: string,
    periodNo: number,
  ): Promise<SubscriptionFundingClaim | null> {
    const rows = await this.tx.$queryRaw<ClaimRow[]>`
      SELECT obligation_id AS "obligationId", credit_id AS "creditId",
        subscription_id AS "subscriptionId", period_no AS "periodNo", quote_id AS "quoteId",
        currency, amount_minor AS "amountMinor", claimed_at AS "claimedAt",
        released_at AS "releasedAt", correlation_id AS "correlationId"
      FROM app.subscription_funding_claim WHERE subscription_id=${subscriptionId}::uuid AND period_no=${periodNo}`;
    return rows[0] ? this.toClaim(rows[0]) : null;
  }

  async activeClaims(subscriptionId: string): Promise<SubscriptionFundingClaim[]> {
    const rows = await this.tx.$queryRaw<ClaimRow[]>`
      SELECT obligation_id AS "obligationId", credit_id AS "creditId",
        subscription_id AS "subscriptionId", period_no AS "periodNo", quote_id AS "quoteId",
        currency, amount_minor AS "amountMinor", claimed_at AS "claimedAt",
        released_at AS "releasedAt", correlation_id AS "correlationId"
      FROM app.subscription_funding_claim WHERE subscription_id=${subscriptionId}::uuid AND released_at IS NULL
      ORDER BY credit_id`;
    return rows.map((row) => this.toClaim(row));
  }

  async insertClaim(record: SubscriptionFundingClaim): Promise<void> {
    await this.tx.$executeRaw`
      INSERT INTO app.subscription_funding_claim
        (obligation_id, credit_id, subscription_id, period_no, quote_id, currency, amount_minor,
         claimed_at, released_at, correlation_id)
      VALUES (${record.obligationId}::uuid, ${record.creditId}::uuid, ${record.subscriptionId}::uuid,
        ${record.periodNo}, ${record.quoteId}::uuid, ${record.amount.currency}, ${record.amount.amountMinor},
        ${record.claimedAt}, ${record.releasedAt}, ${record.correlationId}::uuid)`;
  }

  async releaseClaim(obligationId: string, at: Date): Promise<void> {
    await this.tx.$executeRaw`UPDATE app.subscription_funding_claim SET released_at=${at}
      WHERE obligation_id=${obligationId}::uuid AND released_at IS NULL`;
  }
}
