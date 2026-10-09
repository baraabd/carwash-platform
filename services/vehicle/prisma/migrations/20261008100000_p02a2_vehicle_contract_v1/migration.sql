-- P02-A2: align the vehicle store with the published vehicle.v1 contract.
-- Applied by the migration identity (cw_vehicle_migrate) as a separate job.
--
-- Expand only. New columns are nullable, one column is widened, a looser
-- constraint replaces a P01 one, and new audit columns default to the existing
-- meaning. No row is rewritten or deleted and no column is renamed: the P01
-- column "display_name" keeps holding the name, now exposed as `nickname`.
--
-- Invariants that existing rows were not written under are added NOT VALID:
-- PostgreSQL enforces them for every new or updated row; existing rows stay as
-- they are until a reviewed VALIDATE CONSTRAINT step (see
-- docs/production/A/P02-A2_VEHICLE_V1_PROVIDER.md, "Data conformance").
--
-- Rollback: redeploy the previous application AND drop the two NOT VALID
-- constraints added here ("vehicle_plate_v1_check", "vehicle_nickname_v1_check"),
-- because the P01 application may write lowercase or longer plates/names. The
-- widened and added columns are harmless to it. Re-adding the P01 plate check
-- needs a reviewed data plan, because vehicle.v1 plates may lack a digit or use
-- Arabic-Indic digits.

-- vehicle.v1 VehicleInputV1: make, model and plate region are new optional text.
ALTER TABLE "vehicle" ADD COLUMN "make" VARCHAR(40);
ALTER TABLE "vehicle" ADD COLUMN "model" VARCHAR(40);
ALTER TABLE "vehicle" ADD COLUMN "plate_region" VARCHAR(30);
-- vehicle.v1 colours are up to 40 characters (P01: 30). Widening a VARCHAR does
-- not rewrite the table.
ALTER TABLE "vehicle" ALTER COLUMN "color" TYPE VARCHAR(40);

ALTER TABLE "vehicle"
  ADD CONSTRAINT "vehicle_make_check" CHECK ("make" IS NULL OR char_length(btrim("make")) >= 1),
  ADD CONSTRAINT "vehicle_model_check" CHECK ("model" IS NULL OR char_length(btrim("model")) >= 1),
  -- A region only qualifies a plate that exists.
  ADD CONSTRAINT "vehicle_plate_region_check" CHECK (
    "plate_region" IS NULL
    OR ("plate" IS NOT NULL AND char_length(btrim("plate_region")) >= 1)
  );

-- vehicle.v1 plate text: 1-12 characters of uppercase Latin letters, Arabic
-- letters, ASCII and Arabic-Indic digits and '-', single inner spaces. The P01
-- check demanded a digit and refused Arabic-Indic digits, so it would refuse
-- valid vehicle.v1 plates and is replaced. P01 rows may hold lowercase or longer
-- plates, so the new rule applies to new and updated rows only.
ALTER TABLE "vehicle" DROP CONSTRAINT "vehicle_plate_check";
ALTER TABLE "vehicle"
  ADD CONSTRAINT "vehicle_plate_v1_check" CHECK (
    "plate" IS NULL OR (
      char_length("plate") BETWEEN 1 AND 12
      AND "plate" ~ '^[A-Z0-9٠-٩ء-ي-]+( [A-Z0-9٠-٩ء-ي-]+)*$'
    )
  ) NOT VALID;
-- vehicle.v1 nickname: at most 40 characters (P01 display names: 60).
ALTER TABLE "vehicle"
  ADD CONSTRAINT "vehicle_nickname_v1_check"
  CHECK ("display_name" IS NULL OR char_length("display_name") <= 40) NOT VALID;

-- Keyset pagination of a principal's active vehicles (createdAt, id).
CREATE INDEX "vehicle_owner_page_idx"
  ON "vehicle"("owner_kind", "owner_subject", "status", "created_at", "id");

-- Audit: a fact is either a principal action (subject + session) or a service
-- snapshot read with a declared purpose. Existing rows are principal actions.
ALTER TABLE "audit_entry" ADD COLUMN "actor_kind" VARCHAR(16) NOT NULL DEFAULT 'principal';
ALTER TABLE "audit_entry" ADD COLUMN "actor_service" VARCHAR(60);
ALTER TABLE "audit_entry" ADD COLUMN "purpose" VARCHAR(40);
ALTER TABLE "audit_entry" ALTER COLUMN "actor_subject" DROP NOT NULL;
ALTER TABLE "audit_entry" ALTER COLUMN "actor_session_id" DROP NOT NULL;
ALTER TABLE "audit_entry"
  ADD CONSTRAINT "audit_entry_actor_check" CHECK (
    ("actor_kind" = 'principal'
       AND "actor_subject" IS NOT NULL AND "actor_session_id" IS NOT NULL
       AND "actor_service" IS NULL AND "purpose" IS NULL)
    OR
    ("actor_kind" = 'service'
       AND "actor_service" IS NOT NULL AND "actor_service" ~ '^[a-z][a-z0-9-]{1,59}$'
       AND "actor_subject" IS NULL AND "actor_session_id" IS NULL
       AND "purpose" IS NOT NULL
       AND "purpose" IN ('booking-quote', 'booking-create', 'booking-display'))
  );