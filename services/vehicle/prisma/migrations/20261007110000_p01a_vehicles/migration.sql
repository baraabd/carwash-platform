-- P01-A2: saved vehicles, idempotency, outbox and audit.
-- Applied by the migration identity (cw_vehicle_migrate) as a separate job.
-- Additive only (expand phase). Rollback before any row is written: drop the
-- four new tables and the trigger function. After rows exist rollback needs a
-- reviewed data plan.

-- CreateTable
CREATE TABLE "vehicle" (
    "id" UUID NOT NULL,
    "owner_kind" VARCHAR(16) NOT NULL,
    "owner_subject" UUID NOT NULL,
    "vehicle_type" VARCHAR(16) NOT NULL,
    "display_name" VARCHAR(60),
    "plate" VARCHAR(20),
    "color" VARCHAR(30),
    "status" VARCHAR(16) NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "scope" VARCHAR(80) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("scope","key")
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
    "actor_subject" UUID NOT NULL,
    "actor_session_id" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_owner_status_idx" ON "vehicle"("owner_kind", "owner_subject", "status");

-- CreateIndex
CREATE INDEX "idempotency_record_expiry_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_entry_vehicle_idx" ON "audit_entry"("vehicle_id", "at");


-- Invariants the application also enforces; the database is the last line.
-- Every multi-value test is NULL-guarded first: NULL IN (...) is NULL and a
-- NULL CHECK passes.
ALTER TABLE "vehicle"
  ADD CONSTRAINT "vehicle_owner_kind_check" CHECK ("owner_kind" IN ('account', 'guest')),
  ADD CONSTRAINT "vehicle_type_check" CHECK ("vehicle_type" IN ('sedan', 'suv', 'large', 'pickup')),
  ADD CONSTRAINT "vehicle_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  ADD CONSTRAINT "vehicle_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "vehicle_archived_at_check" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL)),
  -- Optional plate: when present, 2-20 of Latin/Arabic letters, digits, single
  -- spaces and hyphens, at least one digit, already trimmed. Not unique.
  ADD CONSTRAINT "vehicle_plate_check" CHECK (
    "plate" IS NULL OR (
      "plate" ~ '^[A-Za-z0-9ء-ي -]{2,20}$'
      AND "plate" ~ '[0-9]'
      AND "plate" = btrim("plate")
      AND "plate" !~ '  '
    )
  ),
  ADD CONSTRAINT "vehicle_display_name_check" CHECK ("display_name" IS NULL OR char_length(btrim("display_name")) >= 1),
  ADD CONSTRAINT "vehicle_color_check" CHECK ("color" IS NULL OR char_length(btrim("color")) >= 1);

ALTER TABLE "idempotency_record"
  ADD CONSTRAINT "idempotency_record_key_check" CHECK ("key" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "idempotency_record_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_record_response_check" CHECK (("response_status" IS NULL) = ("response_body" IS NULL)),
  ADD CONSTRAINT "idempotency_record_expiry_check" CHECK ("expires_at" > "created_at");

-- Audit facts are append-only: UPDATE and DELETE are refused regardless of grants.
CREATE FUNCTION "audit_entry_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "audit_entry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION "audit_entry_append_only"();
