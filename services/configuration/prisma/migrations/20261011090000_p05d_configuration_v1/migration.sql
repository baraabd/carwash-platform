-- P05-D5 configuration.v1: market-scoped, closed namespaces published through
-- draft -> approve (four eyes) -> publish, with a transactional outbox.
-- Applied by the migration identity (cw_configuration_migrate) as a separate
-- job; application replicas never run this file. EXPAND step only: the P01-D3
-- tables (config_revision/review/pointer/audit) are kept untouched.

-- CreateTable
CREATE TABLE "config_scope" (
    "id" UUID NOT NULL,
    "market_id" VARCHAR(11) NOT NULL,
    "namespace" VARCHAR(32) NOT NULL,
    "published_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_draft" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "base_version" INTEGER,
    "content" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "author_subject" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(3),
    "published_version" INTEGER,
    "withdrawn_by" UUID,
    "withdrawn_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_version" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "draft_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_history" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "draft_revision" INTEGER NOT NULL,
    "version" INTEGER,
    "content_hash" CHAR(64) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "reason" VARCHAR(500),
    "correlation_id" VARCHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_idempotency" (
    "actor_subject" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_idempotency_pkey" PRIMARY KEY ("actor_subject","idempotency_key")
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

-- CreateIndex
CREATE UNIQUE INDEX "config_scope_market_id_namespace_key" ON "config_scope"("market_id", "namespace");

-- CreateIndex
CREATE INDEX "config_draft_scope_id_created_at_idx" ON "config_draft"("scope_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "config_version_draft_id_key" ON "config_version"("draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "config_version_scope_id_version_key" ON "config_version"("scope_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "config_history_seq_key" ON "config_history"("seq");

-- CreateIndex
CREATE INDEX "config_history_scope_id_seq_idx" ON "config_history"("scope_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_published_at_dead_at_created_at_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- AddForeignKey
ALTER TABLE "config_draft" ADD CONSTRAINT "config_draft_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "config_scope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "config_version" ADD CONSTRAINT "config_version_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "config_scope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "config_version" ADD CONSTRAINT "config_version_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "config_draft"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "config_history" ADD CONSTRAINT "config_history_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "config_scope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Invariants the database enforces on its own (defence in depth below the
-- application; the runtime role has no DDL and cannot drop these).
-- ---------------------------------------------------------------------------

ALTER TABLE "config_scope"
  ADD CONSTRAINT "config_scope_market_id_shape" CHECK ("market_id" ~ '^[a-z]{2}(-[a-z0-9]{2,8})?$'),
  ADD CONSTRAINT "config_scope_namespace_known" CHECK ("namespace" IN ('booking.policy.v1', 'market.presentation.v1')),
  ADD CONSTRAINT "config_scope_published_version_range" CHECK ("published_version" >= 0);

ALTER TABLE "config_draft"
  ADD CONSTRAINT "config_draft_status_known" CHECK ("status" IN ('DRAFT', 'APPROVED', 'PUBLISHED', 'WITHDRAWN')),
  ADD CONSTRAINT "config_draft_revision_positive" CHECK ("revision" >= 1),
  ADD CONSTRAINT "config_draft_base_version_positive" CHECK ("base_version" IS NULL OR "base_version" >= 1),
  ADD CONSTRAINT "config_draft_hash_hex" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  -- Four eyes, held by the database too: nobody approves their own draft.
  ADD CONSTRAINT "config_draft_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "author_subject"),
  -- Every state carries exactly the facts that state requires.
  ADD CONSTRAINT "config_draft_state_facts" CHECK (
    CASE "status"
      WHEN 'DRAFT' THEN "approved_by" IS NULL AND "approved_at" IS NULL
                     AND "published_by" IS NULL AND "published_version" IS NULL
                     AND "withdrawn_by" IS NULL
      WHEN 'APPROVED' THEN "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL
                     AND "published_by" IS NULL AND "published_version" IS NULL
                     AND "withdrawn_by" IS NULL
      WHEN 'PUBLISHED' THEN "approved_by" IS NOT NULL AND "published_by" IS NOT NULL
                     AND "published_at" IS NOT NULL AND "published_version" >= 1
                     AND "withdrawn_by" IS NULL
      WHEN 'WITHDRAWN' THEN "withdrawn_by" IS NOT NULL AND "withdrawn_at" IS NOT NULL
                     AND "published_by" IS NULL AND "published_version" IS NULL
    END);

-- At most one OPEN draft per scope: concurrent drafts on one scope cannot both win.
CREATE UNIQUE INDEX "config_draft_one_open_per_scope" ON "config_draft"("scope_id")
  WHERE "status" IN ('DRAFT', 'APPROVED');

ALTER TABLE "config_version"
  ADD CONSTRAINT "config_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "config_version_hash_hex" CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "config_history"
  ADD CONSTRAINT "config_history_action_known" CHECK ("action" IN ('DRAFT_CREATED', 'DRAFT_APPROVED', 'DRAFT_PUBLISHED', 'DRAFT_WITHDRAWN')),
  ADD CONSTRAINT "config_history_hash_hex" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "config_history_version_on_publish" CHECK (("action" = 'DRAFT_PUBLISHED') = ("version" IS NOT NULL));

ALTER TABLE "config_idempotency"
  ADD CONSTRAINT "config_idempotency_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "config_idempotency_status_range" CHECK ("status_code" BETWEEN 200 AND 299);

-- A scope's published version only ever moves forward by exactly one.
CREATE FUNCTION "config_scope_version_forward"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."market_id" <> OLD."market_id" OR NEW."namespace" <> OLD."namespace" THEN
    RAISE EXCEPTION 'CONFIG_SCOPE_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW."published_version" <> OLD."published_version"
     AND NEW."published_version" <> OLD."published_version" + 1 THEN
    RAISE EXCEPTION 'CONFIG_SCOPE_VERSION_NOT_FORWARD' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "config_scope_version_forward" BEFORE UPDATE ON "config_scope"
  FOR EACH ROW EXECUTE FUNCTION "config_scope_version_forward"();

-- Published versions, history and idempotency outcomes are records: no
-- runtime identity may rewrite or remove them, whatever its grants are after
-- a provisioning replay (the P01-D3 revoke list does not name these tables;
-- triggers hold regardless, CR-D-P05-D5-06 asks to add them to that list).
CREATE FUNCTION "config_append_only"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CONFIG_HISTORY_APPEND_ONLY: %', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER "config_version_append_only" BEFORE UPDATE OR DELETE ON "config_version"
  FOR EACH ROW EXECUTE FUNCTION "config_append_only"();
CREATE TRIGGER "config_version_no_truncate" BEFORE TRUNCATE ON "config_version"
  FOR EACH STATEMENT EXECUTE FUNCTION "config_append_only"();
CREATE TRIGGER "config_history_append_only" BEFORE UPDATE OR DELETE ON "config_history"
  FOR EACH ROW EXECUTE FUNCTION "config_append_only"();
CREATE TRIGGER "config_history_no_truncate" BEFORE TRUNCATE ON "config_history"
  FOR EACH STATEMENT EXECUTE FUNCTION "config_append_only"();
CREATE TRIGGER "config_idempotency_append_only" BEFORE UPDATE OR DELETE ON "config_idempotency"
  FOR EACH ROW EXECUTE FUNCTION "config_append_only"();
CREATE TRIGGER "config_idempotency_no_truncate" BEFORE TRUNCATE ON "config_idempotency"
  FOR EACH STATEMENT EXECUTE FUNCTION "config_append_only"();

-- Drafts and scopes are never deleted (withdrawal is a state, not a delete).
CREATE FUNCTION "config_no_delete"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CONFIG_RECORD_NOT_DELETABLE: %', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER "config_draft_no_delete" BEFORE DELETE ON "config_draft"
  FOR EACH ROW EXECUTE FUNCTION "config_no_delete"();
CREATE TRIGGER "config_draft_no_truncate" BEFORE TRUNCATE ON "config_draft"
  FOR EACH STATEMENT EXECUTE FUNCTION "config_no_delete"();
CREATE TRIGGER "config_scope_no_delete" BEFORE DELETE ON "config_scope"
  FOR EACH ROW EXECUTE FUNCTION "config_no_delete"();
CREATE TRIGGER "config_scope_no_truncate" BEFORE TRUNCATE ON "config_scope"
  FOR EACH STATEMENT EXECUTE FUNCTION "config_no_delete"();

-- Same discovered-grantee revoke as P01-D3, for the history tables.
DO $$
DECLARE
  target TEXT;
  grantee_name TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['config_version', 'config_history', 'config_idempotency'] LOOP
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
