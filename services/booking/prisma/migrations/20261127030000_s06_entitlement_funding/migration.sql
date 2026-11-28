-- Add an explicit financial source. Existing bookings stay DIRECT (both NULL).
ALTER TABLE "booking" ADD COLUMN "subscription_id" UUID;
ALTER TABLE "booking" ADD COLUMN "subscription_revision" INTEGER;
ALTER TABLE "booking" ADD CONSTRAINT "booking_subscription_ref_ck" CHECK (
  (subscription_id IS NULL)=(subscription_revision IS NULL) AND
  (subscription_id IS NULL OR (subscription_revision > 0 AND principal_kind='account')));
ALTER TABLE "booking_saga" ADD COLUMN "entitlement_reservation_id" UUID;
ALTER TABLE "booking_saga" ADD CONSTRAINT "booking_saga_funding_ck" CHECK (
  obligation_id IS NULL OR entitlement_reservation_id IS NULL);
ALTER TABLE "booking_saga" DROP CONSTRAINT "booking_saga_step_ck";
ALTER TABLE "booking_saga" ADD CONSTRAINT "booking_saga_step_ck" CHECK (step IN (
  'VALIDATE_QUOTE','CREATE_OBLIGATION','RESERVE_ENTITLEMENT','COMMIT_HOLD','VOID_OBLIGATION',
  'RELEASE_ENTITLEMENT','DONE','NEEDS_RECONCILIATION'));
ALTER TABLE "booking_saga" DROP CONSTRAINT "booking_saga_pivot_ck";
ALTER TABLE "booking_saga" ADD CONSTRAINT "booking_saga_pivot_ck" CHECK (
  NOT pivot_attempted OR step IN ('COMMIT_HOLD','VOID_OBLIGATION','RELEASE_ENTITLEMENT','DONE','NEEDS_RECONCILIATION'));
ALTER TABLE "booking" DROP CONSTRAINT "booking_rejection_ck";
ALTER TABLE "booking" ADD CONSTRAINT "booking_rejection_ck" CHECK (
  (status='REJECTED')=(rejection_reason IS NOT NULL) AND (rejection_reason IS NULL OR rejection_reason IN (
    'QUOTE_EXPIRED','QUOTE_REVOKED','QUOTE_INVALID','OBLIGATION_REJECTED','ENTITLEMENT_REJECTED',
    'HOLD_EXPIRED','HOLD_UNAVAILABLE','DEADLINE_EXCEEDED')));
ALTER TABLE "booking_saga" DROP CONSTRAINT "booking_saga_rejection_ck";
ALTER TABLE "booking_saga" ADD CONSTRAINT "booking_saga_rejection_ck" CHECK (
  pending_rejection IS NULL OR pending_rejection IN ('QUOTE_EXPIRED','QUOTE_REVOKED','QUOTE_INVALID',
    'OBLIGATION_REJECTED','ENTITLEMENT_REJECTED','HOLD_EXPIRED','HOLD_UNAVAILABLE','DEADLINE_EXCEEDED'));
ALTER TABLE "booking_change" DROP CONSTRAINT "booking_change_settlement_ck";
ALTER TABLE "booking_change" ADD CONSTRAINT "booking_change_settlement_ck" CHECK (
  (kind='RESCHEDULE' AND settlement IS NULL) OR (kind='CANCELLATION' AND settlement IS NOT NULL AND
    settlement IN ('PENDING','VOIDED','REFUND_PENDING','NOTHING_DUE','ENTITLEMENT_RELEASED')));

CREATE FUNCTION "booking_guard_funding"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id OR
     NEW.subscription_revision IS DISTINCT FROM OLD.subscription_revision THEN
    RAISE EXCEPTION 'BOOKING_FUNDING_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "booking_guard_funding"() FROM PUBLIC;
CREATE TRIGGER "booking_guard_funding_update" BEFORE UPDATE ON "booking"
  FOR EACH ROW EXECUTE FUNCTION "booking_guard_funding"();

-- A replayable owner call is queued atomically with real work completion.
CREATE TABLE "booking_entitlement_consumption" (
  booking_id UUID PRIMARY KEY REFERENCES "booking"(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL UNIQUE,
  correlation_id UUID NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by VARCHAR(80), locked_until TIMESTAMPTZ(3),
  consumed_at TIMESTAMPTZ(3), last_error VARCHAR(64),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT booking_entitlement_lease_ck CHECK ((locked_by IS NULL)=(locked_until IS NULL))
);
CREATE INDEX "booking_entitlement_consumption_consumed_at_next_attempt_at_idx"
  ON "booking_entitlement_consumption"(consumed_at,next_attempt_at);

-- Lifecycle projection can have reached ASSIGNED before a valid change request.
CREATE OR REPLACE FUNCTION "booking_guard_change"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR
      NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'BOOKING_CANCELLATION_FINAL' USING ERRCODE='55000';
  END IF;
  IF NEW.schedule_revision<>OLD.schedule_revision AND (NEW.schedule_revision<>OLD.schedule_revision+1 OR
      OLD.status NOT IN ('CONFIRMED','ASSIGNED','EN_ROUTE','ARRIVED')) THEN
    RAISE EXCEPTION 'BOOKING_SCHEDULE_REVISION_INVALID' USING ERRCODE='55000';
  END IF;
  IF NEW.schedule_revision=OLD.schedule_revision AND (NEW.schedule_hold_id IS DISTINCT FROM OLD.schedule_hold_id OR
      NEW.schedule_starts_at IS DISTINCT FROM OLD.schedule_starts_at OR NEW.schedule_ends_at IS DISTINCT FROM OLD.schedule_ends_at) THEN
    RAISE EXCEPTION 'BOOKING_SCHEDULE_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "booking_guard_change"() FROM PUBLIC;
