import type { OwnerContract } from '../common/route';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  boolean,
  closed,
  integer,
  oneOf,
  optionalText,
  uuid,
} from '../common/wire';

/**
 * reviews.v1 — owner: Reviews service (Lane D). Contract-first (P05-E1); the
 * provider is Lane D's P05-D2 and must conform to this major.
 *
 * Owner rules (not expressible on the wire):
 *  - verified service only: the author must be the Booking's own principal and
 *    the Booking must be COMPLETED by the owner's facts (NOT_REVIEWABLE);
 *  - one review per Booking (REVIEW_ALREADY_SUBMITTED); a replay with the same
 *    key returns the original;
 *  - publication requires the author's explicit consent AND a moderation
 *    decision. Consent is independent of service evidence and of marketing
 *    permission; no consent → the review stays PRIVATE (owner-visible only);
 *  - the comment is free text: it is never put in events, logs or URLs, and is
 *    shown only to its author and to moderators.
 * The before/after media in the approved prototype are illustrative; this
 * contract carries no media reference (Media owns private objects).
 */
export const REVIEWS_V1 = {
  id: 'reviews.v1',
  owner: 'reviews',
  prefix: '/internal/v1/reviews',
  routes: {
    submitReview: { method: 'POST', path: '/reviews', access: 'principal', idempotent: true },
    getBookingReview: {
      method: 'GET',
      path: '/bookings/:bookingId/review',
      access: 'principal',
    },
    listModerationQueue: {
      method: 'GET',
      path: '/moderation/reviews',
      access: 'permission:reviews.moderate',
      paged: true,
    },
    moderateReview: {
      method: 'POST',
      path: '/moderation/reviews/:reviewId/decision',
      access: 'permission:reviews.moderate',
      idempotent: true,
    },
  },
  reasons: ['NOT_REVIEWABLE', 'REVIEW_ALREADY_SUBMITTED', 'REVIEW_NOT_PENDING', 'CONSENT_REQUIRED'],
} as const satisfies OwnerContract;

/**
 * PENDING_MODERATION  consented; awaiting a moderator
 * PRIVATE             no publication consent; visible to author and owner staff only
 * PUBLISHED           consented and approved
 * REJECTED            consented but refused by moderation
 * HIDDEN              was published, later withdrawn by moderation
 */
export const REVIEW_STATUSES = [
  'PENDING_MODERATION',
  'PRIVATE',
  'PUBLISHED',
  'REJECTED',
  'HIDDEN',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const MODERATION_DECISIONS = ['PUBLISH', 'REJECT', 'HIDE'] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];
export const MODERATION_REASONS = [
  'MEETS_GUIDELINES',
  'PERSONAL_DATA',
  'OFFENSIVE',
  'SPAM',
  'NOT_ABOUT_SERVICE',
  'CUSTOMER_WITHDREW_CONSENT',
] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];
export const MAX_REVIEW_COMMENT = 1000;

export interface ReviewV1 {
  readonly reviewId: string;
  readonly revision: number;
  readonly bookingId: string;
  readonly author: PrincipalRef;
  /** 1..5 stars. */
  readonly rating: number;
  readonly comment: string | null;
  readonly publicationConsent: boolean;
  readonly status: ReviewStatus;
  readonly moderationReason: ModerationReason | null;
  readonly submittedAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export function parseReviewV1(value: unknown, path = '$'): ReviewV1 {
  const v = closed(value, path, [
    'reviewId',
    'revision',
    'bookingId',
    'author',
    'rating',
    'comment',
    'publicationConsent',
    'status',
    'moderationReason',
    'submittedAt',
    'updatedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, REVIEW_STATUSES);
  const publicationConsent = boolean(v.publicationConsent, `${path}.publicationConsent`);
  if ((status === 'PRIVATE') === publicationConsent)
    throw new ContractViolation('INCONSISTENT_CONSENT', `${path}.status`);
  const moderationReason =
    v.moderationReason === null
      ? null
      : oneOf(v.moderationReason, `${path}.moderationReason`, MODERATION_REASONS);
  const moderated = status === 'PUBLISHED' || status === 'REJECTED' || status === 'HIDDEN';
  if (moderated !== (moderationReason !== null))
    throw new ContractViolation('INCONSISTENT_MODERATION', `${path}.moderationReason`);
  if (status === 'PUBLISHED' && moderationReason !== 'MEETS_GUIDELINES')
    throw new ContractViolation('INCONSISTENT_MODERATION', `${path}.moderationReason`);
  const submittedAt = parseUtc(v.submittedAt, `${path}.submittedAt`);
  const updatedAt = parseUtc(v.updatedAt, `${path}.updatedAt`);
  if (updatedAt < submittedAt) throw new ContractViolation('TIME_TRAVEL', `${path}.updatedAt`);
  return {
    reviewId: uuid(v.reviewId, `${path}.reviewId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    author: parsePrincipalRef(v.author, `${path}.author`),
    rating: integer(v.rating, `${path}.rating`, 1, 5),
    comment: optionalText(v.comment, `${path}.comment`, { max: MAX_REVIEW_COMMENT }),
    publicationConsent,
    status,
    moderationReason,
    submittedAt,
    updatedAt,
  };
}

/** The author is the verified caller, never a body field. */
export interface SubmitReviewRequestV1 {
  readonly bookingId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly publicationConsent: boolean;
}

export function parseSubmitReviewRequestV1(value: unknown): SubmitReviewRequestV1 {
  const v = closed(value, '$', ['bookingId', 'rating', 'comment', 'publicationConsent']);
  return {
    bookingId: uuid(v.bookingId, '$.bookingId'),
    rating: integer(v.rating, '$.rating', 1, 5),
    comment: optionalText(v.comment, '$.comment', { max: MAX_REVIEW_COMMENT }),
    publicationConsent: boolean(v.publicationConsent, '$.publicationConsent'),
  };
}

export interface ModerateReviewRequestV1 {
  readonly expectedRevision: number;
  readonly decision: ModerationDecision;
  readonly reason: ModerationReason;
}

export function parseModerateReviewRequestV1(value: unknown): ModerateReviewRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'decision', 'reason']);
  const decision = oneOf(v.decision, '$.decision', MODERATION_DECISIONS);
  const reason = oneOf(v.reason, '$.reason', MODERATION_REASONS);
  if ((decision === 'PUBLISH') !== (reason === 'MEETS_GUIDELINES'))
    throw new ContractViolation('INCONSISTENT_MODERATION', '$.reason');
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    decision,
    reason,
  };
}
