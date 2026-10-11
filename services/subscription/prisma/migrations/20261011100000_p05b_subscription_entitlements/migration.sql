-- P05-B1 Subscription: plan revisions, customer subscriptions, entitlement
-- periods, reservations, append-only movement ledger, receipts, audit, outbox.
-- Applied by cw_subscription_migrate only. Expand-only on top of the W01 marker.

-- Plans and immutable revisions ---------------------------------------------
CREATE TABLE "app"."subscription_plan" (
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID NOT NULL,
    CONSTRAINT "subscription_plan_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "subscription_plan_code" CHECK ("code" ~ '^[a-z][a-z0-9-]{2,40}$')
);

CREATE TABLE "app"."subscription_plan_revision" (
    "plan_code" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "price_currency" TEXT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "wash_units" INTEGER NOT NULL,
    "period_days" INTEGER NOT NULL,
    "covered_package_ids" TEXT[] NOT NULL,
    "available" BOOLEAN NOT NULL,
    CONSTRAINT "subscription_plan_revision_pkey" PRIMARY KEY ("plan_code", "revision"),
    CONSTRAINT "subscription_plan_revision_plan_fkey" FOREIGN KEY ("plan_code")
        REFERENCES "app"."subscription_plan"("code") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "subscription_plan_revision_number" CHECK ("revision" >= 1),
    CONSTRAINT "subscription_plan_revision_not_before_publish" CHECK ("effective_from" >= "published_at"),
    CONSTRAINT "subscription_plan_revision_name" CHECK (char_length("display_name") BETWEEN 1 AND 80),
    CONSTRAINT "subscription_plan_revision_currency" CHECK ("price_currency" IN ('SYP', 'USD')),
    CONSTRAINT "subscription_plan_revision_price" CHECK ("price_minor" > 0 AND "price_minor" < 1000000000000000000),
    CONSTRAINT "subscription_plan_revision_units" CHECK ("wash_units" BETWEEN 1 AND 100),
    CONSTRAINT "subscription_plan_revision_days" CHECK ("period_days" BETWEEN 1 AND 366),
    CONSTRAINT "subscription_plan_revision_packages" CHECK (
        cardinality("covered_package_ids") BETWEEN 1 AND 20
        AND array_position("covered_package_ids", NULL) IS NULL)
);
CREATE UNIQUE INDEX "subscription_plan_revision_effective_key"
    ON "app"."subscription_plan_revision"("plan_code", "effective_from");

