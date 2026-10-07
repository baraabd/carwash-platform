-- P01-A1: customer profiles, saved addresses, idempotency, outbox and audit.
-- Applied by the migration identity (cw_customer_migrate) as a separate job.
-- Additive only: no existing table is altered or dropped (expand phase).
-- Rollback before any row is written: drop the five tables in reverse order.
-- Rollback after rows exist requires a reviewed data plan; never drop silently.

-- CreateTable
CREATE TABLE "customer_profile" (
    "id" UUID NOT NULL,
    "principal_kind" VARCHAR(16) NOT NULL,
    "principal_subject" UUID NOT NULL,
    "display_name" VARCHAR(60),
    "phone" VARCHAR(16),
    "preferred_locale" VARCHAR(2) NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_address" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" VARCHAR(30) NOT NULL,
    "line" VARCHAR(160) NOT NULL,
    "access_note" VARCHAR(160),
    "location_kind" VARCHAR(16) NOT NULL,
    "location_source" VARCHAR(16),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" VARCHAR(16) NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
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
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_principal_key" ON "customer_profile"("principal_kind", "principal_subject");

-- CreateIndex
CREATE INDEX "customer_address_owner_status_idx" ON "customer_address"("customer_id", "status");

-- CreateIndex
CREATE INDEX "idempotency_record_expiry_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_entry_target_idx" ON "audit_entry"("target_type", "target_id", "at");

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Invariants the application also enforces; the database is the last line.
ALTER TABLE "customer_profile"
  ADD CONSTRAINT "customer_profile_principal_kind_check" CHECK ("principal_kind" IN ('account', 'guest')),
  ADD CONSTRAINT "customer_profile_locale_check" CHECK ("preferred_locale" IN ('ar', 'en')),
  ADD CONSTRAINT "customer_profile_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{8,15}$'),
  ADD CONSTRAINT "customer_profile_display_name_check" CHECK ("display_name" IS NULL OR char_length(btrim("display_name")) >= 2),
  ADD CONSTRAINT "customer_profile_revision_check" CHECK ("revision" >= 1);

ALTER TABLE "customer_address"
  ADD CONSTRAINT "customer_address_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  ADD CONSTRAINT "customer_address_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "customer_address_label_check" CHECK (char_length(btrim("label")) >= 1),
  ADD CONSTRAINT "customer_address_line_check" CHECK (char_length(btrim("line")) >= 1),
  ADD CONSTRAINT "customer_address_location_check" CHECK (
    ("location_kind" = 'manual'
       AND "location_source" IS NULL AND "latitude" IS NULL AND "longitude" IS NULL)
    OR
    ("location_kind" = 'coordinates'
       -- IS NOT NULL first: NULL IN (...) is NULL, and a NULL CHECK passes.
       AND "location_source" IS NOT NULL
       AND "location_source" IN ('pin', 'device', 'geocoder')
       AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL
       -- NUMERIC accepts 'NaN'; a coordinate must be a finite number.
       AND "latitude" <> 'NaN'::numeric AND "longitude" <> 'NaN'::numeric
       AND "latitude" BETWEEN -90 AND 90
       AND "longitude" BETWEEN -180 AND 180)
  );

ALTER TABLE "idempotency_record"
  ADD CONSTRAINT "idempotency_record_key_check" CHECK ("key" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "idempotency_record_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_record_response_check" CHECK (("response_status" IS NULL) = ("response_body" IS NULL)),
  ADD CONSTRAINT "idempotency_record_expiry_check" CHECK ("expires_at" > "created_at");

ALTER TABLE "audit_entry"
  ADD CONSTRAINT "audit_entry_target_type_check" CHECK ("target_type" IN ('customer', 'address'));

-- Audit facts are append-only for every role that is not the table owner's
-- migration job: an UPDATE or DELETE is refused regardless of grants.
CREATE FUNCTION "audit_entry_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is append-only' USING ERRCODE = '42501';
END;
$$;

-- PostgreSQL grants EXECUTE on every new function to PUBLIC. Nothing outside
-- this schema's owner may call it; the trigger still fires for the runtime
-- role because trigger invocation does not check EXECUTE for the caller.
REVOKE ALL ON FUNCTION "audit_entry_append_only"() FROM PUBLIC;

CREATE TRIGGER "audit_entry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION "audit_entry_append_only"();
