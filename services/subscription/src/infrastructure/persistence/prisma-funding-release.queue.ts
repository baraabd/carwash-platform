import type { FundingReleaseLease, FundingReleaseQueue } from '../../ports';
import type { PrismaClient } from '../../generated/prisma/client';

export class PrismaFundingReleaseQueue implements FundingReleaseQueue {
  constructor(private readonly db: PrismaClient) {}

  async claim(workerId: string, at: Date, limit: number): Promise<FundingReleaseLease[]> {
    // 10 sequential calls at the maximum 5s owner deadline fit the 120s lease.
    const until = new Date(at.getTime() + 120000);
    return this.db.$queryRaw<FundingReleaseLease[]>`
      WITH candidates AS (
        SELECT q.subscription_id FROM app.subscription_funding_release q
        JOIN app.customer_subscription s ON s.id=q.subscription_id
        WHERE s.status='CANCELLED' AND q.released_at IS NULL AND q.dead_at IS NULL
          AND q.next_attempt_at<=${at} AND (q.locked_until IS NULL OR q.locked_until<=${at})
          AND NOT EXISTS (SELECT 1 FROM app.subscription_period p WHERE p.subscription_id=s.id AND p.reserved>0)
        ORDER BY q.next_attempt_at,q.subscription_id FOR UPDATE OF q SKIP LOCKED LIMIT ${limit}
      ), acquired AS (
        UPDATE app.subscription_funding_release q SET attempts=q.attempts+1, locked_by=${workerId}::uuid,
          locked_until=${until}
        FROM candidates c WHERE q.subscription_id=c.subscription_id
        RETURNING q.subscription_id,q.attempts,q.correlation_id
      ) SELECT a.subscription_id AS "subscriptionId",s.customer_subject AS "customerSubject",
          a.correlation_id AS "correlationId",a.attempts AS acquisition,${workerId} AS "workerId"
        FROM acquired a JOIN app.customer_subscription s ON s.id=a.subscription_id`;
  }

  async finish(lease: FundingReleaseLease, at: Date, released: boolean): Promise<boolean> {
    const next = new Date(
      at.getTime() + Math.min(60000, 1000 * 2 ** Math.min(lease.acquisition, 6)),
    );
    const affected = await this.db.$executeRaw`
      UPDATE app.subscription_funding_release SET locked_by=NULL,locked_until=NULL,
        released_at=CASE WHEN ${released} THEN ${at}::timestamptz ELSE NULL END,
        next_attempt_at=${next},dead_at=CASE WHEN NOT ${released} AND attempts>=attempt_limit THEN ${at}::timestamptz ELSE NULL END
      WHERE subscription_id=${lease.subscriptionId}::uuid AND attempts=${lease.acquisition}
        AND locked_by=${lease.workerId}::uuid AND locked_until>${at} AND released_at IS NULL`;
    return affected === 1;
  }
}
