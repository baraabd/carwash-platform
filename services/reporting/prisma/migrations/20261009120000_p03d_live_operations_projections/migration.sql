-- P03-D live-operations read model for the reporting service (assignment
-- timing and cash states). Applied by the migration identity
-- (cw_reporting_migrate) as a separate job; application replicas never run
-- this file. Additive only (expand step): three new tables, and the
-- ops_freshness source vocabulary is widened (never narrowed), so every row
-- valid before this migration stays valid and the previous code keeps working.
-- CreateTable
CREATE TABLE "ops_assignment" (
    "assignment_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "zone_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "resource_id" UUID,
    "fingerprint" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "first_observed_at" TIMESTAMPTZ(3) NOT NULL,
    "first_offered_at" TIMESTAMPTZ(3),
    "first_assigned_at" TIMESTAMPTZ(3),

    CONSTRAINT "ops_assignment_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "ops_assignment_resource" (
    "assignment_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "first_assigned_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ops_assignment_resource_pkey" PRIMARY KEY ("assignment_id","resource_id")
);

-- CreateTable
CREATE TABLE "ops_obligation" (
    "obligation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "cash_state" VARCHAR(16) NOT NULL,
    "outstanding_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "scale" SMALLINT NOT NULL,
    "state_since" TIMESTAMPTZ(3) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ops_obligation_pkey" PRIMARY KEY ("obligation_id")
);

-- CreateIndex
CREATE INDEX "ops_assignment_booking_id_idx" ON "ops_assignment"("booking_id");

-- CreateIndex
CREATE INDEX "ops_assignment_starts_at_assignment_id_idx" ON "ops_assignment"("starts_at", "assignment_id");

-- CreateIndex
CREATE INDEX "ops_assignment_zone_id_starts_at_idx" ON "ops_assignment"("zone_id", "starts_at");

-- CreateIndex
CREATE INDEX "ops_obligation_cash_state_state_since_idx" ON "ops_obligation"("cash_state", "state_since");

-- AddForeignKey
ALTER TABLE "ops_assignment_resource" ADD CONSTRAINT "ops_assignment_resource_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "ops_assignment"("assignment_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Closed vocabularies and invariants enforced by the database itself.
ALTER TABLE "ops_assignment"
  ADD CONSTRAINT "ops_assignment_status_known" CHECK ("status" IN ('UNASSIGNED', 'OFFERED', 'ASSIGNED', 'CANCELLED')),
  ADD CONSTRAINT "ops_assignment_resource_iff_assigned" CHECK (("status" = 'ASSIGNED') = ("resource_id" IS NOT NULL)),
  ADD CONSTRAINT "ops_assignment_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "ops_assignment_window" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "ops_assignment_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ops_assignment_milestones_ordered" CHECK (
    "first_observed_at" <= "occurred_at"
    AND ("first_offered_at" IS NULL OR "first_offered_at" >= "first_observed_at")
    AND ("first_assigned_at" IS NULL OR "first_assigned_at" >= "first_observed_at")),
  ADD CONSTRAINT "ops_assignment_assigned_has_milestone" CHECK (
    "status" <> 'ASSIGNED' OR "first_assigned_at" IS NOT NULL);

ALTER TABLE "ops_obligation"
  ADD CONSTRAINT "ops_obligation_state_known" CHECK ("cash_state" IN (
    'UNPAID', 'AWAITING_CASH', 'AWAITING_PAYMENT', 'UNDER_REVIEW', 'OUTCOME_UNKNOWN', 'PAID', 'VOIDED')),
  ADD CONSTRAINT "ops_obligation_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "ops_obligation_outstanding_range" CHECK ("outstanding_minor" >= 0 AND "outstanding_minor" < 1000000000000000000),
  ADD CONSTRAINT "ops_obligation_closed_settled" CHECK (
    "cash_state" NOT IN ('PAID', 'VOIDED') OR "outstanding_minor" = 0),
  ADD CONSTRAINT "ops_obligation_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "ops_obligation_scale_range" CHECK ("scale" BETWEEN 0 AND 4),
  ADD CONSTRAINT "ops_obligation_since_not_future" CHECK ("state_since" <= "occurred_at"),
  ADD CONSTRAINT "ops_obligation_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

-- Widen (never narrow) the freshness source vocabulary.
ALTER TABLE "ops_freshness" DROP CONSTRAINT "ops_freshness_source_known";
ALTER TABLE "ops_freshness"
  ADD CONSTRAINT "ops_freshness_source_known" CHECK ("source" IN ('booking', 'scheduling', 'workforce', 'dispatch', 'billing'));
