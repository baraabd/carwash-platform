-- P04-C3: cancellation and reschedule of a confirmed booking (change saga),
-- with the original snapshots kept and every change recorded.
-- Applied by the migration identity (cw_booking_migrate) as a separate job.
--
-- EXPAND ONLY with respect to running code:
--   * new nullable / defaulted columns on booking (cancellation, current
--     schedule); the original slot and every snapshot column stay immutable
--     under the existing booking_guard_immutable trigger;
--   * new tables booking_change and booking_schedule (+ guard triggers);
--   * no existing column, CHECK or index is altered or dropped.
-- No booking was ever CANCELLED before this migration (no code path produced
-- it), so the new cancellation CHECK holds for every existing row.
--
-- Invariants enforced HERE, not only in application code:
--   * CANCELLED <=> a cancellation reason and time; once set they never change;
--   * the schedule revision only grows by one per reschedule, never after a
--     cancellation; one live booking per rescheduled hold (partial UNIQUE);
--   * at most one OPEN change per booking (partial UNIQUE); one change per
--     (requester, Idempotency-Key); a change's request facts never change;
--   * booking_schedule is append-only history; changes are never deleted.

ALTER TABLE "booking"
    ADD COLUMN "cancellation_reason" TEXT,
    ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
    ADD COLUMN "schedule_revision" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "schedule_hold_id" UUID,
    ADD COLUMN "schedule_starts_at" TIMESTAMPTZ(3),
    ADD COLUMN "schedule_ends_at" TIMESTAMPTZ(3);

ALTER TABLE "booking" ADD CONSTRAINT "booking_cancellation_ck" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    AND ("cancelled_at" IS NULL) = ("cancellation_reason" IS NULL)
    AND ("cancellation_reason" IS NULL OR "cancellation_reason" IN (
        'CUSTOMER_REQUEST', 'OPERATIONS_REQUEST', 'CUSTOMER_REQUEST_BY_PHONE', 'SERVICE_UNAVAILABLE'
    ))
);

ALTER TABLE "booking" ADD CONSTRAINT "booking_schedule_ck" CHECK (
    "schedule_revision" >= 1
    AND ("schedule_hold_id" IS NULL) = ("schedule_starts_at" IS NULL)
    AND ("schedule_hold_id" IS NULL) = ("schedule_ends_at" IS NULL)
    AND ("schedule_hold_id" IS NULL) = ("schedule_revision" = 1)
    AND ("schedule_ends_at" IS NULL OR "schedule_ends_at" > "schedule_starts_at")
    AND ("schedule_hold_id" IS NULL OR "slot_starts_at" IS NOT NULL)
);

-- A rescheduled hold belongs to one live booking, like the original hold.
CREATE UNIQUE INDEX "booking_live_schedule_hold_key" ON "booking"("schedule_hold_id")
    WHERE "schedule_hold_id" IS NOT NULL AND "status" <> 'REJECTED';