-- Customer subscriptions (terms snapshotted from the funding revision) ---------
CREATE TABLE "app"."customer_subscription" (
    "id" UUID NOT NULL,
    "customer_subject" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "display_name" TEXT NOT NULL,
    "price_currency" TEXT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "wash_units" INTEGER NOT NULL,
    "period_days" INTEGER NOT NULL,
    "covered_package_ids" TEXT[] NOT NULL,
    "available" BOOLEAN NOT NULL,
    "current_period_no" INTEGER,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "freeze_reason" TEXT,
    "cancel_reason" TEXT,
    "open_slot" SMALLINT,
    CONSTRAINT "customer_subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_subscription_revision_fkey" FOREIGN KEY ("plan_code", "plan_revision")
        REFERENCES "app"."subscription_plan_revision"("plan_code", "revision") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "customer_subscription_status" CHECK ("status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'FROZEN', 'CANCELLED')),
    CONSTRAINT "customer_subscription_version" CHECK ("version" >= 1),
    CONSTRAINT "customer_subscription_period" CHECK (
        ("status" = 'PENDING_ACTIVATION' AND "current_period_no" IS NULL)
        OR ("status" IN ('ACTIVE', 'FROZEN') AND "current_period_no" >= 1)
        OR ("status" = 'CANCELLED' AND ("current_period_no" IS NULL OR "current_period_no" >= 1))),
    CONSTRAINT "customer_subscription_freeze" CHECK (
        ("status" = 'FROZEN') = ("freeze_reason" IS NOT NULL)
        AND ("freeze_reason" IS NULL OR "freeze_reason" IN ('CUSTOMER_REQUEST', 'SERVICE_SUSPENDED', 'UNDER_REVIEW'))),
    CONSTRAINT "customer_subscription_cancel" CHECK (
        ("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL)
        AND ("cancel_reason" IS NULL OR "cancel_reason" IN ('CUSTOMER_REQUEST', 'PAYMENT_NOT_RECEIVED', 'RECORDED_IN_ERROR', 'PLAN_WITHDRAWN'))),
    -- open_slot is 1 while open and NULL once cancelled (NULLs never collide in a unique index).
    CONSTRAINT "customer_subscription_open_slot" CHECK (
        ("status" = 'CANCELLED' AND "open_slot" IS NULL) OR ("status" <> 'CANCELLED' AND "open_slot" = 1))
);
-- One open subscription per customer and plan.
CREATE UNIQUE INDEX "customer_subscription_open_key" ON "app"."customer_subscription"("customer_subject", "plan_code", "open_slot");
CREATE INDEX "customer_subscription_customer_idx" ON "app"."customer_subscription"("customer_subject", "requested_at");

-- Entitlement periods --------------------------------------------------------
CREATE TABLE "app"."subscription_period" (
    "subscription_id" UUID NOT NULL,
    "period_no" INTEGER NOT NULL,
    "plan_revision" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "granted" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "consumed" INTEGER NOT NULL,
    "payment_reference" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "subscription_period_pkey" PRIMARY KEY ("subscription_id", "period_no"),
    CONSTRAINT "subscription_period_subscription_fkey" FOREIGN KEY ("subscription_id")
        REFERENCES "app"."customer_subscription"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "subscription_period_number" CHECK ("period_no" >= 1),
    CONSTRAINT "subscription_period_window" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "subscription_period_counters" CHECK (
        "granted" BETWEEN 1 AND 100 AND "reserved" >= 0 AND "consumed" >= 0
        AND "reserved" + "consumed" <= "granted")
);
-- One payment funds exactly one period.
CREATE UNIQUE INDEX "subscription_period_payment_key" ON "app"."subscription_period"("payment_reference");

-- Reservations ---------------------------------------------------------------
CREATE TABLE "app"."entitlement_reservation" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "period_no" INTEGER NOT NULL,
    "booking_id" UUID NOT NULL,
    "package_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL,
    "reserved_by" TEXT NOT NULL,
    "settled_at" TIMESTAMPTZ(3),
    "settled_by" TEXT,
    "reason" TEXT,
    "correlation_id" UUID NOT NULL,
    "live_slot" SMALLINT,
    CONSTRAINT "entitlement_reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entitlement_reservation_period_fkey" FOREIGN KEY ("subscription_id", "period_no")
        REFERENCES "app"."subscription_period"("subscription_id", "period_no") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "entitlement_reservation_status" CHECK ("status" IN ('RESERVED', 'COMMITTED', 'RELEASED', 'REVERSED')),
    CONSTRAINT "entitlement_reservation_version" CHECK ("version" >= 1),
    CONSTRAINT "entitlement_reservation_package" CHECK ("package_id" ~ '^[a-z][a-z0-9-]{1,47}$'),
    CONSTRAINT "entitlement_reservation_settled" CHECK (
        ("status" = 'RESERVED') = ("settled_at" IS NULL) AND ("settled_at" IS NULL) = ("settled_by" IS NULL)),
    CONSTRAINT "entitlement_reservation_reason" CHECK (
        ("status" IN ('RESERVED', 'COMMITTED') AND "reason" IS NULL)
        OR ("status" = 'RELEASED' AND "reason" IN ('BOOKING_CANCELLED', 'BOOKING_FAILED', 'BOOKING_RESCHEDULED_OUTSIDE_PERIOD', 'SAGA_COMPENSATION'))
        OR ("status" = 'REVERSED' AND "reason" IN ('SERVICE_NOT_DELIVERED', 'RECORDED_IN_ERROR', 'GOODWILL'))),
    -- live_slot is 1 while the unit is held or consumed, NULL once released or reversed.
    CONSTRAINT "entitlement_reservation_live_slot" CHECK (
        ("status" IN ('RESERVED', 'COMMITTED') AND "live_slot" = 1)
        OR ("status" IN ('RELEASED', 'REVERSED') AND "live_slot" IS NULL))
);
-- Natural idempotency key of a reservation: subscription + booking.
CREATE UNIQUE INDEX "entitlement_reservation_booking_key" ON "app"."entitlement_reservation"("subscription_id", "booking_id");
-- A booking holds at most one live (reserved or consumed) unit across all subscriptions.
CREATE UNIQUE INDEX "entitlement_reservation_live_booking_key" ON "app"."entitlement_reservation"("booking_id", "live_slot");

-- Append-only movement ledger -------------------------------------------------
CREATE TABLE "app"."entitlement_movement" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "period_no" INTEGER NOT NULL,
    "reservation_id" UUID,
    "kind" TEXT NOT NULL,
    "granted" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "consumed" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    -- Commit-independent total order of the ledger (timestamps can tie).
    "seq" BIGSERIAL NOT NULL,
    CONSTRAINT "entitlement_movement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entitlement_movement_period_fkey" FOREIGN KEY ("subscription_id", "period_no")
        REFERENCES "app"."subscription_period"("subscription_id", "period_no") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "entitlement_movement_reservation_fkey" FOREIGN KEY ("reservation_id")
        REFERENCES "app"."entitlement_reservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "entitlement_movement_actor" CHECK ("actor_kind" IN ('account', 'service')),
    CONSTRAINT "entitlement_movement_delta" CHECK (
        ("kind" = 'GRANT' AND "reservation_id" IS NULL AND "granted" BETWEEN 1 AND 100 AND "reserved" = 0 AND "consumed" = 0)
        OR ("kind" = 'RESERVE' AND "reservation_id" IS NOT NULL AND "granted" = 0 AND "reserved" = 1 AND "consumed" = 0)
        OR ("kind" = 'COMMIT' AND "reservation_id" IS NOT NULL AND "granted" = 0 AND "reserved" = -1 AND "consumed" = 1)
        OR ("kind" = 'RELEASE' AND "reservation_id" IS NOT NULL AND "granted" = 0 AND "reserved" = -1 AND "consumed" = 0)
        OR ("kind" = 'REVERSE' AND "reservation_id" IS NOT NULL AND "granted" = 0 AND "reserved" = 0 AND "consumed" = -1))
);
-- GRANT rows have no reservation (NULLs never collide); a second GRANT for a period
-- cannot balance against its immutable grant (COMMIT-time assertion below).
CREATE UNIQUE INDEX "entitlement_movement_reservation_kind_key" ON "app"."entitlement_movement"("reservation_id", "kind");
CREATE UNIQUE INDEX "entitlement_movement_seq_key" ON "app"."entitlement_movement"("seq");
CREATE INDEX "entitlement_movement_period_idx" ON "app"."entitlement_movement"("subscription_id", "period_no", "occurred_at");

