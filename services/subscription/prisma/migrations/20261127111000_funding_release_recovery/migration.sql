-- Cancellation and its recovery obligation commit together, including legacy routes.
CREATE TABLE "subscription_funding_release" (
  "subscription_id" UUID PRIMARY KEY,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "attempt_limit" INTEGER NOT NULL DEFAULT 100,
  "locked_by" UUID,
  "locked_until" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "dead_at" TIMESTAMPTZ(3),
  CONSTRAINT "subscription_funding_release_subscription_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_subscription"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "subscription_funding_release_attempts" CHECK ("attempts">=0 AND "attempt_limit">0),
  CONSTRAINT "subscription_funding_release_lease" CHECK (("locked_by" IS NULL)=("locked_until" IS NULL)),
  CONSTRAINT "subscription_funding_release_terminal" CHECK ("released_at" IS NULL OR ("dead_at" IS NULL AND "locked_by" IS NULL))
);
CREATE INDEX "subscription_funding_release_pending_idx" ON "subscription_funding_release" ("released_at","dead_at","next_attempt_at");
CREATE FUNCTION "app"."subscription_enqueue_funding_release"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW."status"='CANCELLED' AND OLD."status"<>'CANCELLED' THEN
    INSERT INTO "app"."subscription_funding_release" ("subscription_id","correlation_id","created_at","next_attempt_at")
      VALUES (NEW."id",gen_random_uuid(),NEW."updated_at",NEW."updated_at") ON CONFLICT ("subscription_id") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "subscription_enqueue_funding_release" AFTER UPDATE ON "customer_subscription"
  FOR EACH ROW EXECUTE FUNCTION "app"."subscription_enqueue_funding_release"();
REVOKE ALL ON FUNCTION "app"."subscription_enqueue_funding_release"() FROM PUBLIC;
INSERT INTO "subscription_funding_release" ("subscription_id","correlation_id","created_at","next_attempt_at")
  SELECT "id",gen_random_uuid(),"updated_at","updated_at" FROM "customer_subscription" WHERE "status"='CANCELLED';
