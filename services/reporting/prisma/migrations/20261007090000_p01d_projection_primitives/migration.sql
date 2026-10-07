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

-- The contribution ledger is append-only evidence for bucket reconciliation:
-- whichever runtime identity received DML through default privileges may add
-- rows but never rewrite or remove them. Grantees are discovered rather than
-- named, so the rule holds for every environment's role naming.
DO $$
DECLARE
  grantee_name TEXT;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = current_schema()
      AND table_name = 'projection_contribution'
      AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
      AND grantee <> current_user
  LOOP
    EXECUTE format(
      'REVOKE UPDATE, DELETE, TRUNCATE ON %I.projection_contribution FROM %I',
      current_schema(), grantee_name
    );
  END LOOP;
END $$;
