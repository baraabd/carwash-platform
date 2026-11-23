-- P02-C2: Booking aggregate, immutable snapshots, idempotent create requests,
-- durable creation saga, outbox and audit.
-- Applied by the migration identity (cw_booking_migrate) as a separate job.
-- Expand-only: creates new objects; alters and drops nothing that exists.
--
-- Invariants enforced HERE, not only in application code:
--   * one live booking per Scheduling hold and per Pricing quote (partial UNIQUE),
--   * one booking per (principal, Idempotency-Key) (PRIMARY KEY of booking_request),
--   * snapshots, beneficiary, money and requested slot never change after insert,
--     the version only moves by one, and bookings are never deleted (triggers),
--   * exact money: BIGINT minor units with an explicit, currency-bound scale,
--   * status / reason / saga step domains and their cross-field consistency (CHECK).

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "principal_kind" TEXT NOT NULL,
    "principal_subject" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "payment_method" TEXT NOT NULL,
    "contact" JSONB NOT NULL,
    "vehicle_snapshot" JSONB NOT NULL,
    "address_snapshot" JSONB NOT NULL,
    "quote_snapshot" JSONB NOT NULL,
    "quote_id" UUID NOT NULL,
    "quote_revision" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "total_scale" SMALLINT NOT NULL,
    "hold_id" UUID NOT NULL,
    "hold_revision" INTEGER NOT NULL,
    "zone_id" UUID NOT NULL,
    "requested_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "requested_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "slot_starts_at" TIMESTAMPTZ(3),
    "slot_ends_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_principal_kind_ck" CHECK ("principal_kind" IN ('account', 'guest')),
    CONSTRAINT "booking_status_ck" CHECK ("status" IN (
        'PENDING_CONFIRMATION', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED',
        'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'
    )),
    CONSTRAINT "booking_rejection_ck" CHECK (
        ("status" = 'REJECTED') = ("rejection_reason" IS NOT NULL)
        AND ("rejection_reason" IS NULL OR "rejection_reason" IN (
            'QUOTE_EXPIRED', 'QUOTE_REVOKED', 'QUOTE_INVALID', 'OBLIGATION_REJECTED',
            'HOLD_EXPIRED', 'HOLD_UNAVAILABLE', 'DEADLINE_EXCEEDED'
        ))
    ),
    CONSTRAINT "booking_payment_method_ck" CHECK (
        "payment_method" IN ('CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH')
    ),
    CONSTRAINT "booking_money_ck" CHECK (
        "currency" IN ('SYP', 'USD') AND "total_scale" = 2
        AND "total_minor" >= 0 AND "total_minor" < 1000000000000000000
    ),
    CONSTRAINT "booking_revisions_ck" CHECK (
        "quote_revision" >= 1 AND "hold_revision" >= 1 AND "version" >= 1
    ),
    CONSTRAINT "booking_requested_slot_ck" CHECK ("requested_ends_at" > "requested_starts_at"),
    -- The committed slot exists exactly when the booking was confirmed, and it
    -- is the slot the customer requested. Pending/rejected bookings have none.
    CONSTRAINT "booking_slot_ck" CHECK (
        ("slot_starts_at" IS NULL) = ("slot_ends_at" IS NULL)
        AND ("slot_starts_at" IS NULL) = ("confirmed_at" IS NULL)
        AND ("status" NOT IN ('PENDING_CONFIRMATION', 'REJECTED') OR "slot_starts_at" IS NULL)
        AND ("status" NOT IN ('CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED')
             OR "slot_starts_at" IS NOT NULL)
        AND ("slot_starts_at" IS NULL OR (
            "slot_starts_at" = "requested_starts_at" AND "slot_ends_at" = "requested_ends_at"
        ))
    ),
    CONSTRAINT "booking_snapshots_ck" CHECK (
        jsonb_typeof("contact") = 'object' AND jsonb_typeof("vehicle_snapshot") = 'object'
        AND jsonb_typeof("address_snapshot") = 'object' AND jsonb_typeof("quote_snapshot") = 'object'
    )
);

-- CreateTable
CREATE TABLE "booking_request" (
    "principal_kind" TEXT NOT NULL,
    "principal_subject" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "booking_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "fence" INTEGER NOT NULL DEFAULT 1,
    "lease_until" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_request_pkey" PRIMARY KEY ("principal_kind", "principal_subject", "idempotency_key"),
    CONSTRAINT "booking_request_state_ck" CHECK ("state" IN ('CAPTURING', 'BOUND')),
    CONSTRAINT "booking_request_fence_ck" CHECK ("fence" >= 1)
);

