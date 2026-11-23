-- P02-A3: geo.v1 provider — English zone name, dataset revision, decisions.
-- Applied by the migration identity (cw_geo_migrate) as a separate job.
--
-- Expand only: one nullable column and two new tables. No existing row is
-- rewritten or deleted, and no zone is created (there is still no approved
-- dataset). The previous application never reads the new column or tables
-- and keeps working against this schema.
--
-- Rollback: redeploy the previous application; the schema stays. Dropping the
-- decision table discards short-lived location data only, but still needs a
-- reviewed contract step; it is not done here.

-- geo.v1 ServiceZoneV1.name.en (optional English display name).
ALTER TABLE "service_zone" ADD COLUMN "name_en" VARCHAR(80);
ALTER TABLE "service_zone"
  ADD CONSTRAINT "service_zone_name_en_check"
  CHECK ("name_en" IS NULL OR char_length(btrim("name_en")) >= 2);

-- Dataset revision: exactly one row, advanced with every zone change.
CREATE TABLE "geo_dataset_state" (
    "id" SMALLINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "geo_dataset_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "geo_dataset_state_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "geo_dataset_state_revision_check" CHECK ("revision" >= 1)
);
-- Zones imported before this migration (if any) form revision 1.
INSERT INTO "geo_dataset_state" ("id", "revision", "updated_at") VALUES (1, 1, CURRENT_TIMESTAMP);

CREATE TABLE "serviceability_decision" (
    "id" UUID NOT NULL,
    "decision" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(32),
    "detail" VARCHAR(32),
    "zone_id" UUID,
    "zone_revision" INTEGER,
    "dataset_revision" INTEGER NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "serviceability_decision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "serviceability_decision_expires_idx" ON "serviceability_decision"("expires_at");

-- The same consistency rules the geo.v1 parser enforces, plus the internal
-- detail mapping. Multi-value tests are applied to NOT NULL columns or guarded.
ALTER TABLE "serviceability_decision"
  ADD CONSTRAINT "serviceability_decision_shape_check" CHECK (
    ("decision" = 'SERVICEABLE'
       AND "zone_id" IS NOT NULL AND "zone_revision" IS NOT NULL AND "zone_revision" >= 1
       AND "reason" IS NULL AND "detail" IS NULL)
    OR
    ("decision" = 'OUTSIDE_ZONE'
       AND "zone_id" IS NULL AND "zone_revision" IS NULL
       AND "reason" IS NULL AND "detail" IS NULL)
    OR
    ("decision" = 'INDETERMINATE'
       AND "zone_id" IS NULL AND "zone_revision" IS NULL
       -- NULL-guarded: NULL = 'x' is NULL, and a NULL CHECK passes.
       AND "reason" IS NOT NULL AND "detail" IS NOT NULL
       AND (("reason" = 'GEO_DATASET_UNAVAILABLE' AND "detail" = 'NO_APPROVED_ZONES')
         OR ("reason" = 'LOCATION_UNRESOLVED' AND "detail" IN ('ON_ZONE_BOUNDARY', 'OVERLAPPING_ZONES'))))
  ),
  ADD CONSTRAINT "serviceability_decision_dataset_revision_check" CHECK ("dataset_revision" >= 1),
  -- NUMERIC accepts 'NaN'; a decided point must be finite and in range.
  ADD CONSTRAINT "serviceability_decision_point_check" CHECK (
    "latitude" <> 'NaN'::numeric AND "longitude" <> 'NaN'::numeric
    AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180
  ),
  ADD CONSTRAINT "serviceability_decision_expiry_check" CHECK ("expires_at" > "checked_at");

-- Decisions are facts: UPDATE is refused regardless of grants. DELETE stays
-- possible for the retention purge (rows past expiry + retention only).
CREATE FUNCTION "serviceability_decision_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'serviceability_decision is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "serviceability_decision_no_update"
  BEFORE UPDATE ON "serviceability_decision"
  FOR EACH ROW EXECUTE FUNCTION "serviceability_decision_immutable"();

-- Same hardening as P01-A3: no inherited PUBLIC EXECUTE on trigger functions.
REVOKE ALL ON FUNCTION "serviceability_decision_immutable"() FROM PUBLIC;
