import type { EvidenceFenceQueue, LeasedFence } from '../../ports';
import type { PrismaService } from './prisma.service';

/**
 * Delivery queue of Media owner-access fences (table evidence_fence).
 *
 *   FOR UPDATE SKIP LOCKED   - competing workers lease disjoint rows;
 *   locked_by / locked_until - a worker that stalls past its lease cannot
 *                              finalise a row another worker now owns.
 * A confirmed row (fenced_at) is final; the table guard refuses any change.
 */
interface LeasedRow {
  evidence_id: string;
  media_object_id: string;
  attempts: number;
}

export class PrismaEvidenceFenceStore implements EvidenceFenceQueue {
  constructor(private readonly prisma: PrismaService) {}

  async leaseDue(workerId: string, leaseMs: number, limit: number): Promise<LeasedFence[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<LeasedRow[]>(
      `WITH leased AS (
       UPDATE app.evidence_fence AS f
          SET locked_by = $1,
              locked_until = now() + ($2::bigint * interval '1 millisecond'),
              attempts = f.attempts + 1
        WHERE f.evidence_id IN (
          SELECT c.evidence_id
            FROM app.evidence_fence AS c
           WHERE c.fenced_at IS NULL
             AND c.next_attempt_at <= now()
             AND (c.locked_until IS NULL OR c.locked_until < now())
           ORDER BY c.next_attempt_at, c.evidence_id
           FOR UPDATE SKIP LOCKED
           LIMIT $3
        )
      RETURNING f.evidence_id, f.attempts
      )
      SELECT l.evidence_id::text, e.media_object_id::text, l.attempts
        FROM leased l JOIN app.task_evidence e ON e.id = l.evidence_id
       ORDER BY l.evidence_id`,
      workerId,
      leaseMs,
      limit,
    );
    return rows.map((row) => ({
      evidenceId: row.evidence_id,
      mediaObjectId: row.media_object_id,
      attempts: row.attempts,
    }));
  }

  async markFenced(evidenceId: string, workerId: string): Promise<boolean> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.evidence_fence
          SET fenced_at = now(), locked_by = NULL, locked_until = NULL, last_error = NULL
        WHERE evidence_id = $1::uuid AND locked_by = $2 AND fenced_at IS NULL
      RETURNING evidence_id::text AS id`,
      evidenceId,
      workerId,
    );
    return rows.length === 1;
  }

  async markRetry(
    evidenceId: string,
    workerId: string,
    code: string,
    delayMs: number,
  ): Promise<boolean> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.evidence_fence
          SET last_error = $3,
              next_attempt_at = now() + ($4::bigint * interval '1 millisecond'),
              locked_by = NULL,
              locked_until = NULL
        WHERE evidence_id = $1::uuid AND locked_by = $2 AND fenced_at IS NULL
      RETURNING evidence_id::text AS id`,
      evidenceId,
      workerId,
      code.slice(0, 64),
      delayMs,
    );
    return rows.length === 1;
  }

  async countStuck(attempts: number): Promise<number> {
    const [row] = await this.prisma.client.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM app.evidence_fence WHERE fenced_at IS NULL AND attempts >= $1`,
      attempts,
    );
    return row?.n ?? 0;
  }
}
