CREATE TABLE "pricing_subscription_quote" (
  "id" UUID PRIMARY KEY, "customer_subject" UUID NOT NULL, "plan_id" UUID NOT NULL,
  "plan_version" INTEGER NOT NULL, "currency" CHAR(3) NOT NULL, "total_minor" BIGINT NOT NULL,
  "plan_content_hash" CHAR(64) NOT NULL, "issued_at" TIMESTAMPTZ(3) NOT NULL, "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pricing_subscription_quote_money" CHECK ("currency" IN ('SYP','USD') AND "total_minor" > 0 AND "total_minor" < 1000000000000000000),
  CONSTRAINT "pricing_subscription_quote_version" CHECK ("plan_version" >= 1),
  CONSTRAINT "pricing_subscription_quote_hash" CHECK ("plan_content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "pricing_subscription_quote_expiry" CHECK ("expires_at" > "issued_at")
);
CREATE FUNCTION "app"."pricing_subscription_quote_immutable"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'subscription quotes are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "pricing_subscription_quote_immutable" BEFORE UPDATE OR DELETE ON "pricing_subscription_quote"
  FOR EACH ROW EXECUTE FUNCTION "app"."pricing_subscription_quote_immutable"();
CREATE TRIGGER "pricing_subscription_quote_no_truncate" BEFORE TRUNCATE ON "pricing_subscription_quote"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."pricing_subscription_quote_immutable"();
REVOKE ALL ON FUNCTION "app"."pricing_subscription_quote_immutable"() FROM PUBLIC;
