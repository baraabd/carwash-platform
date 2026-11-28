CREATE TABLE "subscription_change_request" (
  "id" UUID PRIMARY KEY, "subscription_id" UUID NOT NULL, "expected_revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL, "reason" TEXT NOT NULL, "requested_by" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL, "status" TEXT NOT NULL,
  "decided_by" UUID, "decided_at" TIMESTAMPTZ(3),
  CONSTRAINT "subscription_change_request_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_subscription"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "subscription_change_request_revision" CHECK ("expected_revision">0),
  CONSTRAINT "subscription_change_request_action" CHECK ("action" IN ('FREEZE','RESUME','CANCEL')),
  CONSTRAINT "subscription_change_request_reason" CHECK ("reason" IN ('CUSTOMER_REQUEST','TRAVEL','VEHICLE_UNAVAILABLE','SERVICE_QUALITY','OTHER')),
  CONSTRAINT "subscription_change_request_status" CHECK ("status" IN ('PENDING_REVIEW','APPLIED','REJECTED')),
  CONSTRAINT "subscription_change_request_decision" CHECK (
    ("status"='PENDING_REVIEW' AND "decided_by" IS NULL AND "decided_at" IS NULL) OR
    ("status"<>'PENDING_REVIEW' AND "decided_by" IS NOT NULL AND "decided_at">="requested_at"))
);
CREATE INDEX "subscription_change_pending_idx" ON "subscription_change_request" ("status","requested_at");
CREATE FUNCTION "app"."subscription_change_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'change request is durable' USING ERRCODE='23514'; END IF;
  IF OLD."status"<>'PENDING_REVIEW' OR NEW."status"='PENDING_REVIEW' OR
    ROW(NEW."id",NEW."subscription_id",NEW."expected_revision",NEW."action",NEW."reason",NEW."requested_by",NEW."requested_at")
      IS DISTINCT FROM ROW(OLD."id",OLD."subscription_id",OLD."expected_revision",OLD."action",OLD."reason",OLD."requested_by",OLD."requested_at") THEN
    RAISE EXCEPTION 'change request transition invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "subscription_change_guard" BEFORE UPDATE OR DELETE ON "subscription_change_request"
  FOR EACH ROW EXECUTE FUNCTION "app"."subscription_change_guard"();
REVOKE ALL ON FUNCTION "app"."subscription_change_guard"() FROM PUBLIC;
ALTER TABLE "subscription_audit_event" DROP CONSTRAINT "subscription_audit_event_action";
ALTER TABLE "subscription_audit_event" ADD CONSTRAINT "subscription_audit_event_action" CHECK ("action" IN (
  'subscription.plan.revision-published','subscription.plan.revision-rejected',
  'subscription.requested','subscription.activated','subscription.renewed',
  'subscription.frozen','subscription.unfrozen','subscription.cancelled',
  'subscription.change-requested','subscription.change-rejected',
  'subscription.entitlement.reserved','subscription.entitlement.committed',
  'subscription.entitlement.released','subscription.entitlement.reversed'));
