ALTER TABLE "subscription_purchase" ADD COLUMN "period_no" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "subscription_purchase" DROP CONSTRAINT "subscription_purchase_subscription_id_key";
ALTER TABLE "subscription_purchase" ADD CONSTRAINT "subscription_purchase_period_key" UNIQUE ("subscription_id","period_no");
ALTER TABLE "subscription_purchase" ADD CONSTRAINT "subscription_purchase_period_positive" CHECK ("period_no">0);

-- Each period has a separate immutable commercial purchase. A price revision
-- published after purchase does not rewrite an accepted quote or historic period.
CREATE OR REPLACE FUNCTION "app"."subscription_purchase_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'purchase is durable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW."id",NEW."customer_subject",NEW."subscription_id",NEW."period_no",NEW."plan_id",NEW."plan_version",NEW."quote_id",NEW."price_currency",NEW."price_minor",NEW."payment_method",NEW."created_at")
      IS DISTINCT FROM ROW(OLD."id",OLD."customer_subject",OLD."subscription_id",OLD."period_no",OLD."plan_id",OLD."plan_version",OLD."quote_id",OLD."price_currency",OLD."price_minor",OLD."payment_method",OLD."created_at")
      OR NEW."revision"<>OLD."revision"+1 OR NEW."updated_at"<OLD."updated_at"
      OR (OLD."obligation_id" IS NOT NULL AND NEW."obligation_id" IS DISTINCT FROM OLD."obligation_id")
      OR OLD."status" IN ('ACTIVATED','REJECTED','EXPIRED') THEN
      RAISE EXCEPTION 'purchase binding or transition invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "app"."customer_subscription" s
    JOIN "app"."subscription_plan_revision" r ON r."plan_code"=s."plan_code" AND r."revision"=NEW."plan_version"
    WHERE s."id"=NEW."subscription_id" AND s."customer_subject"=NEW."customer_subject"
      AND s."plan_code"='p-' || NEW."plan_id"::text
      AND r."price_currency"=NEW."price_currency" AND r."price_minor"=NEW."price_minor") THEN
    RAISE EXCEPTION 'purchase must match immutable plan and beneficiary' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NOT EXISTS (
    SELECT 1 FROM "app"."customer_subscription" s LEFT JOIN "app"."subscription_period" p
      ON p."subscription_id"=s."id" AND p."period_no"=s."current_period_no"
    WHERE s."id"=NEW."subscription_id" AND (
      (NEW."period_no"=1 AND s."status"='PENDING_ACTIVATION' AND s."current_period_no" IS NULL) OR
      (s."status"='ACTIVE' AND NEW."period_no"=s."current_period_no"+1 AND p."ends_at"<=NEW."created_at"))) THEN
    RAISE EXCEPTION 'renewal requires an ended active period' USING ERRCODE='23514';
  END IF;
  IF NEW."status"='ACTIVATED' AND NOT EXISTS (
    SELECT 1 FROM "app"."subscription_period" p WHERE p."subscription_id"=NEW."subscription_id"
      AND p."period_no"=NEW."period_no" AND p."payment_reference"=NEW."obligation_id"
      AND p."plan_revision"=NEW."plan_version") THEN
    RAISE EXCEPTION 'activated purchase requires its own funded period' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE "subscription_audit_event" DROP CONSTRAINT "subscription_audit_event_action";
ALTER TABLE "subscription_audit_event" ADD CONSTRAINT "subscription_audit_event_action" CHECK ("action" IN (
  'subscription.plan.revision-published','subscription.plan.revision-rejected',
  'subscription.requested','subscription.activated','subscription.renewed','subscription.renewal-requested',
  'subscription.frozen','subscription.unfrozen','subscription.cancelled',
  'subscription.change-requested','subscription.change-rejected','subscription.funding-release-retried',
  'subscription.entitlement.reserved','subscription.entitlement.committed',
  'subscription.entitlement.released','subscription.entitlement.reversed'));
