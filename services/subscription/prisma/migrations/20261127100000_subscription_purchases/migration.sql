CREATE TABLE "subscription_purchase" (
  "id" UUID PRIMARY KEY, "customer_subject" UUID NOT NULL, "subscription_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL, "plan_version" INTEGER NOT NULL, "quote_id" UUID NOT NULL,
  "price_currency" TEXT NOT NULL, "price_minor" BIGINT NOT NULL, "payment_method" TEXT NOT NULL,
  "status" TEXT NOT NULL, "revision" INTEGER NOT NULL, "obligation_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscription_purchase_subscription_id_key" UNIQUE ("subscription_id"),
  CONSTRAINT "subscription_purchase_quote_id_key" UNIQUE ("quote_id"),
  CONSTRAINT "subscription_purchase_obligation_id_key" UNIQUE ("obligation_id"),
  CONSTRAINT "subscription_purchase_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_subscription"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "subscription_purchase_revisions" CHECK ("revision" >= 1 AND "plan_version" >= 1),
  CONSTRAINT "subscription_purchase_money" CHECK ("price_currency" IN ('SYP','USD') AND "price_minor" > 0 AND "price_minor" < 1000000000000000000),
  CONSTRAINT "subscription_purchase_status" CHECK ("status" IN ('PENDING_PAYMENT','PAYMENT_UNDER_REVIEW','PAYMENT_UNKNOWN','ACTIVATED','REJECTED','EXPIRED')),
  CONSTRAINT "subscription_purchase_method" CHECK ("payment_method" IN ('CASH_ON_COMPLETION','SHAM_CASH','SYRIATEL_CASH')),
  CONSTRAINT "subscription_purchase_activation" CHECK ("status" <> 'ACTIVATED' OR "obligation_id" IS NOT NULL)
);
CREATE FUNCTION "app"."subscription_purchase_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'purchase is durable' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."id",NEW."customer_subject",NEW."subscription_id",NEW."plan_id",NEW."plan_version",NEW."quote_id",NEW."price_currency",NEW."price_minor",NEW."payment_method",NEW."created_at")
      IS DISTINCT FROM ROW(OLD."id",OLD."customer_subject",OLD."subscription_id",OLD."plan_id",OLD."plan_version",OLD."quote_id",OLD."price_currency",OLD."price_minor",OLD."payment_method",OLD."created_at")
      OR NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at"
      OR (OLD."obligation_id" IS NOT NULL AND NEW."obligation_id" IS DISTINCT FROM OLD."obligation_id")
      OR OLD."status" IN ('ACTIVATED','REJECTED','EXPIRED') THEN
      RAISE EXCEPTION 'purchase binding or transition invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "app"."customer_subscription" s WHERE s."id"=NEW."subscription_id"
    AND s."customer_subject"=NEW."customer_subject" AND s."plan_code"='p-' || NEW."plan_id"::text
    AND s."plan_revision"=NEW."plan_version" AND s."price_currency"=NEW."price_currency" AND s."price_minor"=NEW."price_minor") THEN
    RAISE EXCEPTION 'purchase must match subscription snapshot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "subscription_purchase_guard" BEFORE INSERT OR UPDATE OR DELETE ON "subscription_purchase"
  FOR EACH ROW EXECUTE FUNCTION "app"."subscription_purchase_guard"();
REVOKE ALL ON FUNCTION "app"."subscription_purchase_guard"() FROM PUBLIC;
