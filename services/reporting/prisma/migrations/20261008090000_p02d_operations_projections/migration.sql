-- P02-D operations read model for the reporting service.
-- Applied by the migration identity (cw_reporting_migrate) as a separate job;
-- application replicas never run this file. Additive only (expand step): no
-- existing table, column or privilege is changed, and the standard runtime DML
-- grant from provisioning applies unchanged (replay-stable).
-- CreateTable
CREATE TABLE "ops_slot_hold" (
    "hold_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" VARCHAR(12) NOT NULL,
    "zone_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "booking_id" UUID,
    "fingerprint" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ops_slot_hold_pkey" PRIMARY KEY ("hold_id")
);

-- CreateTable
CREATE TABLE "ops_booking" (
    "booking_id" UUID NOT NULL,
    "customer_ref" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmation_version" INTEGER,
    "confirmation_fingerprint" CHAR(64),
    "slot_hold_id" UUID,
    "slot_state" VARCHAR(12),
    "slot_zone_id" UUID,
    "slot_starts_at" TIMESTAMPTZ(3),
    "slot_ends_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ops_booking_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "ops_resource_eligibility" (
    "resource_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "eligibility" VARCHAR(12) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ops_resource_eligibility_pkey" PRIMARY KEY ("resource_id")
);

-- CreateTable
CREATE TABLE "ops_freshness" (
    "source" VARCHAR(16) NOT NULL,
    "last_event_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "last_applied_at" TIMESTAMPTZ(3) NOT NULL,
    "applied_count" BIGINT NOT NULL,

    CONSTRAINT "ops_freshness_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE INDEX "ops_slot_hold_booking_id_idx" ON "ops_slot_hold"("booking_id");

-- CreateIndex
CREATE INDEX "ops_booking_slot_starts_at_booking_id_idx" ON "ops_booking"("slot_starts_at", "booking_id");

-- CreateIndex
CREATE INDEX "ops_booking_slot_zone_id_slot_starts_at_idx" ON "ops_booking"("slot_zone_id", "slot_starts_at");

-- CreateIndex
CREATE INDEX "ops_booking_confirmed_at_booking_id_idx" ON "ops_booking"("confirmed_at", "booking_id");

-- CreateIndex
CREATE INDEX "ops_resource_eligibility_eligibility_resource_id_idx" ON "ops_resource_eligibility"("eligibility", "resource_id");


-- Closed vocabularies and invariants enforced by the database itself.
ALTER TABLE "ops_slot_hold"
  ADD CONSTRAINT "ops_slot_hold_state_known" CHECK ("state" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  ADD CONSTRAINT "ops_slot_hold_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "ops_slot_hold_window" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "ops_slot_hold_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ops_booking"
  ADD CONSTRAINT "ops_booking_confirmation_complete" CHECK (
    ("confirmed_at" IS NULL) = ("confirmation_version" IS NULL)
    AND ("confirmed_at" IS NULL) = ("confirmation_fingerprint" IS NULL)
    AND ("confirmed_at" IS NULL) = ("customer_ref" IS NULL)),
  ADD CONSTRAINT "ops_booking_slot_complete" CHECK (
    ("slot_hold_id" IS NULL) = ("slot_state" IS NULL)
    AND ("slot_hold_id" IS NULL) = ("slot_zone_id" IS NULL)
    AND ("slot_hold_id" IS NULL) = ("slot_starts_at" IS NULL)
    AND ("slot_hold_id" IS NULL) = ("slot_ends_at" IS NULL)),
  ADD CONSTRAINT "ops_booking_slot_state_known" CHECK (
    "slot_state" IS NULL OR "slot_state" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  ADD CONSTRAINT "ops_booking_has_fact" CHECK ("confirmed_at" IS NOT NULL OR "slot_hold_id" IS NOT NULL);

ALTER TABLE "ops_resource_eligibility"
  ADD CONSTRAINT "ops_resource_eligibility_known" CHECK ("eligibility" IN ('ELIGIBLE', 'INELIGIBLE')),
  ADD CONSTRAINT "ops_resource_eligibility_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "ops_resource_eligibility_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ops_freshness"
  ADD CONSTRAINT "ops_freshness_source_known" CHECK ("source" IN ('booking', 'scheduling', 'workforce')),
  ADD CONSTRAINT "ops_freshness_count_positive" CHECK ("applied_count" >= 1);
