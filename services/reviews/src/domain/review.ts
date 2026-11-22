import type { reviewsV1, PrincipalRef } from '@carwash/contracts';

export type Review = reviewsV1.ReviewV1;

export function samePrincipal(left: PrincipalRef, right: PrincipalRef): boolean {
  return left.kind === right.kind && left.subjectId === right.subjectId;
}

/** Consent is immutable evidence of what the author submitted, not a staff-editable grant. */
export function moderate(
  review: Review,
  request: reviewsV1.ModerateReviewRequestV1,
): reviewsV1.ReviewStatus | null {
  if (!review.publicationConsent) return null;
  if (review.status === 'PENDING_MODERATION') {
    if (request.decision === 'PUBLISH') return 'PUBLISHED';
    if (request.decision === 'REJECT') return 'REJECTED';
  }
  if (review.status === 'PUBLISHED' && request.decision === 'HIDE') return 'HIDDEN';
  return null;
}