-- Receipts, audit, outbox ----------------------------------------------------
CREATE TABLE "app"."subscription_idempotency_receipt" (
    "actor_subject" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "outcome_status" INTEGER NOT NULL,
    "outcome_body" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "subscription_idempotency_receipt_pkey" PRIMARY KEY ("actor_subject", "operation", "idempotency_key"),
    CONSTRAINT "subscription_idempotency_receipt_status" CHECK ("outcome_status" BETWEEN 200 AND 599)
);

CREATE TABLE "app"."subscription_audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "plan_code" TEXT,
    "subscription_id" UUID,
    "reservation_id" UUID,
    "outcome" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "subscription_audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_audit_event_actor" CHECK ("actor_kind" IN ('account', 'service')),
    CONSTRAINT "subscription_audit_event_action" CHECK ("action" IN (
        'subscription.plan.revision-published', 'subscription.plan.revision-rejected',
        'subscription.requested', 'subscription.activated', 'subscription.renewed',
        'subscription.frozen', 'subscription.unfrozen', 'subscription.cancelled',
        'subscription.entitlement.reserved', 'subscription.entitlement.committed',
        'subscription.entitlement.released', 'subscription.entitlement.reversed'))
);
CREATE INDEX "subscription_audit_event_subscription_idx" ON "app"."subscription_audit_event"("subscription_id", "occurred_at");

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
    CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN (
        'subscription.subscription-changed.v1', 'subscription.entitlement-reserved.v1',
        'subscription.entitlement-reservation-changed.v1')),
    CONSTRAINT "outbox_message_attempts" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "app"."outbox_message"("event_id");
CREATE INDEX "outbox_message_pending_idx" ON "app"."outbox_message"("published_at", "dead_at", "created_at");

-- Database-enforced invariants ----------------------------------------------
-- No trigger body below calls another function, so every function is revoked
-- from PUBLIC at the end of this file: firing a trigger never checks EXECUTE,
-- and no foreign role (nor the runtime role) can call them directly.

