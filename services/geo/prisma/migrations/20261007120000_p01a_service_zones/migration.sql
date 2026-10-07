-- P01-A3: service zones, outbox and audit.
-- Applied by the migration identity (cw_geo_migrate) as a separate job.
-- Additive only (expand phase). This migration creates NO zone rows: there is
-- no approved Aleppo (or any other) dataset, and none is invented here.
-- Rollback before any row is written: drop the three new tables and the
-- trigger function. After rows exist rollback needs a reviewed data plan.

-- CreateTable
CREATE TABLE "service_zone" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "dataset_ref" VARCHAR(120) NOT NULL,
    "ring" JSONB NOT NULL,
    "min_lat" DECIMAL(9,6) NOT NULL,
    "max_lat" DECIMAL(9,6) NOT NULL,
    "min_lng" DECIMAL(9,6) NOT NULL,
    "max_lng" DECIMAL(9,6) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_zone_pkey" PRIMARY KEY ("id")
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
    "actor" VARCHAR(60) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "zone_id" UUID NOT NULL,
    "dataset_ref" VARCHAR(120) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_zone_code_key" ON "service_zone"("code");

-- CreateIndex
CREATE INDEX "service_zone_active_bbox_idx" ON "service_zone"("status", "min_lat", "max_lat", "min_lng", "max_lng");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_entry_zone_idx" ON "audit_entry"("zone_id", "at");


-- Invariants the application also enforces. Multi-value tests are applied to
-- NOT NULL columns only; NULL IN (...) would otherwise pass a CHECK.
ALTER TABLE "service_zone"
  ADD CONSTRAINT "service_zone_code_check" CHECK ("code" ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  ADD CONSTRAINT "service_zone_dataset_ref_check" CHECK ("dataset_ref" ~ '^[a-z0-9][a-z0-9._:-]{2,119}$'),
  ADD CONSTRAINT "service_zone_name_check" CHECK (char_length(btrim("name")) >= 2),
  ADD CONSTRAINT "service_zone_status_check" CHECK ("status" IN ('ACTIVE', 'RETIRED')),
  ADD CONSTRAINT "service_zone_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "service_zone_retired_at_check" CHECK (("status" = 'RETIRED') = ("retired_at" IS NOT NULL)),
  -- A closed ring needs at least 4 positions; at most 1000 vertices + closure.
  ADD CONSTRAINT "service_zone_ring_check" CHECK (
    jsonb_typeof("ring") = 'array'
    AND jsonb_array_length("ring") BETWEEN 4 AND 1001
    AND "ring" -> 0 = "ring" -> -1
  ),
  -- NUMERIC accepts 'NaN'; every bound must be a finite, in-range, ordered value.
  ADD CONSTRAINT "service_zone_bbox_check" CHECK (
    "min_lat" <> 'NaN'::numeric AND "max_lat" <> 'NaN'::numeric
    AND "min_lng" <> 'NaN'::numeric AND "max_lng" <> 'NaN'::numeric
    AND "min_lat" >= -90 AND "max_lat" <= 90 AND "min_lat" < "max_lat"
    AND "min_lng" >= -180 AND "max_lng" <= 180 AND "min_lng" < "max_lng"
    AND "max_lng" - "min_lng" < 180
  );

-- Audit facts are append-only: UPDATE and DELETE are refused regardless of grants.
CREATE FUNCTION "audit_entry_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "audit_entry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION "audit_entry_append_only"();