CREATE TABLE "booking_change" (
    "change_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "outcome" TEXT,
    "reason" TEXT,
    "refusal" TEXT,
    "requester_kind" TEXT NOT NULL,
    "requester_subject" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "from_hold_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "from_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "from_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "to_hold_id" UUID,
    "to_hold_revision" INTEGER,
    "to_starts_at" TIMESTAMPTZ(3),
    "to_ends_at" TIMESTAMPTZ(3),
    "to_expires_at" TIMESTAMPTZ(3),
    "settlement" TEXT,
    "pivot_attempted" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(64),
    "attention" BOOLEAN NOT NULL DEFAULT false,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" VARCHAR(80),
    "lease_until" TIMESTAMPTZ(3),
    "correlation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "booking_change_pkey" PRIMARY KEY ("change_id"),
    CONSTRAINT "booking_change_kind_ck" CHECK ("kind" IN ('CANCELLATION', 'RESCHEDULE')),
    CONSTRAINT "booking_change_step_ck" CHECK (
        ("kind" = 'CANCELLATION' AND "step" IN ('DISPATCH_CANCEL', 'RELEASE_CAPACITY', 'SETTLE_BILLING', 'DONE'))
        OR ("kind" = 'RESCHEDULE' AND "step" IN (
            'DISPATCH_REBIND', 'REPLACE_COMMITMENT', 'DISPATCH_CONFIRM', 'DISPATCH_REVERT', 'DONE'
        ))
    ),
    CONSTRAINT "booking_change_outcome_ck" CHECK (
        ("step" = 'DONE') = ("outcome" IS NOT NULL)
        AND ("step" = 'DONE') = ("completed_at" IS NOT NULL)
        AND ("outcome" IS NULL OR "outcome" IN ('COMPLETED', 'REFUSED', 'FAILED'))
        AND ("outcome" <> 'COMPLETED' OR "refusal" IS NULL)
        AND ("outcome" NOT IN ('REFUSED', 'FAILED') OR "refusal" IS NOT NULL)
    ),
    CONSTRAINT "booking_change_refusal_ck" CHECK (
        "refusal" IS NULL OR "refusal" IN (
            'WORK_STARTED', 'WORK_COMPLETED', 'BOOKING_CANCELLED', 'HOLD_EXPIRED',
            'HOLD_NOT_ACTIVE', 'HOLD_UNAVAILABLE', 'DISPATCH_NOT_READY'
        )
    ),
    CONSTRAINT "booking_change_reason_ck" CHECK (
        ("kind" = 'CANCELLATION') = ("reason" IS NOT NULL)
        AND ("reason" IS NULL OR "reason" IN (
            'CUSTOMER_REQUEST', 'OPERATIONS_REQUEST', 'CUSTOMER_REQUEST_BY_PHONE', 'SERVICE_UNAVAILABLE'
        ))
        -- Customers give CUSTOMER_REQUEST only; the staff reasons are staff-only.
        AND ("reason" IS NULL OR ("requester_kind" = 'staff') = ("reason" <> 'CUSTOMER_REQUEST'))
    ),
    CONSTRAINT "booking_change_requester_ck" CHECK (
        "requester_kind" IN ('account', 'guest', 'staff')
        AND ("kind" = 'CANCELLATION' OR "requester_kind" <> 'staff')
    ),
    CONSTRAINT "booking_change_target_ck" CHECK (
        ("kind" = 'RESCHEDULE') = ("to_hold_id" IS NOT NULL)
        AND ("to_hold_id" IS NULL) = ("to_hold_revision" IS NULL)
        AND ("to_hold_id" IS NULL) = ("to_starts_at" IS NULL)
        AND ("to_hold_id" IS NULL) = ("to_ends_at" IS NULL)
        AND ("to_hold_id" IS NULL) = ("to_expires_at" IS NULL)
        AND ("to_hold_id" IS NULL OR "to_hold_id" <> "from_hold_id")
        AND ("to_ends_at" IS NULL OR "to_ends_at" > "to_starts_at")
        AND "from_ends_at" > "from_starts_at"
    ),
    CONSTRAINT "booking_change_settlement_ck" CHECK (
        "settlement" IS NULL OR (
            "kind" = 'CANCELLATION'
            AND "settlement" IN ('PENDING', 'VOIDED', 'REFUND_PENDING', 'NOTHING_DUE')
        )
    ),
    CONSTRAINT "booking_change_counts_ck" CHECK (
        "attempts" >= 0 AND "fence" >= 0 AND "version" >= 1
        AND ("to_hold_revision" IS NULL OR "to_hold_revision" >= 1)
    ),
    CONSTRAINT "booking_change_key_ck" CHECK ("idempotency_key" ~ '^[A-Za-z0-9_-]{16,128}$')
);

ALTER TABLE "booking_change" ADD CONSTRAINT "booking_change_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- One open change per booking.
CREATE UNIQUE INDEX "booking_change_one_open_key" ON "booking_change"("booking_id")
    WHERE "outcome" IS NULL;
-- One change per (requester, Idempotency-Key).
CREATE UNIQUE INDEX "booking_change_request_key"
    ON "booking_change"("requester_kind", "requester_subject", "idempotency_key");
CREATE INDEX "booking_change_booking_created_idx" ON "booking_change"("booking_id", "created_at");
-- Due, unfinished changes for the worker.
CREATE INDEX "booking_change_due_idx" ON "booking_change"("next_attempt_at")
    WHERE "outcome" IS NULL;

CREATE TABLE "booking_schedule" (
    "booking_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "change_id" UUID NOT NULL,
    "previous_hold_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_schedule_pkey" PRIMARY KEY ("booking_id", "revision"),
    CONSTRAINT "booking_schedule_revision_ck" CHECK ("revision" >= 2),
    CONSTRAINT "booking_schedule_time_ck" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "booking_schedule_hold_ck" CHECK ("hold_id" <> "previous_hold_id")
);
CREATE UNIQUE INDEX "booking_schedule_change_id_key" ON "booking_schedule"("change_id");

