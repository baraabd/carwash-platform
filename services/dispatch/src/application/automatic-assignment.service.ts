import { createOffer, decideEligibility, markOffered, type AssignmentState } from '../domain';
import type {
  AssignmentCandidate,
  AssignmentCandidates,
  AutomaticPolicy,
  Clock,
  DispatchReadModel,
  DispatchUnitOfWork,
  IdGenerator,
  RequestMeta,
} from '../ports';
import { Effects } from './effects';

export const AUTOMATIC_ASSIGNMENT_LIMITS = {
  maxOffers: 10,
  maxFailedPasses: 20,
  retryMs: 30_000,
  offerTtlSeconds: 120,
} as const;

/** Authoritative eligibility first; deterministic least-active work, then opaque resource id. */
export function rankCandidates(
  job: AssignmentState,
  candidates: readonly AssignmentCandidate[],
  loads: ReadonlyMap<string, number>,
): AssignmentCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.availability === 'AVAILABLE' && decideEligibility(job, candidate, null).eligible,
    )
    .sort(
      (a, b) =>
        (loads.get(a.resourceId) ?? 0) - (loads.get(b.resourceId) ?? 0) ||
        a.resourceId.localeCompare(b.resourceId),
    );
}

/** Durable attempts and policy are owned by Dispatch; process restarts never reset either. */
export class AutomaticAssignmentService {
  private readonly effects: Effects;
  constructor(
    private readonly uow: DispatchUnitOfWork,
    private readonly read: DispatchReadModel,
    private readonly workforce: AssignmentCandidates,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.effects = new Effects(ids);
  }

  async runDue(correlationId: string, limit = 20, signal?: AbortSignal): Promise<number> {
    const jobs = await this.read.dueAutomaticAssignments(this.clock.now(), limit);
    let offered = 0;
    for (const job of jobs) {
      if (signal?.aborted) break;
      let candidates: readonly AssignmentCandidate[];
      try {
        candidates = await this.workforce.listCandidates(job, correlationId, signal);
      } catch {
        if (signal?.aborted) break;
        await this.defer(job, 'DEPENDENCY_UNAVAILABLE', correlationId);
        continue;
      }
      const loads = await this.read.activeResourceLoads(
        candidates.map((item) => item.resourceId),
        this.clock.now(),
      );
      const ranked = rankCandidates(job, candidates, loads);
      let result: 'OFFERED' | 'SKIP' | 'RETRY' = 'RETRY';
      for (const candidate of ranked) {
        if (signal?.aborted) break;
        result = await this.tryOffer(job, candidate, correlationId);
        if (result !== 'RETRY') break;
      }
      if (signal?.aborted) break;
      if (result === 'OFFERED') offered += 1;
      else if (result === 'RETRY')
        await this.defer(
          job,
          ranked.length === 0 ? 'NO_ELIGIBLE_RESOURCE' : 'CANDIDATES_UNAVAILABLE',
          correlationId,
        );
    }
    return offered;
  }

  private async tryOffer(
    seen: AssignmentState,
    candidate: AssignmentCandidate,
    correlationId: string,
  ): Promise<'OFFERED' | 'SKIP' | 'RETRY'> {
    const meta = this.meta(correlationId);
    return this.uow.run(async (tx) => {
      // Exclusive resource lock prevents two automatic workers simultaneously offering
      // overlapping jobs. It shares the eligibility consumer's established lock order.
      const observation = await tx.lockResourceObservation(candidate.resourceId);
      const job = await tx.lockAssignment(seen.id);
      if (
        !job ||
        job.status !== 'UNASSIGNED' ||
        job.version !== seen.version ||
        job.pendingChangeId !== null
      )
        return 'SKIP';
      const now = this.clock.now();
      const policy = await tx.automaticPolicy(job.id, now);
      if (policy.state !== 'ACTIVE' || policy.nextAttemptAt > now) return 'SKIP';
      if (policy.offeredCount >= AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers || job.endsAt <= now) {
        await tx.updateAutomaticPolicy({
          ...policy,
          state: 'EXHAUSTED',
          reason: job.endsAt <= now ? 'WINDOW_ENDED' : 'ATTEMPT_LIMIT',
        });
        return 'SKIP';
      }
      if ((await tx.triedAutomaticResources(job.id)).includes(candidate.resourceId)) return 'RETRY';
      if (
        !decideEligibility(job, candidate, observation).eligible ||
        (await tx.resourceHasOverlap(candidate.resourceId, job, now))
      )
        return 'RETRY';
      const offer = createOffer({
        id: this.ids.next(),
        assignmentId: job.id,
        resourceId: candidate.resourceId,
        technicianSubject: candidate.technicianSubjectId,
        ttlSeconds: AUTOMATIC_ASSIGNMENT_LIMITS.offerTtlSeconds,
        jobEndsAt: job.endsAt,
        createdBy: 'system:automatic-assignment',
        now,
      });
      const next = markOffered(job, now);
      await tx.updateAssignment(next, job.version);
      await tx.insertOffer(offer);
      await tx.recordAutomaticOffer(job.id, candidate.resourceId, offer.id, now);
      await tx.updateAutomaticPolicy({
        ...policy,
        offeredCount: policy.offeredCount + 1,
        failedPasses: 0,
        nextAttemptAt: now,
        reason: null,
      });
      await this.effects.assignmentChanged(tx, next, meta);
      await this.effects.audit(
        tx,
        meta,
        'assignment.automatically-offered',
        { type: 'ASSIGNMENT', id: job.id },
        {
          offerId: offer.id,
          resourceId: candidate.resourceId,
          attempt: policy.offeredCount + 1,
          strategy: 'LEAST_ACTIVE_THEN_RESOURCE_ID',
          eligibilityRevision: candidate.eligibilityRevision,
          availabilityRevision: candidate.availabilityRevision,
        },
      );
      return 'OFFERED';
    });
  }

  private async defer(seen: AssignmentState, reason: string, correlationId: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const job = await tx.lockAssignment(seen.id);
      if (
        !job ||
        job.status !== 'UNASSIGNED' ||
        job.version !== seen.version ||
        job.pendingChangeId !== null
      )
        return;
      const now = this.clock.now();
      const policy = await tx.automaticPolicy(job.id, now);
      if (policy.state !== 'ACTIVE' || policy.nextAttemptAt > now) return;
      const failures = policy.failedPasses + 1;
      const next: AutomaticPolicy = {
        ...policy,
        failedPasses: failures,
        nextAttemptAt: new Date(now.getTime() + AUTOMATIC_ASSIGNMENT_LIMITS.retryMs),
        reason,
        state:
          failures >= AUTOMATIC_ASSIGNMENT_LIMITS.maxFailedPasses ||
          policy.offeredCount >= AUTOMATIC_ASSIGNMENT_LIMITS.maxOffers
            ? 'EXHAUSTED'
            : 'ACTIVE',
      };
      await tx.updateAutomaticPolicy(next);
      if (next.state === 'EXHAUSTED')
        await this.effects.audit(
          tx,
          this.meta(correlationId),
          'assignment.automatic-attention-required',
          { type: 'ASSIGNMENT', id: job.id },
          { reason, offeredCount: next.offeredCount, failedPasses: failures },
        );
    });
  }

  private meta(correlationId: string): RequestMeta {
    return { actor: { kind: 'SYSTEM', component: 'automatic-assignment' }, correlationId };
  }
}
