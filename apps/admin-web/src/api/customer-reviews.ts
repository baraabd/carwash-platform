import { parsePage, type Page } from '@carwash/contracts/common';
import {
  parseReviewV1,
  type ReviewV1,
  type ModerateReviewRequestV1,
} from '@carwash/contracts/reviews-v1';
import { request, type Result } from './http';

export function pendingCustomerReviews(cursor?: string): Promise<Result<Page<ReviewV1>>> {
  return request('/admin/customer-reviews', {
    query: { limit: '25', cursor },
    read: (raw) => parsePage(raw, '$', parseReviewV1),
  });
}
export function customerReviewForBooking(bookingId: string): Promise<Result<ReviewV1>> {
  return request(`/admin/bookings/${encodeURIComponent(bookingId)}/customer-review`, {
    read: parseReviewV1,
  });
}
export function moderateCustomerReview(
  reviewId: string,
  body: ModerateReviewRequestV1,
  key: string,
): Promise<Result<ReviewV1>> {
  return request(`/admin/customer-reviews/${encodeURIComponent(reviewId)}/decision`, {
    method: 'POST',
    body,
    idempotencyKey: key,
    read: parseReviewV1,
  });
}
