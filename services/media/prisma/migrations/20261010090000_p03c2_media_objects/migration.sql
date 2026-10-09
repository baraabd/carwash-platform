-- P03-C2: media objects (work evidence), holder claims, idempotency and audit.
-- Applied by the migration identity (cw_media_migrate) as a separate job.
-- Expand-only: creates new objects, alters and drops nothing that exists.
--
-- Invariants enforced HERE, not only in application code:
--   * status, purpose, content type, size bounds, digest format (CHECK),
--   * each status carries exactly its own timestamps and reason (CHECK),
--   * only RESERVED->AVAILABLE|REJECTED|EXPIRED and AVAILABLE->PURGED, each
--     with version + 1; descriptive columns are immutable (trigger),
--   * object rows are never deleted; claims and audit rows are append-only (triggers),
--   * a claim only on an AVAILABLE object; a claimed object never becomes PURGED (triggers),
--   * one claim per (object, claim_ref); one idempotency record per (scope, key) (PK).

-- CreateTable
CREATE TABLE "media_object" (
    "id" UUID NOT NULL,
    "owner_subject" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "reject_reason" VARCHAR(32),
    "reservation_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "storage_swept_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_object_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_object_status_ck" CHECK (
        "status" IN ('RESERVED', 'AVAILABLE', 'REJECTED', 'EXPIRED', 'PURGED')
    ),
    CONSTRAINT "media_object_purpose_ck" CHECK ("purpose" IN ('WORK_EVIDENCE')),
    CONSTRAINT "media_object_content_type_ck" CHECK (
        "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
    ),
    CONSTRAINT "media_object_byte_length_ck" CHECK ("byte_length" BETWEEN 20 AND 10485760),
    CONSTRAINT "media_object_sha256_ck" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_object_reject_ck" CHECK (
        ("status" = 'REJECTED') = ("reject_reason" IS NOT NULL)
        AND ("reject_reason" IS NULL OR "reject_reason" IN ('UPLOAD_MISMATCH', 'UNSUPPORTED_MEDIA'))
    ),
    CONSTRAINT "media_object_finalized_ck" CHECK (
        ("status" IN ('AVAILABLE', 'REJECTED', 'PURGED')) = ("finalized_at" IS NOT NULL)
    ),
    CONSTRAINT "media_object_expired_ck" CHECK (("status" = 'EXPIRED') = ("expired_at" IS NOT NULL)),
    CONSTRAINT "media_object_purged_ck" CHECK (("status" = 'PURGED') = ("purged_at" IS NOT NULL)),
    CONSTRAINT "media_object_swept_ck" CHECK (
        ("status" <> 'RESERVED' OR "storage_swept_at" IS NULL)
        AND ("status" NOT IN ('EXPIRED', 'PURGED') OR "storage_swept_at" IS NOT NULL)
    ),
    CONSTRAINT "media_object_window_ck" CHECK ("reservation_expires_at" > "created_at"),
    CONSTRAINT "media_object_version_ck" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "object_claim" (
    "object_id" UUID NOT NULL,
    "claim_ref" UUID NOT NULL,
    "holder" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "object_claim_pkey" PRIMARY KEY ("object_id", "claim_ref"),
    CONSTRAINT "object_claim_holder_ck" CHECK ("holder" IN ('dispatch.task-evidence'))
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "scope" VARCHAR(200) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "object_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("scope", "idempotency_key")
);

-- CreateTable
CREATE TABLE "audit_entry" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" TEXT NOT NULL,
    "actor_id" VARCHAR(80) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_entry_actor_kind_ck" CHECK ("actor_kind" IN ('USER', 'SERVICE', 'SYSTEM')),
    CONSTRAINT "audit_entry_target_type_ck" CHECK ("target_type" IN ('MEDIA_OBJECT'))
);

-- CreateIndex
CREATE INDEX "media_object_status_reservation_expires_at_idx" ON "media_object"("status", "reservation_expires_at");

-- CreateIndex
CREATE INDEX "media_object_status_finalized_at_idx" ON "media_object"("status", "finalized_at");

