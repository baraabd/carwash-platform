/**
 * Which Dispatch command the console offers for an assignment, and the checks
 * it runs before sending one. Dispatch decides; these rules only avoid
 * offering a command Dispatch would certainly refuse.
 */
export const ASSIGNMENT_STATUSES = ['UNASSIGNED', 'OFFERED', 'ASSIGNED', 'CANCELLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export type AssignmentCommand = 'offer' | 'reassign' | 'unassign';

export function allowedCommands(status: AssignmentStatus): readonly AssignmentCommand[] {
  switch (status) {
    case 'UNASSIGNED':
      return ['offer'];
    case 'OFFERED':
      return ['reassign', 'unassign'];
    case 'ASSIGNED':
      return ['reassign', 'unassign'];
    case 'CANCELLED':
      return [];
  }
}

export const STATUS_TONE: Readonly<Record<AssignmentStatus, string>> = {
  UNASSIGNED: 's-amber',
  OFFERED: 's-blue',
  ASSIGNED: 's-green',
  CANCELLED: 's-red',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OfferProblem = 'RESOURCE_REQUIRED' | 'TECHNICIAN_REQUIRED';

export interface OfferDraft {
  readonly resourceId: string;
  readonly technicianSubjectId: string;
}

/** The capacity resource and the technician's Identity subject Dispatch binds the offer to. */
export function validateOffer(input: {
  readonly resourceId: string;
  readonly technicianSubjectId: string;
}): { ok: true; value: OfferDraft } | { ok: false; problems: readonly OfferProblem[] } {
  const resourceId = input.resourceId.trim().toLowerCase();
  const technicianSubjectId = input.technicianSubjectId.trim().toLowerCase();
  const problems: OfferProblem[] = [];
  if (!UUID.test(resourceId)) problems.push('RESOURCE_REQUIRED');
  if (!UUID.test(technicianSubjectId)) problems.push('TECHNICIAN_REQUIRED');
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, value: { resourceId, technicianSubjectId } };
}
