-- P01-C1: scheduling capacity windows, expiring holds, outbox and audit.
-- Applied by the migration identity (cw_scheduling_migrate) as a separate job.
-- Expand-only: creates new objects, alters and drops nothing that exists.
--
-- Invariants enforced HERE, not only in application code:
--   * held + reserved <= capacity on every window row (CHECK),
--   * no two windows of one zone overlap in time (EXCLUDE USING gist),
--   * one hold per (client, idempotency key) (UNIQUE),
--   * a hold's status, units and release reason stay in their allowed sets.

-- btree_gist is a trusted extension; the database-owning migration role may
-- create it. It supplies uuid equality for the exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "capacity_window" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "held" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capacity_window_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capacity_window_time_ck" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "capacity_window_capacity_ck" CHECK ("capacity" >= 0 AND "capacity" <= 500),
    CONSTRAINT "capacity_window_counts_ck" CHECK ("held" >= 0 AND "reserved" >= 0),
    CONSTRAINT "capacity_window_no_oversell_ck" CHECK ("held" + "reserved" <= "capacity"),
    CONSTRAINT "capacity_window_status_ck" CHECK ("status" IN ('OPEN', 'CLOSED')),
    CONSTRAINT "capacity_window_version_ck" CHECK ("version" >= 1),
    CONSTRAINT "capacity_window_no_overlap_ex" EXCLUDE USING gist (
        "zone_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    )
);

-- CreateTable
CREATE TABLE "capacity_hold" (
    "id" UUID NOT NULL,
    "window_id" UUID NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "holder_ref" UUID NOT NULL,
    "units" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "release_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "capacity_hold_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capacity_hold_units_ck" CHECK ("units" >= 1 AND "units" <= 4),
    CONSTRAINT "capacity_hold_status_ck" CHECK (
        "status" IN ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'CANCELLED')
    ),
    CONSTRAINT "capacity_hold_reason_ck" CHECK (
        ("status" IN ('RELEASED', 'CANCELLED')) = ("release_reason" IS NOT NULL)
        AND ("release_reason" IS NULL OR "release_reason" IN (
            'CUSTOMER_ABANDONED', 'BOOKING_FAILED', 'BOOKING_CANCELLED',
            'RESCHEDULED', 'OPERATIONS_OVERRIDE'
        ))
    ),
    CONSTRAINT "capacity_hold_version_ck" CHECK ("version" >= 1)
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
CREATE UNIQUE INDEX "capacity_window_zone_id_starts_at_key" ON "capacity_window"("zone_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "capacity_hold_client_id_idempotency_key_key" ON "capacity_hold"("client_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "capacity_hold_window_id_status_expires_at_idx" ON "capacity_hold"("window_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "capacity_hold_status_expires_at_idx" ON "capacity_hold"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_entry_target_type_target_id_idx" ON "audit_entry"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "capacity_hold" ADD CONSTRAINT "capacity_hold_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "capacity_window"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
