import type { AssignmentState, CapacityResource, JobWindow } from '../domain';

export interface AssignmentCandidate extends CapacityResource {
  readonly technicianSubjectId: string;
  readonly availability: 'AVAILABLE' | 'ON_BREAK';
  readonly availabilityRevision: number;
}
export interface AssignmentCandidates {
  listCandidates(
    job: JobWindow,
    correlationId: string,
    signal?: AbortSignal,
  ): Promise<readonly AssignmentCandidate[]>;
}
export interface AutomaticPolicy {
  readonly assignmentId: string;
  readonly state: 'ACTIVE' | 'PAUSED' | 'EXHAUSTED';
  readonly offeredCount: number;
  readonly failedPasses: number;
  readonly nextAttemptAt: Date;
  readonly reason: string | null;
}
export interface AutomaticTransaction {
  /** Caller already owns the assignment row lock. */
  automaticPolicy(assignmentId: string, now: Date): Promise<AutomaticPolicy>;
  updateAutomaticPolicy(policy: AutomaticPolicy): Promise<void>;
  triedAutomaticResources(assignmentId: string): Promise<readonly string[]>;
  recordAutomaticOffer(
    assignmentId: string,
    resourceId: string,
    offerId: string,
    now: Date,
  ): Promise<void>;
  pauseAutomaticAssignment(assignmentId: string, now: Date): Promise<void>;
  /** Under the resource lock and before changing the assignment. */
  resourceHasOverlap(resourceId: string, assignment: AssignmentState, now: Date): Promise<boolean>;
}
export interface AutomaticReadModel {
  dueAutomaticAssignments(now: Date, limit: number): Promise<readonly AssignmentState[]>;
  activeResourceLoads(
    resourceIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, number>>;
}
