-- Additive owner-local ingress evidence. Historical attempts keep NULL rather
-- than inventing which connector/account submitted them.
ALTER TABLE "delivery_attempt" ADD COLUMN "connector_id" VARCHAR(64);
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_connector_id_ck"
  CHECK (connector_id IS NULL OR connector_id ~ '^[a-z][a-z0-9._-]{0,63}$');

CREATE TABLE "notification_receipt" (
  "connector_id" VARCHAR(64) NOT NULL,
  "receipt_id" VARCHAR(128) NOT NULL,
  "notification_id" UUID NOT NULL,
  "provider_message_id" VARCHAR(128) NOT NULL,
  "receipt" VARCHAR(9) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "signed_at" TIMESTAMPTZ(3) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL,
  "result" VARCHAR(7) NOT NULL,
  CONSTRAINT "notification_receipt_pkey" PRIMARY KEY ("connector_id", "receipt_id"),
  CONSTRAINT "notification_receipt_connector_id_ck" CHECK (connector_id ~ '^[a-z][a-z0-9._-]{0,63}$'),
  CONSTRAINT "notification_receipt_id_ck" CHECK (receipt_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  CONSTRAINT "notification_receipt_message_id_ck" CHECK (provider_message_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT "notification_receipt_state_ck" CHECK (receipt IN ('DELIVERED', 'FAILED')),
  CONSTRAINT "notification_receipt_hash_ck" CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "notification_receipt_result_ck" CHECK (result IN ('APPLIED', 'IGNORED')),
  CONSTRAINT "notification_receipt_notification_id_fkey" FOREIGN KEY ("notification_id")
    REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "notification_receipt_notification_id_idx" ON "notification_receipt"("notification_id");

CREATE FUNCTION "notification_receipt_immutable"() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'NOTIFICATION_RECEIPT_IMMUTABLE' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION "notification_receipt_immutable"() FROM PUBLIC;
CREATE TRIGGER "notification_receipt_immutable_write"
  BEFORE UPDATE OR DELETE ON "notification_receipt"
  FOR EACH ROW EXECUTE FUNCTION "notification_receipt_immutable"();
CREATE TRIGGER "notification_receipt_immutable_truncate"
  BEFORE TRUNCATE ON "notification_receipt"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_receipt_immutable"();