-- CreateIndex
CREATE INDEX "media_object_storage_swept_at_reservation_expires_at_idx" ON "media_object"("storage_swept_at", "reservation_expires_at");

-- CreateIndex
CREATE INDEX "idempotency_record_created_at_idx" ON "idempotency_record"("created_at");

-- CreateIndex
CREATE INDEX "audit_entry_target_type_target_id_idx" ON "audit_entry"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "object_claim" ADD CONSTRAINT "object_claim_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "media_object"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lifecycle guard (not expressible in schema.prisma; lives in SQL only).
-- Tables are resolved in the trigger's own schema, so the function does not
-- depend on the caller's search_path.
CREATE FUNCTION "media_object_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    claimed BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MEDIA_OBJECT_ROWS_ARE_RETAINED' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."owner_subject" IS DISTINCT FROM OLD."owner_subject"
       OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
       OR NEW."content_type" IS DISTINCT FROM OLD."content_type"
       OR NEW."byte_length" IS DISTINCT FROM OLD."byte_length"
       OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
       OR NEW."reservation_expires_at" IS DISTINCT FROM OLD."reservation_expires_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'MEDIA_OBJECT_IMMUTABLE_COLUMN' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
        IF NOT (
            (OLD."status" = 'RESERVED' AND NEW."status" IN ('AVAILABLE', 'REJECTED', 'EXPIRED'))
            OR (OLD."status" = 'AVAILABLE' AND NEW."status" = 'PURGED')
        ) THEN
            RAISE EXCEPTION 'MEDIA_OBJECT_ILLEGAL_TRANSITION' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."version" <> OLD."version" + 1 THEN
            RAISE EXCEPTION 'MEDIA_OBJECT_VERSION_NOT_INCREMENTED' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" = 'PURGED' THEN
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.object_claim WHERE object_id = $1)', TG_TABLE_SCHEMA)
               INTO claimed USING NEW."id";
            IF claimed THEN
                RAISE EXCEPTION 'MEDIA_OBJECT_CLAIMED' USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."reject_reason" IS DISTINCT FROM OLD."reject_reason"
       OR NEW."finalized_at" IS DISTINCT FROM OLD."finalized_at"
       OR NEW."expired_at" IS DISTINCT FROM OLD."expired_at"
       OR NEW."purged_at" IS DISTINCT FROM OLD."purged_at"
       OR (OLD."storage_swept_at" IS NOT NULL
           AND NEW."storage_swept_at" IS DISTINCT FROM OLD."storage_swept_at") THEN
        -- Without a transition only the one-time sweep mark may be recorded.
        RAISE EXCEPTION 'MEDIA_OBJECT_ILLEGAL_UPDATE' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "media_object_guard_trg"
    BEFORE UPDATE OR DELETE ON "media_object"
    FOR EACH ROW EXECUTE FUNCTION "media_object_guard"();

CREATE FUNCTION "object_claim_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_status TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'OBJECT_CLAIMS_ARE_APPEND_ONLY' USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE format('SELECT status FROM %I.media_object WHERE id = $1', TG_TABLE_SCHEMA)
       INTO current_status USING NEW."object_id";
    IF current_status IS DISTINCT FROM 'AVAILABLE' THEN
        RAISE EXCEPTION 'OBJECT_CLAIM_REQUIRES_AVAILABLE' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "object_claim_guard_trg"
    BEFORE INSERT OR UPDATE OR DELETE ON "object_claim"
    FOR EACH ROW EXECUTE FUNCTION "object_claim_guard"();

CREATE FUNCTION "audit_entry_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'AUDIT_ENTRIES_ARE_APPEND_ONLY' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "audit_entry_append_only_trg"
    BEFORE UPDATE OR DELETE ON "audit_entry"
    FOR EACH ROW EXECUTE FUNCTION "audit_entry_append_only"();

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. These are
-- trigger-only guards; table mutations invoke them without caller EXECUTE.
REVOKE ALL ON FUNCTION "media_object_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "object_claim_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "audit_entry_append_only"() FROM PUBLIC;
