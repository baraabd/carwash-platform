-- Billing owns the irrevocable claim/release fence. No cross-owner foreign keys.
CREATE TABLE "subscription_funding_command" (
  "client_id" VARCHAR(64) NOT NULL,
  "operation" VARCHAR(8) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "correlation_id" UUID NOT NULL,
  PRIMARY KEY ("client_id","operation","idempotency_key"),
  CONSTRAINT "subscription_funding_command_values" CHECK (
    "operation" IN ('CLAIM','RELEASE') AND "idempotency_key" ~ '^[A-Za-z0-9_-]{16,128}$' AND "fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER "subscription_funding_command_immutable" BEFORE UPDATE OR DELETE ON "subscription_funding_command"
  FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "subscription_funding_command_no_truncate" BEFORE TRUNCATE ON "subscription_funding_command"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TABLE "subscription_funding_namespace" (
  "subscription_id" UUID PRIMARY KEY,
  "client_id" VARCHAR(64) NOT NULL,
  "customer_subject" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "released_at" TIMESTAMPTZ(3),
  "correlation_id" UUID NOT NULL,
  CONSTRAINT "subscription_funding_namespace_dates" CHECK ("released_at" IS NULL OR "released_at">="created_at")
);
CREATE TABLE "subscription_funding_claim" (
  "obligation_id" UUID PRIMARY KEY,
  "credit_id" UUID NOT NULL UNIQUE,
  "subscription_id" UUID NOT NULL,
  "period_no" INTEGER NOT NULL,
  "quote_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "claimed_at" TIMESTAMPTZ(3) NOT NULL,
  "released_at" TIMESTAMPTZ(3),
  "correlation_id" UUID NOT NULL,
  CONSTRAINT "subscription_funding_claim_period_key" UNIQUE ("subscription_id","period_no"),
  CONSTRAINT "subscription_funding_claim_namespace_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription_funding_namespace"("subscription_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "subscription_funding_claim_obligation_fkey" FOREIGN KEY ("obligation_id") REFERENCES "billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "subscription_funding_claim_credit_fkey" FOREIGN KEY ("credit_id") REFERENCES "provider_credit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "subscription_funding_claim_values" CHECK ("period_no">0 AND "amount_minor">0 AND "currency" IN ('SYP','USD')),
  CONSTRAINT "subscription_funding_claim_dates" CHECK ("released_at" IS NULL OR "released_at">="claimed_at")
);

CREATE FUNCTION "app"."subscription_funding_namespace_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'funding namespace is durable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW."subscription_id",NEW."client_id",NEW."customer_subject",NEW."created_at",NEW."correlation_id") IS DISTINCT FROM
     ROW(OLD."subscription_id",OLD."client_id",OLD."customer_subject",OLD."created_at",OLD."correlation_id") OR
     OLD."released_at" IS NOT NULL OR NEW."released_at" IS NULL THEN
    RAISE EXCEPTION 'funding namespace transition invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "subscription_funding_namespace_guard" BEFORE UPDATE OR DELETE ON "subscription_funding_namespace"
FOR EACH ROW EXECUTE FUNCTION "app"."subscription_funding_namespace_guard"();

CREATE FUNCTION "app"."subscription_funding_claim_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'funding claim is durable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW."obligation_id",NEW."credit_id",NEW."subscription_id",NEW."period_no",NEW."quote_id",NEW."currency",NEW."amount_minor",NEW."claimed_at",NEW."correlation_id") IS DISTINCT FROM
       ROW(OLD."obligation_id",OLD."credit_id",OLD."subscription_id",OLD."period_no",OLD."quote_id",OLD."currency",OLD."amount_minor",OLD."claimed_at",OLD."correlation_id") OR
       OLD."released_at" IS NOT NULL OR NEW."released_at" IS NULL OR NOT EXISTS (
         SELECT 1 FROM "app"."subscription_funding_namespace" n WHERE n."subscription_id"=NEW."subscription_id" AND n."released_at" IS NOT NULL) THEN
      RAISE EXCEPTION 'funding claim transition invalid' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "app"."provider_credit" WHERE "id"=NEW."credit_id" FOR UPDATE;
  PERFORM 1 FROM "app"."billing_obligation" WHERE "id"=NEW."obligation_id" FOR UPDATE;
  IF NEW."released_at" IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM "app"."subscription_funding_namespace" n
    JOIN "app"."billing_obligation" o ON o."id"=NEW."obligation_id"
    JOIN "app"."provider_credit" c ON c."id"=NEW."credit_id"
    WHERE n."subscription_id"=NEW."subscription_id" AND n."released_at" IS NULL
      AND o."owner_kind"='account' AND o."owner_subject"=n."customer_subject" AND o."quote_id"=NEW."quote_id"
      AND o."status"='SETTLED' AND o."currency"=NEW."currency" AND o."amount_minor"=NEW."amount_minor" AND o."verified_minor"=NEW."amount_minor"
      AND c."obligation_id"=o."id" AND c."status"='ALLOCATED' AND c."currency"=NEW."currency" AND c."amount_minor"=NEW."amount_minor") OR
    EXISTS (SELECT 1 FROM "app"."booking_obligation" WHERE "obligation_id"=NEW."obligation_id") OR
    EXISTS (SELECT 1 FROM "app"."payment_refund" WHERE "credit_id"=NEW."credit_id" AND "status" IN ('REQUESTED','APPROVED','SUBMITTED','UNKNOWN','SUCCEEDED')) THEN
    RAISE EXCEPTION 'funding is unavailable or already refundable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "subscription_funding_claim_guard" BEFORE INSERT OR UPDATE OR DELETE ON "subscription_funding_claim"
FOR EACH ROW EXECUTE FUNCTION "app"."subscription_funding_claim_guard"();

-- Defense in depth for every refund workflow, including a direct runtime write.
CREATE FUNCTION "app"."refund_subscription_funding_fence"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM 1 FROM "app"."provider_credit" WHERE "id"=NEW."credit_id" FOR UPDATE;
  IF NEW."status" IN ('REQUESTED','APPROVED','SUBMITTED','UNKNOWN','SUCCEEDED') AND EXISTS (
    SELECT 1 FROM "app"."subscription_funding_claim" c WHERE c."credit_id"=NEW."credit_id" AND c."released_at" IS NULL) THEN
    RAISE EXCEPTION 'subscription funding must be quiesced before refund' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "refund_subscription_funding_fence" BEFORE INSERT OR UPDATE ON "payment_refund"
FOR EACH ROW EXECUTE FUNCTION "app"."refund_subscription_funding_fence"();
REVOKE ALL ON FUNCTION "app"."subscription_funding_namespace_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_funding_claim_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."refund_subscription_funding_fence"() FROM PUBLIC;
