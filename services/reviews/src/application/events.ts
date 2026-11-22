import {
  PRODUCT_EVENT_EXCHANGES,
  REVIEWS_REVIEW_STATUS_CHANGED_V1,
} from '@carwash/event-contracts';
import type { PrincipalRef } from '@carwash/contracts';
import type { Review } from '../domain/review';

export const REVIEWS_EXCHANGE = PRODUCT_EVENT_EXCHANGES.reviews;
export const REVIEW_CHANGED_EVENT = REVIEWS_REVIEW_STATUS_CHANGED_V1.eventType;

/** The published closed event never contains a comment or a Booking owner snapshot. */
export function reviewChangedEvent(
  previous: Review | null,
  next: Review,
  actor: PrincipalRef,
  eventId: string,
  correlationId: string,
): string {
  const spec = REVIEWS_REVIEW_STATUS_CHANGED_V1;
  return JSON.stringify(
    spec.parse({
      eventId,
      eventType: spec.eventType,
      envelopeVersion: 2,
      producer: 'reviews',
      occurredAt: next.updatedAt,
      correlationId,
      causationId: null,
      traceparent: null,
      aggregate: { type: spec.aggregateType, id: next.reviewId, version: next.revision },
      actor: { kind: actor.kind, id: actor.subjectId },
      data: {
        bookingId: next.bookingId,
        rating: next.rating,
        previousStatus: previous?.status ?? null,
        status: next.status,
      },
    }),
  );
}
