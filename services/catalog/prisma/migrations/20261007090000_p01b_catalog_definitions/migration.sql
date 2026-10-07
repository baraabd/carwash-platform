-- P01-B1: catalog definitions, immutable revisions, idempotency receipts, audit.
-- Applied by the migration identity (cw_catalog_migrate) as a separate job.
-- Application replicas never run this file. Additive only: no existing object
-- is altered or dropped, so the previous release keeps working (expand phase).

-- Publication serialisation -------------------------------------------------
CREATE TABLE "app"."catalog_publication_lock" (
    "id" SMALLINT NOT NULL,
    CONSTRAINT "catalog_publication_lock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_publication_lock_singleton" CHECK ("id" = 1)
);
INSERT INTO "app"."catalog_publication_lock" ("id") VALUES (1);

-- Revisions -----------------------------------------------------------------
CREATE TABLE "app"."catalog_revision" (
    "revision" INTEGER NOT NULL,
    "previous_revision" INTEGER,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "definitions_fingerprint" CHAR(64) NOT NULL,
    CONSTRAINT "catalog_revision_pkey" PRIMARY KEY ("revision"),
    CONSTRAINT "catalog_revision_positive" CHECK ("revision" > 0),
    CONSTRAINT "catalog_revision_linear_chain" CHECK (
        ("revision" = 1 AND "previous_revision" IS NULL)
        OR ("revision" > 1 AND "previous_revision" = "revision" - 1)
    ),
    CONSTRAINT "catalog_revision_not_retroactive" CHECK ("effective_from" >= "published_at"),
    CONSTRAINT "catalog_revision_fingerprint_hex" CHECK ("definitions_fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "catalog_revision_previous_revision_key" ON "app"."catalog_revision"("previous_revision");
CREATE UNIQUE INDEX "catalog_revision_effective_from_key" ON "app"."catalog_revision"("effective_from");
ALTER TABLE "app"."catalog_revision" ADD CONSTRAINT "catalog_revision_previous_revision_fkey"
    FOREIGN KEY ("previous_revision") REFERENCES "app"."catalog_revision"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Definitions ---------------------------------------------------------------
CREATE TABLE "app"."catalog_vehicle_category" (
    "revision" INTEGER NOT NULL,
    "id" VARCHAR(48) NOT NULL,
    "label_ar" VARCHAR(80) NOT NULL,
    "label_en" VARCHAR(80),
    "extra_duration_minutes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "catalog_vehicle_category_pkey" PRIMARY KEY ("revision","id"),
    CONSTRAINT "catalog_vehicle_category_id_format" CHECK ("id" ~ '^[a-z][a-z0-9-]{1,47}$'),
    CONSTRAINT "catalog_vehicle_category_label" CHECK (length("label_ar") > 0 AND ("label_en" IS NULL OR length("label_en") > 0)),
    CONSTRAINT "catalog_vehicle_category_extra_minutes" CHECK ("extra_duration_minutes" BETWEEN 0 AND 240),
    CONSTRAINT "catalog_vehicle_category_sort_order" CHECK ("sort_order" BETWEEN 0 AND 10000)
);

CREATE TABLE "app"."catalog_package" (
    "revision" INTEGER NOT NULL,
    "id" VARCHAR(48) NOT NULL,
    "label_ar" VARCHAR(80) NOT NULL,
    "label_en" VARCHAR(80),
    "description_ar" VARCHAR(280),
    "duration_minutes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "features_ar" TEXT[],
    CONSTRAINT "catalog_package_pkey" PRIMARY KEY ("revision","id"),
    CONSTRAINT "catalog_package_id_format" CHECK ("id" ~ '^[a-z][a-z0-9-]{1,47}$'),
    CONSTRAINT "catalog_package_label" CHECK (length("label_ar") > 0 AND ("label_en" IS NULL OR length("label_en") > 0)),
    CONSTRAINT "catalog_package_duration" CHECK ("duration_minutes" BETWEEN 1 AND 600),
    CONSTRAINT "catalog_package_sort_order" CHECK ("sort_order" BETWEEN 0 AND 10000),
    CONSTRAINT "catalog_package_features" CHECK ("features_ar" IS NOT NULL AND cardinality("features_ar") <= 10)
);

CREATE TABLE "app"."catalog_addon" (
    "revision" INTEGER NOT NULL,
    "id" VARCHAR(48) NOT NULL,
    "label_ar" VARCHAR(80) NOT NULL,
    "label_en" VARCHAR(80),
    "duration_minutes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "catalog_addon_pkey" PRIMARY KEY ("revision","id"),
    CONSTRAINT "catalog_addon_id_format" CHECK ("id" ~ '^[a-z][a-z0-9-]{1,47}$'),
    CONSTRAINT "catalog_addon_label" CHECK (length("label_ar") > 0 AND ("label_en" IS NULL OR length("label_en") > 0)),
    CONSTRAINT "catalog_addon_duration" CHECK ("duration_minutes" BETWEEN 1 AND 240),
    CONSTRAINT "catalog_addon_sort_order" CHECK ("sort_order" BETWEEN 0 AND 10000)
);

CREATE TABLE "app"."catalog_package_category" (
    "revision" INTEGER NOT NULL,
    "package_id" VARCHAR(48) NOT NULL,
    "category_id" VARCHAR(48) NOT NULL,
    CONSTRAINT "catalog_package_category_pkey" PRIMARY KEY ("revision","package_id","category_id")
);

CREATE TABLE "app"."catalog_addon_category" (
    "revision" INTEGER NOT NULL,
    "addon_id" VARCHAR(48) NOT NULL,
    "category_id" VARCHAR(48) NOT NULL,
    CONSTRAINT "catalog_addon_category_pkey" PRIMARY KEY ("revision","addon_id","category_id")
);

-- One row per (package, add-on): an add-on cannot be INCLUDED and OPTIONAL at once.
CREATE TABLE "app"."catalog_package_addon" (
    "revision" INTEGER NOT NULL,
    "package_id" VARCHAR(48) NOT NULL,
    "addon_id" VARCHAR(48) NOT NULL,
    "relation" VARCHAR(8) NOT NULL,
    CONSTRAINT "catalog_package_addon_pkey" PRIMARY KEY ("revision","package_id","addon_id"),
    CONSTRAINT "catalog_package_addon_relation" CHECK ("relation" IN ('INCLUDED', 'OPTIONAL'))
);

ALTER TABLE "app"."catalog_vehicle_category" ADD CONSTRAINT "catalog_vehicle_category_revision_fkey"
    FOREIGN KEY ("revision") REFERENCES "app"."catalog_revision"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_package" ADD CONSTRAINT "catalog_package_revision_fkey"
    FOREIGN KEY ("revision") REFERENCES "app"."catalog_revision"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_addon" ADD CONSTRAINT "catalog_addon_revision_fkey"
    FOREIGN KEY ("revision") REFERENCES "app"."catalog_revision"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_package_category" ADD CONSTRAINT "catalog_package_category_revision_package_id_fkey"
    FOREIGN KEY ("revision", "package_id") REFERENCES "app"."catalog_package"("revision", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_package_category" ADD CONSTRAINT "catalog_package_category_revision_category_id_fkey"
    FOREIGN KEY ("revision", "category_id") REFERENCES "app"."catalog_vehicle_category"("revision", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_addon_category" ADD CONSTRAINT "catalog_addon_category_revision_addon_id_fkey"
    FOREIGN KEY ("revision", "addon_id") REFERENCES "app"."catalog_addon"("revision", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_addon_category" ADD CONSTRAINT "catalog_addon_category_revision_category_id_fkey"
    FOREIGN KEY ("revision", "category_id") REFERENCES "app"."catalog_vehicle_category"("revision", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_package_addon" ADD CONSTRAINT "catalog_package_addon_revision_package_id_fkey"
    FOREIGN KEY ("revision", "package_id") REFERENCES "app"."catalog_package"("revision", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."catalog_package_addon" ADD CONSTRAINT "catalog_package_addon_revision_addon_id_fkey"
    FOREIGN KEY ("revision", "addon_id") REFERENCES "app"."catalog_addon"("revision", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Idempotency and audit -----------------------------------------------------
CREATE TABLE "app"."catalog_idempotency_receipt" (
    "actor_subject" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "catalog_idempotency_receipt_pkey" PRIMARY KEY ("actor_subject","operation","idempotency_key"),
    CONSTRAINT "catalog_idempotency_receipt_key_format" CHECK ("idempotency_key" ~ '^[A-Za-z0-9_-]{16,128}$'),
    CONSTRAINT "catalog_idempotency_receipt_fingerprint_hex" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "catalog_idempotency_receipt_status" CHECK ("response_status" BETWEEN 200 AND 599)
);

CREATE TABLE "app"."catalog_audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "revision" INTEGER,
    "outcome" VARCHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "catalog_audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_audit_event_action" CHECK ("action" IN ('catalog.revision.published', 'catalog.revision.publish-rejected'))
);
CREATE INDEX "catalog_audit_event_occurred_idx" ON "app"."catalog_audit_event"("occurred_at");

-- Immutability enforced by the database, independent of any application role.
CREATE FUNCTION "app"."catalog_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'CATALOG_IMMUTABLE: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- A definition row may only be written by the transaction that created its
-- revision. A later transaction can never add rows to a published revision.
CREATE FUNCTION "app"."catalog_require_open_revision"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."catalog_revision" r
         WHERE r."revision" = NEW."revision" AND r.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'CATALOG_REVISION_IMMUTABLE: %', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Effective dates strictly increase along the chain, so windows never overlap.
CREATE FUNCTION "app"."catalog_require_increasing_effective_from"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."previous_revision" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "app"."catalog_revision" p
         WHERE p."revision" = NEW."previous_revision" AND p."effective_from" >= NEW."effective_from"
    ) THEN
        RAISE EXCEPTION 'CATALOG_EFFECTIVE_FROM_NOT_INCREASING' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "catalog_revision_increasing_effective_from"
    BEFORE INSERT ON "app"."catalog_revision"
    FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_increasing_effective_from"();

CREATE TRIGGER "catalog_publication_lock_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_publication_lock" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_revision_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_revision" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_vehicle_category_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_vehicle_category" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_package_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_package" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_addon_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_addon" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_package_category_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_package_category" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_addon_category_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_addon_category" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_package_addon_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_package_addon" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_idempotency_receipt_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_idempotency_receipt" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();
CREATE TRIGGER "catalog_audit_event_immutable" BEFORE UPDATE OR DELETE ON "app"."catalog_audit_event" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_reject_mutation"();

CREATE TRIGGER "catalog_vehicle_category_open_revision" BEFORE INSERT ON "app"."catalog_vehicle_category" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_open_revision"();
CREATE TRIGGER "catalog_package_open_revision" BEFORE INSERT ON "app"."catalog_package" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_open_revision"();
CREATE TRIGGER "catalog_addon_open_revision" BEFORE INSERT ON "app"."catalog_addon" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_open_revision"();
CREATE TRIGGER "catalog_package_category_open_revision" BEFORE INSERT ON "app"."catalog_package_category" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_open_revision"();
CREATE TRIGGER "catalog_addon_category_open_revision" BEFORE INSERT ON "app"."catalog_addon_category" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_open_revision"();
CREATE TRIGGER "catalog_package_addon_open_revision" BEFORE INSERT ON "app"."catalog_package_addon" FOR EACH ROW EXECUTE FUNCTION "app"."catalog_require_open_revision"();
