/**
 * Catalog revisions form one linear, append-only chain.
 *
 * Revision N is effective in the window [effectiveFrom(N), effectiveFrom(N+1)).
 * Effective dates strictly increase along the chain, so the windows never
 * overlap and the revision in force at any instant is unambiguous. A published
 * revision is never edited; retiring a definition means publishing a new
 * revision without it. Existing quotes and bookings keep their exact revision.
 */

export interface RevisionHead {
  readonly revision: number;
  readonly effectiveFrom: Date;
}

export type PublicationRejection =
  | 'REVISION_CONFLICT'
  | 'EFFECTIVE_FROM_IN_PAST'
  | 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS'
  | 'EFFECTIVE_FROM_TOO_FAR';

export type PublicationPlan =
  | { readonly accepted: true; readonly revision: number; readonly effectiveFrom: Date }
  | { readonly accepted: false; readonly reason: PublicationRejection };

/** A schedule further ahead than this is almost certainly an input error. */
export const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

export function planPublication(input: {
  readonly head: RevisionHead | null;
  readonly expectedRevision: number;
  /** null means "effective immediately", i.e. at the server's current time. */
  readonly effectiveFrom: Date | null;
  readonly now: Date;
}): PublicationPlan {
  const current = input.head?.revision ?? 0;
  if (input.expectedRevision !== current) return { accepted: false, reason: 'REVISION_CONFLICT' };
  const effectiveFrom = input.effectiveFrom ?? input.now;
  if (effectiveFrom.getTime() < input.now.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_IN_PAST' };
  if (effectiveFrom.getTime() - input.now.getTime() > MAX_SCHEDULE_AHEAD_MS)
    return { accepted: false, reason: 'EFFECTIVE_FROM_TOO_FAR' };
  if (input.head && effectiveFrom.getTime() <= input.head.effectiveFrom.getTime())
    return { accepted: false, reason: 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS' };
  return { accepted: true, revision: current + 1, effectiveFrom };
}
