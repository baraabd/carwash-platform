import type { ChangeState } from '../../domain';

/**
 * Wire view of a booking change (REQUESTED booking.v1 `BookingChangeV1`,
 * P04-C-interfaces §C3). Saga internals (step, attempts, errors, fences,
 * lease) are never exposed; `attention` only says operations should look.
 */
export function changeView(change: ChangeState) {
  const slot = (s: { holdId: string; zoneId: string; startsAt: Date; endsAt: Date }) => ({
    holdId: s.holdId,
    zoneId: s.zoneId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
  });
  return {
    changeId: change.changeId,
    bookingId: change.bookingId,
    kind: change.kind,
    state: change.outcome ?? 'IN_PROGRESS',
    reason: change.reason,
    refusal: change.refusal,
    attention: change.attention,
    requestedAt: change.createdAt.toISOString(),
    completedAt: change.completedAt?.toISOString() ?? null,
    from: slot(change.from),
    to: change.to === null ? null : slot(change.to),
    settlement: change.settlement,
  };
}
