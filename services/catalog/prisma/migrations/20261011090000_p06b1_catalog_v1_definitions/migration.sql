-- P06-B1: catalog.v1 definitions (published contract shape).
-- Applied by the migration identity (cw_catalog_migrate) as a separate job.
-- Additive only (expand phase): no existing table, column or row is dropped.
-- The P01-B1 revision tables stay as frozen, immutable legacy storage; the
-- runtime no longer writes them. Dropping them is a later contract-phase
-- migration that needs its own reviewed data plan.

-- Publications ---------------------------------------------------------------
-- One row per catalog revision. Each revision stores the COMPLETE snapshot of
-- definitions (retired ones included) in catalog_v1_definition.
CREATE TABLE "app"."catalog_v1_publication" (
    "catalog_revision" INTEGER NOT NULL,
    "previous_revision" INTEGER,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "snapshot_fingerprint" CHAR(64) NOT NULL,
    CONSTRAINT "catalog_v1_publication_pkey" PRIMARY KEY ("catalog_revision"),
    CONSTRAINT "catalog_v1_publication_positive" CHECK ("catalog_revision" > 0),
    CONSTRAINT "catalog_v1_publication_linear_chain" CHECK (
        ("catalog_revision" = 1 AND "previous_revision" IS NULL)
        OR ("catalog_revision" > 1 AND "previous_revision" = "catalog_revision" - 1)
    ),
    CONSTRAINT "catalog_v1_publication_reason_code" CHECK ("reason_code" ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    CONSTRAINT "catalog_v1_publication_fingerprint_hex" CHECK ("snapshot_fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "catalog_v1_publication_previous_revision_key" ON "app"."catalog_v1_publication"("previous_revision");
ALTER TABLE "app"."catalog_v1_publication" ADD CONSTRAINT "catalog_v1_publication_previous_revision_fkey"
    FOREIGN KEY ("previous_revision") REFERENCES "app"."catalog_v1_publication"("catalog_revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Definition identity ----------------------------------------------------------
-- Insert-only. Binds a definitionId to its kind and code forever: the code is
-- globally unique (never reused, even after retirement) and every snapshot row
-- references (definition_id, code, kind) through a composite foreign key.
CREATE TABLE "app"."catalog_v1_definition_identity" (
    "definition_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "first_catalog_revision" INTEGER NOT NULL,
    CONSTRAINT "catalog_v1_definition_identity_pkey" PRIMARY KEY ("definition_id"),
    CONSTRAINT "catalog_v1_definition_identity_code_format" CHECK ("code" ~ '^[a-z][a-z0-9-]{1,39}$'),
    CONSTRAINT "catalog_v1_definition_identity_kind" CHECK ("kind" IN ('PACKAGE', 'EXTRA'))
);
CREATE UNIQUE INDEX "catalog_v1_definition_identity_code_key" ON "app"."catalog_v1_definition_identity"("code");
CREATE UNIQUE INDEX "catalog_v1_definition_identity_binding_key" ON "app"."catalog_v1_definition_identity"("definition_id", "code", "kind");
ALTER TABLE "app"."catalog_v1_definition_identity" ADD CONSTRAINT "catalog_v1_definition_identity_first_catalog_revision_fkey"
    FOREIGN KEY ("first_catalog_revision") REFERENCES "app"."catalog_v1_publication"("catalog_revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Snapshot rows ----------------------------------------------------------------
CREATE TABLE "app"."catalog_v1_definition" (
    "catalog_revision" INTEGER NOT NULL,
    "definition_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name_ar" VARCHAR(80) NOT NULL,
    "name_en" VARCHAR(80),
    "description_ar" VARCHAR(500) NOT NULL,
    "description_en" VARCHAR(500),
    "duration_minutes" INTEGER NOT NULL,
    "vehicle_types" VARCHAR(16)[] NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "catalog_v1_definition_pkey" PRIMARY KEY ("catalog_revision","definition_id"),
    CONSTRAINT "catalog_v1_definition_revision_positive" CHECK ("revision" > 0),
    CONSTRAINT "catalog_v1_definition_kind" CHECK ("kind" IN ('PACKAGE', 'EXTRA')),
    CONSTRAINT "catalog_v1_definition_status" CHECK ("status" IN ('PUBLISHED', 'RETIRED')),
    CONSTRAINT "catalog_v1_definition_text" CHECK (
        length("name_ar") > 0 AND ("name_en" IS NULL OR length("name_en") > 0)
        AND length("description_ar") > 0 AND ("description_en" IS NULL OR length("description_en") > 0)
    ),
    CONSTRAINT "catalog_v1_definition_duration" CHECK ("duration_minutes" BETWEEN 5 AND 480),
    CONSTRAINT "catalog_v1_definition_sort_order" CHECK ("sort_order" BETWEEN 0 AND 10000),
    CONSTRAINT "catalog_v1_definition_vehicle_types" CHECK (
        cardinality("vehicle_types") BETWEEN 1 AND 4
        AND "vehicle_types" <@ ARRAY['sedan', 'suv', 'large', 'pickup']::VARCHAR(16)[]
        AND array_position("vehicle_types", NULL) IS NULL
    )
);
CREATE UNIQUE INDEX "catalog_v1_definition_catalog_revision_code_key" ON "app"."catalog_v1_definition"("catalog_revision", "code");
CREATE INDEX "catalog_v1_definition_definition_id_idx" ON "app"."catalog_v1_definition"("definition_id", "catalog_revision");
ALTER TABLE "app"."catalog_v1_definition" ADD CONSTRAINT "catalog_v1_definition_catalog_revision_fkey"
    FOREIGN KEY ("catalog_revision") REFERENCES "app"."catalog_v1_publication"("catalog_revision") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_v1_definition" ADD CONSTRAINT "catalog_v1_definition_identity_fkey"
    FOREIGN KEY ("definition_id", "code", "kind") REFERENCES "app"."catalog_v1_definition_identity"("definition_id", "code", "kind") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Audit widening ---------------------------------------------------------------
-- Existing actions stay valid; reason_code is nullable so old rows are untouched.
ALTER TABLE "app"."catalog_audit_event" ADD COLUMN "reason_code" VARCHAR(64);
ALTER TABLE "app"."catalog_audit_event" DROP CONSTRAINT "catalog_audit_event_action";
ALTER TABLE "app"."catalog_audit_event" ADD CONSTRAINT "catalog_audit_event_action" CHECK ("action" IN (
    'catalog.revision.published',
    'catalog.revision.publish-rejected',
    'catalog.definitions.published',
    'catalog.definitions.publish-rejected'
));

-- Database-enforced invariants -------------------------------------------------
-- Snapshot and identity rows may only be written by the transaction that
-- created their publication; a published revision can never gain rows later.
CREATE FUNCTION "app"."catalog_v1_require_open_publication"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    target INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'catalog_v1_definition_identity' THEN
        target := NEW."first_catalog_revision";
    ELSE
        target := NEW."catalog_revision";
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "app"."catalog_v1_publication" p
         WHERE p."catalog_revision" = target AND p.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'CATALOG_REVISION_IMMUTABLE: %', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Per-definition continuity against the previous snapshot: retirement is final,
-- a new definition starts at revision 1 and the content revision moves by 0 or 1.
CREATE FUNCTION "app"."catalog_v1_require_definition_continuity"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    prior RECORD;
BEGIN
    SELECT d."revision", d."status" INTO prior
      FROM "app"."catalog_v1_definition" d
     WHERE d."catalog_revision" = NEW."catalog_revision" - 1
       AND d."definition_id" = NEW."definition_id";
    IF NOT FOUND THEN
        IF NEW."revision" <> 1 OR NEW."status" <> 'PUBLISHED' THEN
            RAISE EXCEPTION 'CATALOG_NEW_DEFINITION_INVALID' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;
    IF prior."status" = 'RETIRED' AND NEW."status" = 'PUBLISHED' THEN
        RAISE EXCEPTION 'CATALOG_DEFINITION_RETIRED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."revision" NOT IN (prior."revision", prior."revision" + 1) THEN
        RAISE EXCEPTION 'CATALOG_DEFINITION_REVISION_GAP' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- COMMIT-time completeness: a publication carries at least one definition and
-- every definition of the previous snapshot (no silent disappearance).
CREATE FUNCTION "app"."catalog_v1_require_complete_snapshot"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."catalog_v1_definition" d WHERE d."catalog_revision" = NEW."catalog_revision"
    ) THEN
        RAISE EXCEPTION 'CATALOG_SNAPSHOT_EMPTY' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "app"."catalog_v1_definition" p
         WHERE p."catalog_revision" = NEW."catalog_revision" - 1
           AND NOT EXISTS (
               SELECT 1 FROM "app"."catalog_v1_definition" n
                WHERE n."catalog_revision" = NEW."catalog_revision"
                  AND n."definition_id" = p."definition_id"
           )
    ) THEN
        RAISE EXCEPTION 'CATALOG_SNAPSHOT_INCOMPLETE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "catalog_v1_publication_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_v1_publication" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_v1_definition_identity_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_v1_definition_identity" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_v1_definition_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_v1_definition" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();

CREATE TRIGGER "catalog_v1_definition_identity_open_publication" BEFORE INSERT ON "app"."catalog_v1_definition_identity" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_v1_require_open_publication"();
CREATE TRIGGER "catalog_v1_definition_open_publication" BEFORE INSERT ON "app"."catalog_v1_definition" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_v1_require_open_publication"();
CREATE TRIGGER "catalog_v1_definition_continuity" BEFORE INSERT ON "app"."catalog_v1_definition" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_v1_require_definition_continuity"();
CREATE CONSTRAINT TRIGGER "catalog_v1_publication_complete" AFTER INSERT ON "app"."catalog_v1_publication"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."catalog_v1_require_complete_snapshot"();

-- Trigger functions need no caller privilege, so nobody may call them directly.
REVOKE ALL ON FUNCTION "app"."catalog_v1_require_open_publication"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."catalog_v1_require_definition_continuity"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."catalog_v1_require_complete_snapshot"() FROM PUBLIC;
