-- P02-C3: dispatch assignments, offers, hold observations, inbox, outbox,
-- idempotency and audit.
-- Applied by the migration identity (cw_dispatch_migrate) as a separate job.
-- Expand-only: creates new objects, alters and drops nothing that exists.
--
-- Invariants enforced HERE, not only in application code:
--   * exactly one assignment per booking and per Scheduling hold (UNIQUE),
--   * an ASSIGNED job names its resource, any other state names none (CHECK),
--   * a resource never holds two ASSIGNED jobs whose windows overlap
--     (EXCLUDE USING gist on [starts_at, ends_at)),
--   * at most one OFFERED and at most one ACCEPTED offer per assignment
--     (partial UNIQUE indexes),
--   * one inbox row per event id; one idempotency record per (scope, key).

-- btree_gist is a trusted extension; the database-owning migration role may
-- create it. It supplies uuid equality for the exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- CreateTable
CREATE TABLE "hold_observation" (
    "hold_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hold_observation_pkey" PRIMARY KEY ("hold_id"),
    CONSTRAINT "hold_observation_version_ck" CHECK ("version" >= 1),
    CONSTRAINT "hold_observation_state_ck" CHECK (
        "state" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')
    )
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "resource_id" UUID,
    "technician_subject" UUID,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_time_ck" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "assignment_status_ck" CHECK (
        "status" IN ('UNASSIGNED', 'OFFERED', 'ASSIGNED', 'CANCELLED')
    ),
    CONSTRAINT "assignment_resource_ck" CHECK (
        ("status" = 'ASSIGNED') = ("resource_id" IS NOT NULL)
        AND ("resource_id" IS NULL) = ("technician_subject" IS NULL)
    ),
    CONSTRAINT "assignment_cancel_ck" CHECK (
        ("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL)
        AND ("cancel_reason" IS NULL OR "cancel_reason" IN ('HOLD_RELEASED', 'HOLD_EXPIRED'))
    ),
    CONSTRAINT "assignment_version_ck" CHECK ("version" >= 1),
    CONSTRAINT "assignment_resource_no_overlap_ex" EXCLUDE USING gist (
        "resource_id" public.gist_uuid_ops WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("status" = 'ASSIGNED')
);

-- CreateTable
CREATE TABLE "dispatch_offer" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "technician_subject" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "decline_reason" TEXT,
    "withdraw_reason" TEXT,
    "created_by" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dispatch_offer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dispatch_offer_status_ck" CHECK (
        "status" IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN')
    ),
    CONSTRAINT "dispatch_offer_decline_ck" CHECK (
        ("status" = 'DECLINED') = ("decline_reason" IS NOT NULL)
        AND ("decline_reason" IS NULL OR "decline_reason" IN ('UNAVAILABLE', 'TOO_FAR', 'OTHER'))
    ),
    CONSTRAINT "dispatch_offer_withdraw_ck" CHECK (
        ("status" = 'WITHDRAWN') = ("withdraw_reason" IS NOT NULL)
        AND ("withdraw_reason" IS NULL OR "withdraw_reason" IN ('REASSIGNED', 'UNASSIGNED', 'JOB_CANCELLED'))
    ),
    CONSTRAINT "dispatch_offer_version_ck" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "scope" VARCHAR(200) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_type" TEXT NOT NULL,
    "result_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("scope", "idempotency_key"),
    CONSTRAINT "idempotency_record_result_type_ck" CHECK ("result_type" IN ('ASSIGNMENT', 'OFFER'))
);

-- CreateTable
CREATE TABLE "inbox_message" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "outcome" VARCHAR(32),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_message_pkey" PRIMARY KEY ("event_id")
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
    CONSTRAINT "audit_entry_actor_kind_ck" CHECK ("actor_kind" IN ('USER', 'SERVICE', 'SYSTEM')),
    CONSTRAINT "audit_entry_target_type_ck" CHECK ("target_type" IN ('ASSIGNMENT', 'OFFER', 'HOLD'))
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_booking_id_key" ON "assignment"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_hold_id_key" ON "assignment"("hold_id");

-- CreateIndex
CREATE INDEX "assignment_zone_id_starts_at_idx" ON "assignment"("zone_id", "starts_at");

-- CreateIndex
CREATE INDEX "dispatch_offer_assignment_id_idx" ON "dispatch_offer"("assignment_id");

-- CreateIndex
CREATE INDEX "dispatch_offer_technician_subject_status_idx" ON "dispatch_offer"("technician_subject", "status");

-- CreateIndex
CREATE INDEX "dispatch_offer_status_expires_at_idx" ON "dispatch_offer"("status", "expires_at");

-- Partial unique indexes (not expressible in schema.prisma; they live in SQL only).
CREATE UNIQUE INDEX "dispatch_offer_one_live_per_assignment_key"
    ON "dispatch_offer"("assignment_id") WHERE "status" = 'OFFERED';
CREATE UNIQUE INDEX "dispatch_offer_one_accepted_per_assignment_key"
    ON "dispatch_offer"("assignment_id") WHERE "status" = 'ACCEPTED';

-- CreateIndex
CREATE INDEX "idempotency_record_created_at_idx" ON "idempotency_record"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_entry_target_type_target_id_idx" ON "audit_entry"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
