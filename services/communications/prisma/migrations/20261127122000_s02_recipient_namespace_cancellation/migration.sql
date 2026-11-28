ALTER TABLE "notification" ADD COLUMN "recipient_namespace" VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE "notification" ADD CONSTRAINT notification_recipient_namespace_ck
  CHECK (recipient_namespace IN ('CUSTOMER','IDENTITY_ACCOUNT','IDENTITY_GUEST'));
CREATE TABLE "booking_notification_cancellation" (
  booking_id UUID PRIMARY KEY, event_id UUID NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0), cancelled_at TIMESTAMPTZ(3) NOT NULL
);
CREATE FUNCTION "booking_notification_cancellation_immutable"() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'BOOKING_NOTIFICATION_CANCELLATION_IMMUTABLE' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION "booking_notification_cancellation_immutable"() FROM PUBLIC;
CREATE TRIGGER "booking_notification_cancellation_immutable_write"
  BEFORE UPDATE OR DELETE ON "booking_notification_cancellation"
  FOR EACH ROW EXECUTE FUNCTION "booking_notification_cancellation_immutable"();
CREATE TRIGGER "booking_notification_cancellation_immutable_truncate"
  BEFORE TRUNCATE ON "booking_notification_cancellation"
  FOR EACH STATEMENT EXECUTE FUNCTION "booking_notification_cancellation_immutable"();
