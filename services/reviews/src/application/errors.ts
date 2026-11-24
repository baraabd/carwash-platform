import type { ApiErrorCode } from '@carwash/contracts';

export class ReviewsError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly reason?:
      'NOT_REVIEWABLE' | 'REVIEW_ALREADY_SUBMITTED' | 'REVIEW_NOT_PENDING' | 'CONSENT_REQUIRED',
  ) {
    // Never include a request body, owner response, credential or free-text comment.
    super(code);
    this.name = 'ReviewsError';
  }
}
