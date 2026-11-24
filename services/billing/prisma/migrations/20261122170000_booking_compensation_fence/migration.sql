-- Append-only Billing-owned fence for compensation after an unknown create.
-- No historical rows, monetary balances or existing migration bytes are changed.
CREATE TABLE "app"."booking_compensation" (
    "booking_id" UUID NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "beneficiary_kind" VARCHAR(8) NOT NULL,
    "beneficiary_subject" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "reason" VARCHAR(24) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "obligation_id" UUID,
    "obligation_revision" INTEGER,
    "compensated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "booking_compensation_pkey" PRIMARY KEY ("booking_id"),
    CONSTRAINT "booking_compensation_client_id" CHECK ("client_id" ~ '^[a-z][a-z0-9-]{1,63}$'),
    CONSTRAINT "booking_compensation_beneficiary" CHECK ("beneficiary_kind" IN ('account', 'guest')),
    CONSTRAINT "booking_compensation_reason" CHECK ("reason" = 'BOOKING_FAILED'),
    CONSTRAINT "booking_compensation_outcome" CHECK (
      ("outcome" = 'ABSENT_FENCED' AND "obligation_id" IS NULL AND "obligation_revision" IS NULL)
      OR ("outcome" = 'VOIDED' AND "obligation_id" IS NOT NULL
          AND "obligation_revision" IS NOT NULL AND "obligation_revision" > 0)
    )
);
CREATE UNIQUE INDEX "booking_compensation_obligation_id_key" ON "app"."booking_compensation"("obligation_id");
ALTER TABLE "app"."booking_compensation" ADD CONSTRAINT "booking_compensation_obligation_id_fkey"
  FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The application acquires this same advisory lock before financial writes.
-- The database guard also fences an older writer which only inserts a link.
CREATE FUNCTION "app"."billing_guard_booking_create_fence"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('billing-booking:' || NEW."booking_id"::text, 0));
    IF EXISTS (SELECT 1 FROM "app"."booking_compensation" c WHERE c."booking_id" = NEW."booking_id") THEN
        RAISE EXCEPTION 'BOOKING_COMPENSATED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_booking_compensation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('billing-booking:' || NEW."booking_id"::text, 0));
    IF NEW."outcome" = 'ABSENT_FENCED' THEN
        IF EXISTS (SELECT 1 FROM "app"."booking_obligation" l WHERE l."booking_id" = NEW."booking_id") THEN
            RAISE EXCEPTION 'BOOKING_COMPENSATION_INVALID_ABSENCE' USING ERRCODE = 'P0001';
        END IF;
    ELSIF NOT EXISTS (
        SELECT 1 FROM "app"."booking_obligation" l
        JOIN "app"."billing_obligation" o ON o."id" = l."obligation_id"
        WHERE l."booking_id" = NEW."booking_id" AND l."client_id" = NEW."client_id"
          AND l."obligation_id" = NEW."obligation_id" AND l."voided_at" IS NOT NULL
          AND o."status" = 'VOIDED' AND o."revision" = NEW."obligation_revision"
          AND o."owner_kind" = NEW."beneficiary_kind" AND o."owner_subject" = NEW."beneficiary_subject"
          AND o."quote_id" = NEW."quote_id"
          AND NEW."compensated_at" >= l."voided_at"
    ) THEN
        RAISE EXCEPTION 'BOOKING_COMPENSATION_INVALID_VOID' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_obligation_create_fence" BEFORE INSERT ON "app"."booking_obligation"
  FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_booking_create_fence"();
CREATE TRIGGER "booking_compensation_guard_insert" BEFORE INSERT ON "app"."booking_compensation"
  FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_booking_compensation"();
CREATE TRIGGER "booking_compensation_no_update" BEFORE UPDATE ON "app"."booking_compensation"
  FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "booking_compensation_no_delete" BEFORE DELETE ON "app"."booking_compensation"
  FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "booking_compensation_no_truncate" BEFORE TRUNCATE ON "app"."booking_compensation"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
REVOKE ALL ON FUNCTION "app"."billing_guard_booking_create_fence"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_booking_compensation"() FROM PUBLIC;
