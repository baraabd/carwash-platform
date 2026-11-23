-- P01-D projection primitives for the reporting service.
-- Applied by the migration identity (cw_reporting_migrate) as a separate job.
-- Application replicas never run this file. Additive only: no existing table,
-- column or row is changed, so the previous worker build keeps working
-- against this schema (expand step; there is no contract step).

-- CreateTable
CREATE TABLE "projection_contribution" (
    "projection" VARCHAR(64) NOT NULL,
    "source_service" VARCHAR(32) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "source_event_type" VARCHAR(96) NOT NULL,
    "metric_key" VARCHAR(96) NOT NULL,
    "bucket_day" DATE NOT NULL,
    "delta" BIGINT NOT NULL,
    "contribution_hash" CHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projection_contribution_pkey" PRIMARY KEY ("projection","source_service","source_event_id"),
    CONSTRAINT "projection_contribution_delta_nonzero" CHECK ("delta" <> 0),
    CONSTRAINT "projection_contribution_hash_hex" CHECK ("contribution_hash" ~ '^[0-9a-f]{64}$')
);

-- CreateTable
CREATE TABLE "metric_bucket" (
    "projection" VARCHAR(64) NOT NULL,
    "metric_key" VARCHAR(96) NOT NULL,
    "bucket_day" DATE NOT NULL,
    "value" BIGINT NOT NULL,
    "contribution_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_bucket_pkey" PRIMARY KEY ("projection","metric_key","bucket_day"),
    CONSTRAINT "metric_bucket_count_positive" CHECK ("contribution_count" >= 1)
);

-- CreateTable
CREATE TABLE "aggregate_snapshot" (
    "projection" VARCHAR(64) NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "state_hash" CHAR(64) NOT NULL,
    "source_service" VARCHAR(32) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aggregate_snapshot_pkey" PRIMARY KEY ("projection","aggregate_type","aggregate_id"),
    CONSTRAINT "aggregate_snapshot_version_positive" CHECK ("version" >= 1),
    CONSTRAINT "aggregate_snapshot_state_object" CHECK (jsonb_typeof("state") = 'object')
);

-- The contribution ledger is append-only evidence for bucket reconciliation.
-- It is enforced by the database itself, independent of any role's grants:
-- provisioning deliberately (re)grants generic DML on every table to the
-- runtime role, so an ACL-only rule would silently disappear on a replay.
-- TRUNCATE needs no trigger: provisioning never grants it to the runtime role.
-- Same convention as the Catalog immutable tables.
CREATE FUNCTION "app"."reporting_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'REPORTING_LEDGER_IMMUTABLE: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "projection_contribution_immutable" BEFORE UPDATE OR DELETE ON "app"."projection_contribution" FOR EACH ROW EXECUTE FUNCTION "app"."reporting_reject_mutation"();

-- Functions are created with EXECUTE granted to PUBLIC by default. A trigger
-- function needs no caller privilege, so nobody is granted EXECUTE.
REVOKE ALL ON FUNCTION "app"."reporting_reject_mutation"() FROM PUBLIC;
