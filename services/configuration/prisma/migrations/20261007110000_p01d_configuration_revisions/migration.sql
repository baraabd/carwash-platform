-- P01-D versioned configuration for the configuration service.
-- Applied by the migration identity (cw_configuration_migrate) as a separate
-- job; application replicas never run this file. Additive only (expand step).
-- CreateTable
CREATE TABLE "config_revision" (
    "id" UUID NOT NULL,
    "namespace" VARCHAR(32) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(16) NOT NULL,
    "tenant_scope" VARCHAR(36) NOT NULL,
    "revision" INTEGER NOT NULL,
    "value_type" VARCHAR(16) NOT NULL,
    "value" JSONB NOT NULL,
    "value_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "author_subject" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "proposed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_review" (
    "revision_id" UUID NOT NULL,
    "decision" VARCHAR(10) NOT NULL,
    "reviewer_subject" UUID NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_review_pkey" PRIMARY KEY ("revision_id")
);

-- CreateTable
CREATE TABLE "config_pointer" (
    "namespace" VARCHAR(32) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(16) NOT NULL,
    "tenant_scope" VARCHAR(36) NOT NULL,
    "active_revision_id" UUID NOT NULL,
    "active_revision" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_pointer_pkey" PRIMARY KEY ("namespace","key","environment","tenant_scope")
);

-- CreateTable
CREATE TABLE "config_audit" (
    "id" UUID NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "scope_key" VARCHAR(160) NOT NULL,
    "value_hash" CHAR(64) NOT NULL,
    "correlation_id" VARCHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "config_revision_namespace_key_environment_tenant_scope_revi_key" ON "config_revision"("namespace", "key", "environment", "tenant_scope", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "config_revision_author_subject_idempotency_key_key" ON "config_revision"("author_subject", "idempotency_key");

-- CreateIndex
CREATE INDEX "config_audit_revision_id_idx" ON "config_audit"("revision_id");

-- AddForeignKey
ALTER TABLE "config_review" ADD CONSTRAINT "config_review_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "config_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Closed vocabularies and invariants the database enforces on its own.
ALTER TABLE "config_revision"
  ADD CONSTRAINT "config_revision_environment_known" CHECK ("environment" IN ('development', 'staging', 'production')),
  ADD CONSTRAINT "config_revision_value_type_known" CHECK ("value_type" IN ('boolean', 'integer', 'decimal', 'string', 'duration-ms')),
  ADD CONSTRAINT "config_revision_number_positive" CHECK ("revision" >= 1),
  ADD CONSTRAINT "config_revision_tenant_scope_shape" CHECK (
    "tenant_scope" = '*' OR "tenant_scope" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  ADD CONSTRAINT "config_revision_hashes_hex" CHECK ("value_hash" ~ '^[0-9a-f]{64}$' AND "request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "config_review"
  ADD CONSTRAINT "config_review_decision_known" CHECK ("decision" IN ('APPROVED', 'REJECTED'));

ALTER TABLE "config_pointer"
  ADD CONSTRAINT "config_pointer_versions_positive" CHECK ("active_revision" >= 1 AND "version" >= 1);

ALTER TABLE "config_audit"
  ADD CONSTRAINT "config_audit_action_known" CHECK ("action" IN ('PROPOSED', 'APPROVED', 'REJECTED', 'ACTIVATED'));

-- Revisions, reviews and audit rows are history: whichever runtime identity
-- received DML through default privileges may add rows, never rewrite or
-- remove them. Grantees are discovered, not named, so this holds for every
-- environment's role naming. config_pointer stays updatable by design.
DO $$
DECLARE
  target TEXT;
  grantee_name TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['config_revision', 'config_review', 'config_audit'] LOOP
    FOR grantee_name IN
      SELECT DISTINCT grantee
      FROM information_schema.role_table_grants
      WHERE table_schema = current_schema()
        AND table_name = target
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
        AND grantee <> current_user
    LOOP
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.%I FROM %I', current_schema(), target, grantee_name);
    END LOOP;
  END LOOP;
END $$;