CREATE FUNCTION "app"."subscription_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'SUBSCRIPTION_APPEND_ONLY: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- Plans, revisions, ledger, receipts and audit are immutable history.
CREATE TRIGGER "subscription_plan_immutable" BEFORE UPDATE OR DELETE ON "app"."subscription_plan"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_plan_revision_immutable" BEFORE UPDATE OR DELETE ON "app"."subscription_plan_revision"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "entitlement_movement_immutable" BEFORE UPDATE OR DELETE ON "app"."entitlement_movement"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_idempotency_receipt_immutable" BEFORE UPDATE OR DELETE ON "app"."subscription_idempotency_receipt"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_audit_event_immutable" BEFORE UPDATE OR DELETE ON "app"."subscription_audit_event"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
-- Business state rows are never deleted.
CREATE TRIGGER "customer_subscription_no_delete" BEFORE DELETE ON "app"."customer_subscription"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_period_no_delete" BEFORE DELETE ON "app"."subscription_period"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "entitlement_reservation_no_delete" BEFORE DELETE ON "app"."entitlement_reservation"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_plan_no_truncate" BEFORE TRUNCATE ON "app"."subscription_plan"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_plan_revision_no_truncate" BEFORE TRUNCATE ON "app"."subscription_plan_revision"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "customer_subscription_no_truncate" BEFORE TRUNCATE ON "app"."customer_subscription"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_period_no_truncate" BEFORE TRUNCATE ON "app"."subscription_period"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "entitlement_reservation_no_truncate" BEFORE TRUNCATE ON "app"."entitlement_reservation"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "entitlement_movement_no_truncate" BEFORE TRUNCATE ON "app"."entitlement_movement"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();
CREATE TRIGGER "subscription_audit_event_no_truncate" BEFORE TRUNCATE ON "app"."subscription_audit_event"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."subscription_reject_mutation"();

-- Revisions form one linear chain per plan with strictly increasing effective times.
CREATE FUNCTION "app"."subscription_guard_revision_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    head RECORD;
BEGIN
    SELECT "revision", "effective_from" INTO head FROM "app"."subscription_plan_revision"
     WHERE "plan_code" = NEW."plan_code" ORDER BY "revision" DESC LIMIT 1;
    IF NEW."revision" <> COALESCE(head."revision", 0) + 1 THEN
        RAISE EXCEPTION 'PLAN_REVISION_NOT_NEXT' USING ERRCODE = 'P0001';
    END IF;
    IF head."revision" IS NOT NULL AND NEW."effective_from" <= head."effective_from" THEN
        RAISE EXCEPTION 'PLAN_REVISION_NOT_AFTER_PREVIOUS' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "subscription_plan_revision_guard" BEFORE INSERT ON "app"."subscription_plan_revision"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_guard_revision_insert"();

