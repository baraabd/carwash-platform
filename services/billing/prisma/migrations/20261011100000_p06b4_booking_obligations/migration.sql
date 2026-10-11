-- P06-B4: booking-saga obligations (billing.v1 createBookingObligation and
-- voidBookingObligation, access service:billing.obligation.write).
-- Applied by the migration identity (cw_billing_migrate) as a separate job.
-- Application replicas never run this file.
--
-- Expand-only with respect to P03-B1 code:
--   * one new table; no existing column, constraint or row changes;
--   * the three COMMIT-time ledger check functions become SECURITY DEFINER
--     (see "Runtime write defect" below); their bodies are unchanged.
-- Rollback before any booking link exists: revert the code, then drop the new
-- table, its triggers and functions in reverse order. After links exist the
-- table is a financial fact (which workload created/voided an obligation) and
-- needs a reviewed data plan; never drop it silently.

-- Booking links ---------------------------------------------------------------
-- One obligation per booking and one booking per obligation. The workload that
-- created it and the correlation IDs make every saga step diagnosable; the
-- obligation's own audit rows name the beneficiary on whose behalf it acted.
CREATE TABLE "app"."booking_obligation" (
    "booking_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "created_correlation_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_correlation_id" UUID,

    CONSTRAINT "booking_obligation_pkey" PRIMARY KEY ("booking_id"),
    CONSTRAINT "booking_obligation_client_id" CHECK ("client_id" ~ '^[a-z][a-z0-9-]{1,63}$'),
    CONSTRAINT "booking_obligation_void_facts" CHECK (("voided_at" IS NULL) = ("voided_correlation_id" IS NULL)),
    CONSTRAINT "booking_obligation_times" CHECK ("voided_at" IS NULL OR "voided_at" >= "created_at")
);
CREATE UNIQUE INDEX "booking_obligation_obligation_id_key" ON "app"."booking_obligation"("obligation_id");
ALTER TABLE "app"."booking_obligation" ADD CONSTRAINT "booking_obligation_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A link is born with its obligation: same transaction, OPEN, first revision,
-- never voided. An obligation created through the customer route can never be
-- adopted by a booking afterwards.
CREATE FUNCTION "app"."billing_guard_booking_link_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."voided_at" IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM "app"."billing_obligation" o
         WHERE o."id" = NEW."obligation_id" AND o."status" = 'OPEN' AND o."revision" = 1
           AND o.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'BOOKING_LINK_INVALID_INSERT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- The only change ever allowed is the single void stamp, and only once the
-- obligation itself is VOIDED.
CREATE FUNCTION "app"."billing_guard_booking_link_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."booking_id" <> OLD."booking_id" OR NEW."obligation_id" <> OLD."obligation_id"
       OR NEW."client_id" <> OLD."client_id" OR NEW."created_at" <> OLD."created_at"
       OR NEW."created_correlation_id" <> OLD."created_correlation_id" THEN
        RAISE EXCEPTION 'BOOKING_LINK_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF OLD."voided_at" IS NOT NULL OR NEW."voided_at" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "app"."billing_obligation" o
         WHERE o."id" = NEW."obligation_id" AND o."status" = 'VOIDED'
    ) THEN
        RAISE EXCEPTION 'BOOKING_LINK_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_obligation_guard_insert" BEFORE INSERT ON "app"."booking_obligation" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_booking_link_insert"();
CREATE TRIGGER "booking_obligation_guard_update" BEFORE UPDATE ON "app"."booking_obligation" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_booking_link_update"();
CREATE TRIGGER "booking_obligation_no_delete" BEFORE DELETE ON "app"."booking_obligation" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "booking_obligation_no_truncate" BEFORE TRUNCATE ON "app"."booking_obligation" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();

REVOKE ALL ON FUNCTION "app"."billing_guard_booking_link_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_booking_link_update"() FROM PUBLIC;

-- Runtime write defect -----------------------------------------------------------
-- 5503125 revoked PUBLIC EXECUTE on the billing_assert_* helpers that the
-- COMMIT-time constraint triggers PERFORM. Trigger functions run with the
-- privileges of the writing role, so every runtime obligation write failed with
-- "permission denied". The three callers become SECURITY DEFINER (owned by the
-- migration identity). They only raise, keep their pinned search_path
-- (pg_catalog, pg_temp) and cannot be called directly (EXECUTE stays revoked
-- from PUBLIC). The open P04-B1 change applies the same end state; both orders
-- converge.
ALTER FUNCTION "app"."billing_check_obligation_ledger"() SECURITY DEFINER;
ALTER FUNCTION "app"."billing_check_custody_holder"() SECURITY DEFINER;
ALTER FUNCTION "app"."billing_check_handover"() SECURITY DEFINER;
