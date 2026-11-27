import { parsePage, workforceV1 } from '@carwash/contracts';
import type { JobWindow } from '../../domain';
import type { AssignmentCandidate, AssignmentCandidates } from '../../ports';
import type { ServiceHttp } from '../http/service-http';

/** No identity/position is inferred: the Workforce owner publishes this projection. */
export class AssignmentCandidatesClient implements AssignmentCandidates {
  constructor(private readonly http: ServiceHttp) {}
  async listCandidates(
    job: JobWindow,
    correlationId: string,
    signal?: AbortSignal,
  ): Promise<readonly AssignmentCandidate[]> {
    const items: AssignmentCandidate[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    const cursors = new Set<string>();
    for (let page = 0; page < 10; page += 1) {
      if (signal?.aborted) throw new Error('ASSIGNMENT_CANDIDATE_SCAN_ABORTED');
      const query = new URLSearchParams({
        zoneId: job.zoneId,
        from: job.startsAt.toISOString(),
        to: job.endsAt.toISOString(),
        limit: '100',
        ...(cursor === null ? {} : { cursor }),
      });
      const result = await this.http.request(
        'GET',
        `/internal/v1/workforce/assignment-candidates?${query.toString()}`,
        correlationId,
      );
      if (result.kind !== 'ok') throw new Error('ASSIGNMENT_CANDIDATES_UNAVAILABLE');
      const parsed = parsePage(result.body, '$', workforceV1.parseAssignmentCandidateV1);
      for (const candidate of parsed.items) {
        if (seen.has(candidate.resourceId)) throw new Error('DUPLICATE_ASSIGNMENT_CANDIDATE');
        seen.add(candidate.resourceId);
        items.push({
          ...candidate,
          shifts: candidate.shifts.map((shift) => ({
            startsAt: new Date(shift.startsAt),
            endsAt: new Date(shift.endsAt),
          })),
        });
      }
      if (parsed.nextCursor === null) return items;
      if (cursors.has(parsed.nextCursor)) throw new Error('ASSIGNMENT_CANDIDATE_CURSOR_CYCLE');
      cursors.add(parsed.nextCursor);
      cursor = parsed.nextCursor;
    }
    throw new Error('ASSIGNMENT_CANDIDATE_SCAN_LIMIT');
  }
}
