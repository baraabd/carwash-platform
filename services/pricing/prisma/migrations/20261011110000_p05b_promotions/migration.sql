-- P05-B2 Pricing promotions: promotions with immutable revisions, the quote
-- discount component, redemption reservations with caps, promotion audit and a
-- transactional outbox. Applied by cw_pricing_migrate only. Expand-only: the
-- single relaxed constraint (quote total may now be below its subtotal) is
-- replaced by an exact COMMIT-time equation over the recorded discount.

-- Promotions -----------------------------------------------------------------
CREATE TABLE "app"."promotion" (
    "code" TEXT NOT NULL,
    "coupon_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID NOT NULL,
    CONSTRAINT "promotion_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "promotion_code" CHECK ("code" ~ '^[a-z][a-z0-9-]{2,40}$'),
    CONSTRAINT "promotion_coupon_digest" CHECK ("coupon_digest" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "promotion_coupon_digest_key" ON "app"."promotion"("coupon_digest");

CREATE TABLE "app"."promotion_revision" (
    "promotion_code" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "discount_kind" TEXT NOT NULL,
    "basis_points" INTEGER,
    "max_discount_minor" BIGINT,
    "fixed_amount_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "package_ids" TEXT[] NOT NULL,
    "min_subtotal_minor" BIGINT NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "total_cap" INTEGER NOT NULL,
    "per_customer_cap" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    CONSTRAINT "promotion_revision_pkey" PRIMARY KEY ("promotion_code", "revision"),
    CONSTRAINT "promotion_revision_promotion_fkey" FOREIGN KEY ("promotion_code")
        REFERENCES "app"."promotion"("code") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "promotion_revision_number" CHECK ("revision" >= 1),
    CONSTRAINT "promotion_revision_not_retroactive" CHECK ("effective_from" >= "published_at"),
    CONSTRAINT "promotion_revision_discount" CHECK (
        ("discount_kind" = 'PERCENT' AND "basis_points" BETWEEN 1 AND 10000 AND "fixed_amount_minor" IS NULL
            AND ("max_discount_minor" IS NULL OR "max_discount_minor" > 0))
        OR ("discount_kind" = 'FIXED' AND "fixed_amount_minor" > 0 AND "basis_points" IS NULL AND "max_discount_minor" IS NULL)),
    CONSTRAINT "promotion_revision_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "promotion_revision_packages" CHECK (
        cardinality("package_ids") BETWEEN 1 AND 50 AND array_position("package_ids", NULL) IS NULL),
    CONSTRAINT "promotion_revision_min_subtotal" CHECK ("min_subtotal_minor" >= 0),
    CONSTRAINT "promotion_revision_caps" CHECK (
        "total_cap" BETWEEN 1 AND 1000000 AND "per_customer_cap" BETWEEN 1 AND 100
        AND "per_customer_cap" <= "total_cap")
);
CREATE UNIQUE INDEX "promotion_revision_effective_key" ON "app"."promotion_revision"("promotion_code", "effective_from");

-- The promotion component of a quote ------------------------------------------
CREATE TABLE "app"."quote_discount" (
    "quote_id" UUID NOT NULL,
    "promotion_code" TEXT NOT NULL,
    "promotion_revision" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    CONSTRAINT "quote_discount_pkey" PRIMARY KEY ("quote_id"),
    CONSTRAINT "quote_discount_quote_fkey" FOREIGN KEY ("quote_id")
        REFERENCES "app"."quote"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "quote_discount_revision_fkey" FOREIGN KEY ("promotion_code", "promotion_revision")
        REFERENCES "app"."promotion_revision"("promotion_code", "revision") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "quote_discount_amount" CHECK ("amount_minor" > 0)
);

ALTER TABLE "app"."quote" DROP CONSTRAINT "quote_total_equals_subtotal";
ALTER TABLE "app"."quote" ADD CONSTRAINT "quote_total_not_above_subtotal" CHECK ("total_minor" <= "subtotal_minor");

-- Redemptions ----------------------------------------------------------------
CREATE TABLE "app"."promotion_redemption" (
    "id" UUID NOT NULL,
    "promotion_code" TEXT NOT NULL,
    "caps_revision" INTEGER NOT NULL,
    "quote_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_subject" UUID NOT NULL,
    "discount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL,
    "reserved_by" TEXT NOT NULL,
    "settled_at" TIMESTAMPTZ(3),
    "settled_by" TEXT,
    "reason" TEXT,
    "correlation_id" UUID NOT NULL,
    "live_slot" SMALLINT,
    CONSTRAINT "promotion_redemption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_redemption_revision_fkey" FOREIGN KEY ("promotion_code", "caps_revision")
        REFERENCES "app"."promotion_revision"("promotion_code", "revision") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "promotion_redemption_quote_fkey" FOREIGN KEY ("quote_id")
        REFERENCES "app"."quote_discount"("quote_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "promotion_redemption_status" CHECK ("status" IN ('RESERVED', 'COMMITTED', 'RELEASED')),
    CONSTRAINT "promotion_redemption_version" CHECK ("version" >= 1),
    CONSTRAINT "promotion_redemption_discount" CHECK ("discount_minor" > 0),
    CONSTRAINT "promotion_redemption_settled" CHECK (
        ("status" = 'RESERVED') = ("settled_at" IS NULL) AND ("settled_at" IS NULL) = ("settled_by" IS NULL)),
    CONSTRAINT "promotion_redemption_reason" CHECK (
        ("status" <> 'RELEASED' AND "reason" IS NULL)
        OR ("status" = 'RELEASED' AND "reason" IN ('BOOKING_CANCELLED', 'BOOKING_FAILED', 'SAGA_COMPENSATION'))),
    -- live_slot is 1 while the use counts against the caps, NULL once released.
    CONSTRAINT "promotion_redemption_live_slot" CHECK (
        ("status" IN ('RESERVED', 'COMMITTED') AND "live_slot" = 1) OR ("status" = 'RELEASED' AND "live_slot" IS NULL))
);
-- Natural idempotency key: promotion + booking. A quote is redeemed at most once,
-- and a booking holds at most one live promotion.
CREATE UNIQUE INDEX "promotion_redemption_booking_key" ON "app"."promotion_redemption"("promotion_code", "booking_id");
CREATE UNIQUE INDEX "promotion_redemption_quote_key" ON "app"."promotion_redemption"("quote_id");
CREATE UNIQUE INDEX "promotion_redemption_live_booking_key" ON "app"."promotion_redemption"("booking_id", "live_slot");
CREATE INDEX "promotion_redemption_live_idx" ON "app"."promotion_redemption"("promotion_code", "customer_subject", "live_slot");

-- Promotion audit and outbox -------------------------------------------------
CREATE TABLE "app"."promotion_audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "promotion_code" TEXT NOT NULL,
    "redemption_id" UUID,
    "outcome" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "promotion_audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_audit_event_actor" CHECK ("actor_kind" IN ('account', 'service')),
    CONSTRAINT "promotion_audit_event_action" CHECK ("action" IN (
        'pricing.promotion.revision-published', 'pricing.promotion.revision-rejected',
        'pricing.promotion.redemption-reserved', 'pricing.promotion.redemption-committed',
        'pricing.promotion.redemption-released'))
);
CREATE INDEX "promotion_audit_event_promotion_idx" ON "app"."promotion_audit_event"("promotion_code", "occurred_at");

CREATE TABLE "app"."outbox_message" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "trace_parent" VARCHAR(55),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_by" TEXT,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "dead_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN ('pricing.promotion-redemption-changed.v1')),
    CONSTRAINT "outbox_message_attempts" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "app"."outbox_message"("event_id");
