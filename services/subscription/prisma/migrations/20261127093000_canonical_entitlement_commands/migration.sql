CREATE TABLE "subscription_workload_receipt" (
  "client_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "outcome_status" INTEGER NOT NULL,
  "outcome_body" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscription_workload_receipt_pkey" PRIMARY KEY ("client_id", "operation", "idempotency_key"),
  CONSTRAINT "subscription_workload_receipt_key" CHECK ("idempotency_key" ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT "subscription_workload_receipt_fingerprint" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "subscription_workload_receipt_status" CHECK ("outcome_status" BETWEEN 200 AND 499)
);
CREATE TRIGGER "subscription_workload_receipt_immutable" BEFORE UPDATE OR DELETE ON "subscription_workload_receipt"
  FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_workload_receipt_no_truncate" BEFORE TRUNCATE ON "subscription_workload_receipt"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
-- UUIDs are Catalog's canonical identifiers. Existing slug identifiers remain
-- valid on the legacy surface for immutable historical reservations.
ALTER TABLE "entitlement_reservation" DROP CONSTRAINT "entitlement_reservation_package";
ALTER TABLE "entitlement_reservation" ADD CONSTRAINT "entitlement_reservation_package" CHECK (
  "package_id" ~ '^[a-z][a-z0-9-]{1,47}$' OR
  "package_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
