import { available, viewStatus, type PlanTerms } from '../domain';
import type {
  LedgerView,
  PeriodRecord,
  PlanRevisionRecord,
  ReservationRecord,
  SubscriptionRecord,
} from '../ports';

export function termsView(terms: PlanTerms): Record<string, unknown> {
  return {
    displayName: terms.displayName,
    price: terms.price.toWire(),
    washUnits: terms.washUnits,
    periodDays: terms.periodDays,
    coveredPackageIds: [...terms.coveredPackageIds],
    available: terms.available,
  };
}

export function revisionView(
  revision: PlanRevisionRecord,
  effectiveUntil: Date | null,
): Record<string, unknown> {
  return {
    planCode: revision.planCode,
    revision: revision.revision,
    effectiveFrom: revision.effectiveFrom.toISOString(),
    effectiveUntil: effectiveUntil?.toISOString() ?? null,
    publishedAt: revision.publishedAt.toISOString(),
    terms: termsView(revision.terms),
  };
}

/** Revisions in chain order with each one's effective window. */
export function revisionsView(revisions: readonly PlanRevisionRecord[]): Record<string, unknown>[] {
  const ordered = [...revisions].sort((a, b) => a.revision - b.revision);
  return ordered.map((revision, index) =>
    revisionView(revision, ordered[index + 1]?.effectiveFrom ?? null),
  );
}

function periodView(period: PeriodRecord): Record<string, unknown> {
  return {
    periodNo: period.periodNo,
    planRevision: period.planRevision,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt.toISOString(),
    granted: period.granted,
    reserved: period.reserved,
    consumed: period.consumed,
    available: available(period),
  };
}

/**
 * Customer and staff view. The funding payment reference is shown to staff only
 * (it is an opaque Billing id, but customers have no use for it).
 */
export function subscriptionView(
  subscription: SubscriptionRecord,
  period: PeriodRecord | null,
  now: Date,
  staff: boolean,
): Record<string, unknown> {
  const status = viewStatus(
    {
      status: subscription.status,
      version: subscription.version,
      terms: subscription.terms,
      currentPeriod: period,
    },
    now,
  );
  return {
    subscriptionId: subscription.id,
    customerSubject: subscription.customerSubject,
    planCode: subscription.planCode,
    planRevision: subscription.planRevision,
    status,
    version: subscription.version,
    evaluatedAt: now.toISOString(),
    terms: termsView(subscription.terms),
    period: period
      ? {
          ...periodView(period),
          ...(staff ? { paymentReference: period.paymentReference } : {}),
        }
      : null,
    requestedAt: subscription.requestedAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
    freezeReason: subscription.freezeReason,
    cancelReason: subscription.cancelReason,
  };
}

export function reservationView(reservation: ReservationRecord): Record<string, unknown> {
  return {
    reservationId: reservation.id,
    subscriptionId: reservation.subscriptionId,
    bookingId: reservation.bookingId,
    packageId: reservation.packageId,
    periodNo: reservation.periodNo,
    scheduledFor: reservation.scheduledFor.toISOString(),
    status: reservation.status,
    version: reservation.version,
    reservedAt: reservation.reservedAt.toISOString(),
    settledAt: reservation.settledAt?.toISOString() ?? null,
    reason: reservation.reason,
  };
}

/**
 * Reconciliation view: each period's stored counters against the sum of its
 * append-only movements. `balanced` is false only if storage was tampered with
 * outside the guarded paths (the database refuses such commits).
 */
export function ledgerView(ledger: readonly LedgerView[]): Record<string, unknown> {
  const periods = ledger.map(({ period, movements }) => {
    const sum = movements.reduce(
      (acc, m) => ({
        granted: acc.granted + m.granted,
        reserved: acc.reserved + m.reserved,
        consumed: acc.consumed + m.consumed,
      }),
      { granted: 0, reserved: 0, consumed: 0 },
    );
    return {
      ...periodView(period),
      movements: movements.map((m) => ({
        kind: m.kind,
        reservationId: m.reservationId,
        granted: m.granted,
        reserved: m.reserved,
        consumed: m.consumed,
        occurredAt: m.occurredAt.toISOString(),
        actorKind: m.actor.kind,
      })),
      movementTotals: sum,
      balanced:
        sum.granted === period.granted &&
        sum.reserved === period.reserved &&
        sum.consumed === period.consumed,
    };
  });
  return { periods, balanced: periods.every((p) => p.balanced) };
}
