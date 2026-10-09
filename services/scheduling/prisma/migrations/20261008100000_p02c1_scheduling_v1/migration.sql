-- P02-C1: scheduling.v1 conformance (principal-owned slot holds, Booking commit).
-- Applied by the migration identity (cw_scheduling_migrate) as a separate job.
--
-- EXPAND ONLY with respect to running code:
--   * new nullable columns on capacity_hold (the v1 hold facts),
--   * the four C1 request columns (client_id, holder_ref, idempotency_key,
--     request_fingerprint) become NULLABLE: v1 holds keep idempotency in the new
--     idempotency_record table instead. Rows written by C1 code keep their values
--     and the C1 unique (client_id, idempotency_key) index is untouched,
--   * the release-reason CHECK is widened (the old set stays valid),
--   * new table idempotency_record, new indexes.
-- Nothing is dropped and no existing row is rewritten.
--
-- Invariants added HERE, not only in application code:
--   * a v1 hold row carries all of its facts (beneficiary, zone, slot, quote),
--   * its slot is a positive interval of 5..480 minutes,
--   * booking_id is set exactly for CONFIRMED and CANCELLED (= committed, then
--     released by staff) v1 holds,
--   * one booking commits at most one hold (partial UNIQUE on booking_id).

ALTER TABLE "capacity_hold"
    ADD COLUMN "zone_id" UUID,
    ADD COLUMN "beneficiary_kind" TEXT,
    ADD COLUMN "beneficiary_subject" UUID,
    ADD COLUMN "quote_id" UUID,
    ADD COLUMN "quote_revision" INTEGER,
    ADD COLUMN "slot_starts_at" TIMESTAMPTZ(3),
    ADD COLUMN "slot_ends_at" TIMESTAMPTZ(3),
    ADD COLUMN "booking_id" UUID;

ALTER TABLE "capacity_hold"
    ALTER COLUMN "client_id" DROP NOT NULL,
    ALTER COLUMN "holder_ref" DROP NOT NULL,
    ALTER COLUMN "idempotency_key" DROP NOT NULL,
    ALTER COLUMN "request_fingerprint" DROP NOT NULL;

-- A row is either a C1 row (request columns set, v1 facts absent) or a v1 row
-- (v1 facts set). Mixed or empty rows are rejected.
ALTER TABLE "capacity_hold" ADD CONSTRAINT "capacity_hold_shape_ck" CHECK (
    (
        "beneficiary_kind" IS NULL
        AND "client_id" IS NOT NULL AND "holder_ref" IS NOT NULL
        AND "idempotency_key" IS NOT NULL AND "request_fingerprint" IS NOT NULL
        AND "zone_id" IS NULL AND "booking_id" IS NULL
    )
    OR
    (
        "beneficiary_kind" IN ('account', 'guest')
        AND "beneficiary_subject" IS NOT NULL
        AND "zone_id" IS NOT NULL
        AND "quote_id" IS NOT NULL
        AND "quote_revision" BETWEEN 1 AND 2147483647
        AND "slot_starts_at" IS NOT NULL
        AND "slot_ends_at" IS NOT NULL
        AND "slot_ends_at" - "slot_starts_at" BETWEEN INTERVAL '5 minutes' AND INTERVAL '480 minutes'
        AND "units" = 1
        AND ("status" IN ('CONFIRMED', 'CANCELLED')) = ("booking_id" IS NOT NULL)
    )
);

ALTER TABLE "capacity_hold" DROP CONSTRAINT "capacity_hold_reason_ck";
ALTER TABLE "capacity_hold" ADD CONSTRAINT "capacity_hold_reason_ck" CHECK (
    ("status" IN ('RELEASED', 'CANCELLED')) = ("release_reason" IS NOT NULL)
    AND ("release_reason" IS NULL OR "release_reason" IN (
        'CUSTOMER_ABANDONED', 'BOOKING_FAILED', 'BOOKING_CANCELLED',
        'RESCHEDULED', 'OPERATIONS_OVERRIDE', 'CUSTOMER_CHANGED', 'EXPIRED_BY_CLIENT'
    ))
);

-- CreateIndex
CREATE UNIQUE INDEX "capacity_hold_booking_id_key" ON "capacity_hold"("booking_id")
    WHERE "booking_id" IS NOT NULL;

-- CreateIndex: anti-hoarding count of a beneficiary's live holds.
CREATE INDEX "capacity_hold_beneficiary_idx"
    ON "capacity_hold"("beneficiary_kind", "beneficiary_subject", "status", "expires_at");

-- CreateIndex: covering-window lookup.
CREATE INDEX "capacity_window_zone_id_ends_at_idx" ON "capacity_window"("zone_id", "ends_at");

-- CreateTable: protocol idempotency records (scope includes contract, operation
-- and authenticated actor). Written in the same transaction as the change; only
-- completed outcomes are kept. Retention: 7 days, purged by the hold-expiry worker.
CREATE TABLE "idempotency_record" (
    "scope" VARCHAR(200) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("scope", "key"),
    CONSTRAINT "idempotency_record_key_ck" CHECK ("key" ~ '^[A-Za-z0-9_-]{16,128}$'),
    CONSTRAINT "idempotency_record_outcome_ck" CHECK (
        ("completed_at" IS NULL) = ("response_status" IS NULL)
        AND ("response_status" IS NULL) = ("response_body" IS NULL)
        AND ("response_status" IS NULL OR "response_status" BETWEEN 200 AND 299)
    )
);

-- CreateIndex
CREATE INDEX "idempotency_record_completed_at_idx" ON "idempotency_record"("completed_at");