-- A subscription's terms always equal the revision it references (snapshot integrity).
CREATE FUNCTION "app"."subscription_guard_terms"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."subscription_plan_revision" r
         WHERE r."plan_code" = NEW."plan_code" AND r."revision" = NEW."plan_revision"
           AND r."display_name" = NEW."display_name" AND r."price_currency" = NEW."price_currency"
           AND r."price_minor" = NEW."price_minor" AND r."wash_units" = NEW."wash_units"
           AND r."period_days" = NEW."period_days" AND r."covered_package_ids" = NEW."covered_package_ids"
           AND r."available" = NEW."available"
    ) THEN
        RAISE EXCEPTION 'SUBSCRIPTION_TERMS_NOT_REVISION' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'PENDING_ACTIVATION' OR NEW."version" <> 1 OR NEW."current_period_no" IS NOT NULL THEN
            RAISE EXCEPTION 'SUBSCRIPTION_INSERT_NOT_PENDING' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."status" = 'CANCELLED' THEN
        RAISE EXCEPTION 'SUBSCRIPTION_CLOSED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."customer_subject" <> OLD."customer_subject"
       OR NEW."plan_code" <> OLD."plan_code" OR NEW."requested_at" <> OLD."requested_at" THEN
        RAISE EXCEPTION 'SUBSCRIPTION_IDENTITY_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
        RAISE EXCEPTION 'SUBSCRIPTION_VERSION_NOT_NEXT' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (
        (OLD."status" = 'PENDING_ACTIVATION' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
        OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('ACTIVE', 'FROZEN', 'CANCELLED'))
        OR (OLD."status" = 'FROZEN' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
    ) THEN
        RAISE EXCEPTION 'SUBSCRIPTION_TRANSITION_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- A new period is reachable only through activation (null -> 1) or renewal (n -> n+1),
    -- and its period row must have been granted by this same transaction.
    IF NEW."current_period_no" IS DISTINCT FROM OLD."current_period_no" THEN
        IF NEW."current_period_no" IS NULL
           OR NEW."current_period_no" <> COALESCE(OLD."current_period_no", 0) + 1
           OR NEW."status" <> 'ACTIVE'
           OR NOT EXISTS (
               SELECT 1 FROM "app"."subscription_period" p
                WHERE p."subscription_id" = NEW."id" AND p."period_no" = NEW."current_period_no"
                  AND p."plan_revision" = NEW."plan_revision" AND p.xmin = pg_current_xact_id()::xid
           ) THEN
            RAISE EXCEPTION 'SUBSCRIPTION_PERIOD_CHANGE_INVALID' USING ERRCODE = 'P0001';
        END IF;
    ELSIF NEW."plan_revision" <> OLD."plan_revision" AND OLD."status" <> 'PENDING_ACTIVATION' THEN
        RAISE EXCEPTION 'SUBSCRIPTION_TERMS_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_subscription_guard" BEFORE INSERT OR UPDATE ON "app"."customer_subscription"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_guard_terms"();

-- Periods: consecutive, non-overlapping, granted from the subscription's terms, empty at birth;
-- afterwards only the reserved/consumed counters may move.
CREATE FUNCTION "app"."subscription_guard_period"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    previous RECORD;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT "period_no", "ends_at" INTO previous FROM "app"."subscription_period"
         WHERE "subscription_id" = NEW."subscription_id" ORDER BY "period_no" DESC LIMIT 1;
        IF NEW."period_no" <> COALESCE(previous."period_no", 0) + 1 THEN
            RAISE EXCEPTION 'PERIOD_NOT_NEXT' USING ERRCODE = 'P0001';
        END IF;
        IF previous."period_no" IS NOT NULL AND NEW."starts_at" < previous."ends_at" THEN
            RAISE EXCEPTION 'PERIOD_OVERLAP' USING ERRCODE = 'P0001';
        END IF;
        IF NEW."reserved" <> 0 OR NEW."consumed" <> 0 THEN
            RAISE EXCEPTION 'PERIOD_NOT_EMPTY' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "app"."subscription_plan_revision" r
              JOIN "app"."customer_subscription" s ON s."plan_code" = r."plan_code"
             WHERE s."id" = NEW."subscription_id" AND r."revision" = NEW."plan_revision"
               AND r."wash_units" = NEW."granted"
               AND NEW."ends_at" = NEW."starts_at" + make_interval(secs => r."period_days" * 86400)
        ) THEN
            RAISE EXCEPTION 'PERIOD_TERMS_INVALID' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."subscription_id" <> OLD."subscription_id" OR NEW."period_no" <> OLD."period_no"
       OR NEW."plan_revision" <> OLD."plan_revision" OR NEW."starts_at" <> OLD."starts_at"
       OR NEW."ends_at" <> OLD."ends_at" OR NEW."granted" <> OLD."granted"
       OR NEW."payment_reference" <> OLD."payment_reference" OR NEW."granted_by" <> OLD."granted_by"
       OR NEW."granted_at" <> OLD."granted_at" THEN
        RAISE EXCEPTION 'PERIOD_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "subscription_period_guard" BEFORE INSERT OR UPDATE ON "app"."subscription_period"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_guard_period"();