-- CreateTable
CREATE TABLE "booking_saga" (
    "booking_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "outcome" TEXT,
    "pending_rejection" TEXT,
    "obligation_id" VARCHAR(128),
    "pivot_attempted" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "last_error" VARCHAR(64),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" VARCHAR(80),
    "lease_until" TIMESTAMPTZ(3),
    "correlation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_saga_pkey" PRIMARY KEY ("booking_id"),
    CONSTRAINT "booking_saga_step_ck" CHECK ("step" IN (
        'VALIDATE_QUOTE', 'CREATE_OBLIGATION', 'COMMIT_HOLD', 'VOID_OBLIGATION',
        'DONE', 'NEEDS_RECONCILIATION'
    )),
    CONSTRAINT "booking_saga_outcome_ck" CHECK (
        ("step" = 'DONE') = ("outcome" IS NOT NULL)
        AND ("outcome" IS NULL OR "outcome" IN ('CONFIRMED', 'REJECTED'))
    ),
    CONSTRAINT "booking_saga_rejection_ck" CHECK (
        "pending_rejection" IS NULL OR "pending_rejection" IN (
            'QUOTE_EXPIRED', 'QUOTE_REVOKED', 'QUOTE_INVALID', 'OBLIGATION_REJECTED',
            'HOLD_EXPIRED', 'HOLD_UNAVAILABLE', 'DEADLINE_EXCEEDED'
        )
    ),
    CONSTRAINT "booking_saga_counts_ck" CHECK (
        "attempts" >= 0 AND "fence" >= 0 AND "version" >= 1
    ),
    -- Once the pivot was attempted the saga can only finish it, compensate a
    -- refused commit, or stop for reconciliation; it never steps back.
    CONSTRAINT "booking_saga_pivot_ck" CHECK (
        NOT "pivot_attempted"
        OR "step" IN ('COMMIT_HOLD', 'VOID_OBLIGATION', 'DONE', 'NEEDS_RECONCILIATION')
    )
);

-- CreateTable
CREATE TABLE "outbox_message" (
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

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entry" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" TEXT NOT NULL,
    "actor_id" VARCHAR(80) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_entry_actor_kind_ck" CHECK ("actor_kind" IN ('USER', 'SERVICE', 'SYSTEM'))
);

-- CreateIndex
CREATE INDEX "booking_principal_kind_principal_subject_created_at_idx" ON "booking"("principal_kind", "principal_subject", "created_at");

-- One LIVE booking per hold and per quote. A REJECTED booking reserved
-- nothing, so it does not block a new attempt with a new hold or quote.
CREATE UNIQUE INDEX "booking_live_hold_key" ON "booking"("hold_id") WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "booking_live_quote_key" ON "booking"("quote_id") WHERE "status" <> 'REJECTED';

-- CreateIndex
CREATE UNIQUE INDEX "booking_request_booking_id_key" ON "booking_request"("booking_id");

-- Due, unfinished sagas for the worker.
CREATE INDEX "booking_saga_due_idx" ON "booking_saga"("next_attempt_at")
    WHERE "step" NOT IN ('DONE', 'NEEDS_RECONCILIATION');

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_entry_target_type_target_id_idx" ON "audit_entry"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "booking_saga" ADD CONSTRAINT "booking_saga_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Immutability: what the customer agreed to never changes after creation, the
-- version moves by exactly one per update, and booking rows are records that
-- are never deleted. Defence in depth below the application; the runtime role
-- has no DDL and cannot drop or disable these triggers.
CREATE FUNCTION "booking_guard_immutable"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'BOOKING_DELETE_FORBIDDEN' USING ERRCODE = '55000';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."principal_kind" IS DISTINCT FROM OLD."principal_kind"
       OR NEW."principal_subject" IS DISTINCT FROM OLD."principal_subject"
       OR NEW."payment_method" IS DISTINCT FROM OLD."payment_method"
       OR NEW."contact" IS DISTINCT FROM OLD."contact"
       OR NEW."vehicle_snapshot" IS DISTINCT FROM OLD."vehicle_snapshot"
       OR NEW."address_snapshot" IS DISTINCT FROM OLD."address_snapshot"
       OR NEW."quote_snapshot" IS DISTINCT FROM OLD."quote_snapshot"
       OR NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
       OR NEW."quote_revision" IS DISTINCT FROM OLD."quote_revision"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."total_minor" IS DISTINCT FROM OLD."total_minor"
       OR NEW."total_scale" IS DISTINCT FROM OLD."total_scale"
       OR NEW."hold_id" IS DISTINCT FROM OLD."hold_id"
       OR NEW."hold_revision" IS DISTINCT FROM OLD."hold_revision"
       OR NEW."zone_id" IS DISTINCT FROM OLD."zone_id"
       OR NEW."requested_starts_at" IS DISTINCT FROM OLD."requested_starts_at"
       OR NEW."requested_ends_at" IS DISTINCT FROM OLD."requested_ends_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
       OR (OLD."slot_starts_at" IS NOT NULL AND (
            NEW."slot_starts_at" IS DISTINCT FROM OLD."slot_starts_at"
            OR NEW."slot_ends_at" IS DISTINCT FROM OLD."slot_ends_at"
            OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"))
    THEN
        RAISE EXCEPTION 'BOOKING_SNAPSHOT_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
        RAISE EXCEPTION 'BOOKING_VERSION_NOT_INCREMENTED' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "booking_guard_immutable"() FROM PUBLIC;

CREATE TRIGGER "booking_guard_immutable_update" BEFORE UPDATE ON "booking"
    FOR EACH ROW EXECUTE FUNCTION "booking_guard_immutable"();
CREATE TRIGGER "booking_guard_immutable_delete" BEFORE DELETE ON "booking"
    FOR EACH ROW EXECUTE FUNCTION "booking_guard_immutable"();
