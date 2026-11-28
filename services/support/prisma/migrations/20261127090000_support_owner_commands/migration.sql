-- Additive reasons shared with Billing's canonical refund workflow. No money or
-- Booking fact is stored here; owner_body keeps the immutable command receipt.
ALTER TABLE "resolution_request"
  DROP CONSTRAINT "resolution_request_reason_known";
ALTER TABLE "resolution_request"
  ADD CONSTRAINT "resolution_request_reason_known" CHECK ("reason_code" IN (
    'PROVIDER_CONFIRMED', 'PROVIDER_AMOUNT_DIFFERS', 'PROVIDER_NO_RECORD',
    'PROVIDER_UNREACHABLE', 'DUPLICATE_PAYMENT', 'SERVICE_NOT_DELIVERED',
    'BOOKING_CANCELLED', 'SERVICE_QUALITY', 'PRICE_CORRECTION',
    'PAID_AFTER_CANCELLATION', 'PAID_AFTER_DEADLINE', 'CUSTOMER_REQUEST',
    'TECHNICIAN_UNAVAILABLE', 'WEATHER_OR_SAFETY', 'OPERATIONAL_ERROR',
    'ALREADY_HANDLED', 'OTHER'));