-- Reservations are born RESERVED and move only along the legal transitions.
CREATE FUNCTION "app"."subscription_guard_reservation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'RESERVED' OR NEW."version" <> 1 THEN
            RAISE EXCEPTION 'RESERVATION_INSERT_NOT_RESERVED' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."subscription_id" <> OLD."subscription_id"
       OR NEW."period_no" <> OLD."period_no" OR NEW."booking_id" <> OLD."booking_id"
       OR NEW."package_id" <> OLD."package_id" OR NEW."scheduled_for" <> OLD."scheduled_for"
       OR NEW."reserved_at" <> OLD."reserved_at" OR NEW."reserved_by" <> OLD."reserved_by" THEN
        RAISE EXCEPTION 'RESERVATION_IDENTITY_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."version" <> OLD."version" + 1 OR NOT (
        (OLD."status" = 'RESERVED' AND NEW."status" IN ('COMMITTED', 'RELEASED'))
        OR (OLD."status" = 'COMMITTED' AND NEW."status" = 'REVERSED')
    ) THEN
        RAISE EXCEPTION 'RESERVATION_TRANSITION_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "entitlement_reservation_guard" BEFORE INSERT OR UPDATE ON "app"."entitlement_reservation"
    FOR EACH ROW EXECUTE FUNCTION "app"."subscription_guard_reservation"();

-- COMMIT-time reconciliation: period counters equal the sum of its movements,
-- and every reservation's movements match its status exactly.
-- The assertion is inline (no helper function): a trigger body that calls
-- another function would need EXECUTE for the runtime role (see P04-B1).
CREATE FUNCTION "app"."subscription_check_period"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    stored RECORD;
    summed RECORD;
BEGIN
    SELECT "granted", "reserved", "consumed" INTO stored FROM "app"."subscription_period"
     WHERE "subscription_id" = NEW."subscription_id" AND "period_no" = NEW."period_no";
    SELECT COALESCE(sum("granted"), 0) AS g, COALESCE(sum("reserved"), 0) AS r, COALESCE(sum("consumed"), 0) AS c
      INTO summed FROM "app"."entitlement_movement"
     WHERE "subscription_id" = NEW."subscription_id" AND "period_no" = NEW."period_no";
    IF stored."granted" IS DISTINCT FROM summed.g::int OR stored."reserved" IS DISTINCT FROM summed.r::int
       OR stored."consumed" IS DISTINCT FROM summed.c::int THEN
        RAISE EXCEPTION 'ENTITLEMENT_LEDGER_UNBALANCED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "subscription_period_balanced" AFTER INSERT OR UPDATE ON "app"."subscription_period"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."subscription_check_period"();
CREATE CONSTRAINT TRIGGER "entitlement_movement_balanced" AFTER INSERT ON "app"."entitlement_movement"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."subscription_check_period"();

CREATE FUNCTION "app"."subscription_check_reservation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    rid UUID;
    current_status TEXT;
    expected TEXT[];
    actual TEXT[];
    period_ok BOOLEAN;
BEGIN
    -- Separate statements: PL/pgSQL plans each one against NEW's row type, so a
    -- column of the other table may only appear in the branch that runs.
    IF TG_TABLE_NAME = 'entitlement_movement' THEN
        rid := NEW."reservation_id";
    ELSE
        rid := NEW."id";
    END IF;
    IF rid IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT "status" INTO current_status FROM "app"."entitlement_reservation" WHERE "id" = rid;
    expected := CASE current_status
        WHEN 'RESERVED' THEN ARRAY['RESERVE']
        WHEN 'COMMITTED' THEN ARRAY['COMMIT', 'RESERVE']
        WHEN 'RELEASED' THEN ARRAY['RELEASE', 'RESERVE']
        WHEN 'REVERSED' THEN ARRAY['COMMIT', 'RESERVE', 'REVERSE']
    END;
    SELECT array_agg(m."kind" ORDER BY m."kind"),
           bool_and(m."subscription_id" = r."subscription_id" AND m."period_no" = r."period_no")
      INTO actual, period_ok
      FROM "app"."entitlement_movement" m JOIN "app"."entitlement_reservation" r ON r."id" = m."reservation_id"
     WHERE m."reservation_id" = rid;
    IF actual IS DISTINCT FROM expected OR NOT COALESCE(period_ok, false) THEN
        RAISE EXCEPTION 'RESERVATION_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "entitlement_reservation_matches_ledger" AFTER INSERT OR UPDATE ON "app"."entitlement_reservation"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."subscription_check_reservation"();
CREATE CONSTRAINT TRIGGER "entitlement_movement_matches_reservation" AFTER INSERT ON "app"."entitlement_movement"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."subscription_check_reservation"();

REVOKE ALL ON FUNCTION "app"."subscription_reject_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_guard_revision_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_guard_terms"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_guard_period"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_guard_reservation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_check_period"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."subscription_check_reservation"() FROM PUBLIC;