ALTER TABLE "booking_schedule" ADD CONSTRAINT "booking_schedule_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "booking_schedule" ADD CONSTRAINT "booking_schedule_change_id_fkey"
    FOREIGN KEY ("change_id") REFERENCES "booking_change"("change_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Cancellation is final; the schedule only moves forward, one revision at a time.
CREATE FUNCTION "booking_guard_change"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD."cancelled_at" IS NOT NULL AND (
        NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
        OR NEW."cancellation_reason" IS DISTINCT FROM OLD."cancellation_reason"
        OR NEW."status" IS DISTINCT FROM OLD."status")
    THEN
        RAISE EXCEPTION 'BOOKING_CANCELLATION_FINAL' USING ERRCODE = '55000';
    END IF;
    IF NEW."schedule_revision" <> OLD."schedule_revision" AND (
        NEW."schedule_revision" <> OLD."schedule_revision" + 1 OR OLD."status" <> 'CONFIRMED')
    THEN
        RAISE EXCEPTION 'BOOKING_SCHEDULE_REVISION_INVALID' USING ERRCODE = '55000';
    END IF;
    IF NEW."schedule_revision" = OLD."schedule_revision" AND (
        NEW."schedule_hold_id" IS DISTINCT FROM OLD."schedule_hold_id"
        OR NEW."schedule_starts_at" IS DISTINCT FROM OLD."schedule_starts_at"
        OR NEW."schedule_ends_at" IS DISTINCT FROM OLD."schedule_ends_at")
    THEN
        RAISE EXCEPTION 'BOOKING_SCHEDULE_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "booking_guard_change"() FROM PUBLIC;

CREATE TRIGGER "booking_guard_change_update" BEFORE UPDATE ON "booking"
    FOR EACH ROW EXECUTE FUNCTION "booking_guard_change"();

-- What was requested never changes; changes are records, never deleted.
CREATE FUNCTION "booking_change_guard"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'BOOKING_CHANGE_DELETE_FORBIDDEN' USING ERRCODE = '55000';
    END IF;
    IF NEW."change_id" IS DISTINCT FROM OLD."change_id"
       OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."reason" IS DISTINCT FROM OLD."reason"
       OR NEW."requester_kind" IS DISTINCT FROM OLD."requester_kind"
       OR NEW."requester_subject" IS DISTINCT FROM OLD."requester_subject"
       OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
       OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
       OR NEW."from_hold_id" IS DISTINCT FROM OLD."from_hold_id"
       OR NEW."zone_id" IS DISTINCT FROM OLD."zone_id"
       OR NEW."from_starts_at" IS DISTINCT FROM OLD."from_starts_at"
       OR NEW."from_ends_at" IS DISTINCT FROM OLD."from_ends_at"
       OR NEW."to_hold_id" IS DISTINCT FROM OLD."to_hold_id"
       OR NEW."to_hold_revision" IS DISTINCT FROM OLD."to_hold_revision"
       OR NEW."to_starts_at" IS DISTINCT FROM OLD."to_starts_at"
       OR NEW."to_ends_at" IS DISTINCT FROM OLD."to_ends_at"
       OR NEW."to_expires_at" IS DISTINCT FROM OLD."to_expires_at"
       OR NEW."correlation_id" IS DISTINCT FROM OLD."correlation_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
       -- A finished change is history.
       OR (OLD."outcome" IS NOT NULL AND (
            NEW."outcome" IS DISTINCT FROM OLD."outcome"
            OR NEW."step" IS DISTINCT FROM OLD."step"
            OR NEW."settlement" IS DISTINCT FROM OLD."settlement"
            OR NEW."refusal" IS DISTINCT FROM OLD."refusal"))
       -- A pivot once attempted is never un-attempted.
       OR (OLD."pivot_attempted" AND NOT NEW."pivot_attempted")
    THEN
        RAISE EXCEPTION 'BOOKING_CHANGE_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "booking_change_guard"() FROM PUBLIC;

CREATE TRIGGER "booking_change_guard_update" BEFORE UPDATE ON "booking_change"
    FOR EACH ROW EXECUTE FUNCTION "booking_change_guard"();
CREATE TRIGGER "booking_change_guard_delete" BEFORE DELETE ON "booking_change"
    FOR EACH ROW EXECUTE FUNCTION "booking_change_guard"();

CREATE FUNCTION "booking_schedule_append_only"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'BOOKING_SCHEDULE_APPEND_ONLY' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION "booking_schedule_append_only"() FROM PUBLIC;

CREATE TRIGGER "booking_schedule_append_only_update" BEFORE UPDATE OR DELETE ON "booking_schedule"
    FOR EACH ROW EXECUTE FUNCTION "booking_schedule_append_only"();