CREATE INDEX "outbox_message_pending_idx" ON "app"."outbox_message"("published_at", "dead_at", "created_at");

-- Database-enforced invariants ----------------------------------------------
-- No trigger body below calls another function, so all of them can be revoked
-- from PUBLIC (end of file): firing a trigger never needs EXECUTE.

-- Immutable history: promotions, revisions, quote discounts and promotion audit.
CREATE TRIGGER "promotion_immutable" BEFORE UPDATE OR DELETE ON "app"."promotion"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_revision_immutable" BEFORE UPDATE OR DELETE ON "app"."promotion_revision"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "quote_discount_immutable" BEFORE UPDATE OR DELETE ON "app"."quote_discount"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_audit_event_immutable" BEFORE UPDATE OR DELETE ON "app"."promotion_audit_event"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_redemption_no_delete" BEFORE DELETE ON "app"."promotion_redemption"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_no_truncate" BEFORE TRUNCATE ON "app"."promotion"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_revision_no_truncate" BEFORE TRUNCATE ON "app"."promotion_revision"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "quote_discount_no_truncate" BEFORE TRUNCATE ON "app"."quote_discount"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_redemption_no_truncate" BEFORE TRUNCATE ON "app"."promotion_redemption"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "promotion_audit_event_no_truncate" BEFORE TRUNCATE ON "app"."promotion_audit_event"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."pricing_reject_mutation"();

-- A discount is written only by the transaction that created its quote.
CREATE TRIGGER "quote_discount_open_quote" BEFORE INSERT ON "app"."quote_discount"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_require_open_quote"();

-- Revisions form one linear chain per promotion with strictly increasing effective times.
CREATE FUNCTION "app"."pricing_guard_promotion_revision"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    head RECORD;
BEGIN
    SELECT "revision", "effective_from" INTO head FROM "app"."promotion_revision"
     WHERE "promotion_code" = NEW."promotion_code" ORDER BY "revision" DESC LIMIT 1;
    IF NEW."revision" <> COALESCE(head."revision", 0) + 1 THEN
        RAISE EXCEPTION 'PROMOTION_REVISION_NOT_NEXT' USING ERRCODE = 'P0001';
    END IF;
    IF head."revision" IS NOT NULL AND NEW."effective_from" <= head."effective_from" THEN
        RAISE EXCEPTION 'PROMOTION_REVISION_NOT_AFTER_PREVIOUS' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "promotion_revision_guard" BEFORE INSERT ON "app"."promotion_revision"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_guard_promotion_revision"();

