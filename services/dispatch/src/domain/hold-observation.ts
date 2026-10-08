/**
 * What Dispatch has learned about a Scheduling hold from `scheduling.hold-changed.v1`.
 *
 * Why a COMMITTED hold opens an assignment: in the Booking saga the hold commit
 * is the pivot step. Booking commits the hold only after every compensatable
 * step succeeded, and nothing after the commit can fail permanently (Booking's
 * own confirmation is a local, replayable write). A committed hold therefore
 * means a confirmed booking for exactly that slot, and its `bookingId` is
 * authoritative. A RELEASED or EXPIRED state after that means the slot is gone,
 * so the job is cancelled.
 *
 * Ordering: the envelope's `aggregate.version` is Scheduling's committed hold
 * revision. Dispatch remembers the highest revision it applied per hold and
 * ignores anything not newer, so a redelivered or out-of-order event can never
 * reopen a job whose slot was already released.
 */
export type HoldEventState = 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

export interface HoldObservation {
  readonly holdId: string;
  readonly version: number;
  readonly state: HoldEventState;
}

export type HoldDecision = 'STALE' | 'OPEN' | 'CANCEL' | 'NOTE';

export function decideHoldChange(
  previous: HoldObservation | null,
  event: { readonly version: number; readonly state: HoldEventState },
): HoldDecision {
  if (previous !== null && event.version <= previous.version) return 'STALE';
  switch (event.state) {
    case 'COMMITTED':
      return 'OPEN';
    case 'RELEASED':
    case 'EXPIRED':
      return 'CANCEL';
    case 'HELD':
      return 'NOTE';
  }
}