-- The quote equation now includes the discount; the original line checks are kept.
CREATE OR REPLACE FUNCTION "app"."pricing_check_quote_consistency"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    line_sum NUMERIC;
    package_lines INTEGER;
    vehicle_lines INTEGER;
    discount NUMERIC;
BEGIN
    SELECT COALESCE(SUM(l."amount_minor"), 0),
           COUNT(*) FILTER (WHERE l."kind" = 'PACKAGE'),
           COUNT(*) FILTER (WHERE l."kind" = 'VEHICLE')
      INTO line_sum, package_lines, vehicle_lines
      FROM "app"."quote_line" l WHERE l."quote_id" = NEW."id";
    IF package_lines <> 1 OR vehicle_lines <> 1 OR line_sum <> NEW."subtotal_minor" THEN
        RAISE EXCEPTION 'QUOTE_LINES_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(SUM(d."amount_minor"), 0) INTO discount
      FROM "app"."quote_discount" d WHERE d."quote_id" = NEW."id";
    IF NEW."total_minor" <> NEW."subtotal_minor" - discount THEN
        RAISE EXCEPTION 'QUOTE_TOTAL_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "app"."price_version" v
         WHERE v."version" = NEW."price_version"
           AND v."catalog_revision" = NEW."catalog_revision"
           AND v."policy_revision" = NEW."policy_revision"
           AND v."currency" = NEW."currency"
           AND v."minor_unit_exponent" = NEW."minor_unit_exponent"
    ) THEN
        RAISE EXCEPTION 'QUOTE_VERSION_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

-- Redemptions: born RESERVED from a discounted quote of the same customer, the
-- discount copied exactly; afterwards only RESERVED -> COMMITTED | RELEASED.
CREATE FUNCTION "app"."pricing_guard_redemption"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'RESERVED' OR NEW."version" <> 1 THEN
            RAISE EXCEPTION 'REDEMPTION_INSERT_NOT_RESERVED' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "app"."quote_discount" d JOIN "app"."quote" q ON q."id" = d."quote_id"
             WHERE d."quote_id" = NEW."quote_id" AND d."promotion_code" = NEW."promotion_code"
               AND d."amount_minor" = NEW."discount_minor" AND q."currency" = NEW."currency"
               AND q."owner_subject" = NEW."customer_subject"
        ) THEN
            RAISE EXCEPTION 'REDEMPTION_QUOTE_MISMATCH' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."promotion_code" <> OLD."promotion_code"
       OR NEW."caps_revision" <> OLD."caps_revision" OR NEW."quote_id" <> OLD."quote_id"
       OR NEW."booking_id" <> OLD."booking_id" OR NEW."customer_subject" <> OLD."customer_subject"
       OR NEW."discount_minor" <> OLD."discount_minor" OR NEW."currency" <> OLD."currency"
       OR NEW."reserved_at" <> OLD."reserved_at" OR NEW."reserved_by" <> OLD."reserved_by" THEN
        RAISE EXCEPTION 'REDEMPTION_IDENTITY_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."version" <> OLD."version" + 1
       OR NOT (OLD."status" = 'RESERVED' AND NEW."status" IN ('COMMITTED', 'RELEASED')) THEN
        RAISE EXCEPTION 'REDEMPTION_TRANSITION_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "promotion_redemption_guard" BEFORE INSERT OR UPDATE ON "app"."promotion_redemption"
    FOR EACH ROW EXECUTE FUNCTION "app"."pricing_guard_redemption"();

-- COMMIT-time caps: live uses never exceed the caps of the revision a
-- redemption was reserved under (the application holds the promotion row lock).
CREATE FUNCTION "app"."pricing_check_redemption_caps"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    caps RECORD;
    live_total INTEGER;
    live_customer INTEGER;
BEGIN
    IF NEW."live_slot" IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT "total_cap", "per_customer_cap" INTO caps FROM "app"."promotion_revision"
     WHERE "promotion_code" = NEW."promotion_code" AND "revision" = NEW."caps_revision";
    SELECT count(*), count(*) FILTER (WHERE "customer_subject" = NEW."customer_subject")
      INTO live_total, live_customer
      FROM "app"."promotion_redemption" WHERE "promotion_code" = NEW."promotion_code" AND "live_slot" = 1;
    IF live_total > caps."total_cap" OR live_customer > caps."per_customer_cap" THEN
        RAISE EXCEPTION 'PROMOTION_CAP_EXCEEDED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "promotion_redemption_caps" AFTER INSERT ON "app"."promotion_redemption"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."pricing_check_redemption_caps"();

-- These trigger functions call no other function, so (like the P01-B ones)
-- they are not executable by PUBLIC or the runtime role; triggers still fire.
REVOKE ALL ON FUNCTION "app"."pricing_guard_promotion_revision"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."pricing_guard_redemption"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."pricing_check_redemption_caps"() FROM PUBLIC;
