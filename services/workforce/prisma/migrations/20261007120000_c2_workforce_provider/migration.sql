-- P01-C2: Workforce operator, verification, skills, shifts, outbox and audit.
-- Expand-only. The migration identity applies this separately from runtime.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

CREATE TABLE "operator" (
  "id" UUID NOT NULL,
  "identity_subject" UUID NOT NULL,
  "display_name" VARCHAR(80) NOT NULL,
  "home_zone_id" UUID NOT NULL,
  "employment_status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "suspension_reason" TEXT,
  "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "verified_until" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operator_display_name_ck" CHECK (char_length(btrim("display_name")) BETWEEN 2 AND 80),
  CONSTRAINT "operator_employment_ck" CHECK ("employment_status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "operator_suspension_ck" CHECK ("suspension_reason" IS NULL OR "suspension_reason" IN ('OPERATIONS','COMPLIANCE','SAFETY')),
  CONSTRAINT "operator_verification_ck" CHECK ("verification_status" IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED')),
  CONSTRAINT "operator_verified_until_ck" CHECK (("verification_status" = 'VERIFIED') = ("verified_until" IS NOT NULL)),
  CONSTRAINT "operator_version_ck" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "operator_identity_subject_key" ON "operator"("identity_subject");
CREATE INDEX "operator_home_zone_idx" ON "operator"("home_zone_id");

CREATE TABLE "work_grant" (
  "id" UUID NOT NULL,
  "operator_id" UUID NOT NULL,
  "skill_code" VARCHAR(40) NOT NULL,
  "granted_by" UUID NOT NULL,
  "granted_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "work_grant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_grant_skill_ck" CHECK ("skill_code" ~ '^[a-z][a-z0-9.-]{1,39}$')
);
CREATE UNIQUE INDEX "work_grant_operator_id_skill_code_key" ON "work_grant"("operator_id","skill_code");
CREATE INDEX "work_grant_skill_code_idx" ON "work_grant"("skill_code");

CREATE TABLE "verification_case" (
  "id" UUID NOT NULL,
  "operator_id" UUID NOT NULL,
  "pending_operator_id" UUID,
  "status" TEXT NOT NULL,
  "evidence_refs" UUID[] NOT NULL,
  "submitted_by" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(3),
  "decision_reason" TEXT,
  "valid_until" TIMESTAMPTZ(3),
  "requester" VARCHAR(120) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "verification_case_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verification_case_status_ck" CHECK ("status" IN ('PENDING_REVIEW','APPROVED','REJECTED','WITHDRAWN')),
  CONSTRAINT "verification_case_pending_ck" CHECK (
    ("status" = 'PENDING_REVIEW' AND "pending_operator_id" = "operator_id")
    OR ("status" <> 'PENDING_REVIEW' AND "pending_operator_id" IS NULL)
  ),
  CONSTRAINT "verification_case_evidence_ck" CHECK (cardinality("evidence_refs") BETWEEN 1 AND 8),
  CONSTRAINT "verification_case_decision_ck" CHECK (
    ("status" = 'PENDING_REVIEW' AND "decided_by" IS NULL AND "decided_at" IS NULL AND "valid_until" IS NULL)
    OR ("status" = 'APPROVED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "valid_until" IS NOT NULL AND "decision_reason" IS NULL)
    OR ("status" = 'REJECTED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "valid_until" IS NULL AND "decision_reason" IN ('IDENTITY_MISMATCH','EVIDENCE_INCOMPLETE','EVIDENCE_INVALID','POLICY_INELIGIBLE'))
    OR ("status" = 'WITHDRAWN' AND "decided_by" IS NULL AND "decided_at" IS NOT NULL AND "valid_until" IS NULL AND "decision_reason" IS NULL)
  ),
  CONSTRAINT "verification_case_version_ck" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "verification_case_pending_operator_id_key" ON "verification_case"("pending_operator_id");
CREATE UNIQUE INDEX "verification_case_requester_idempotency_key_key" ON "verification_case"("requester","idempotency_key");
CREATE INDEX "verification_case_operator_id_idx" ON "verification_case"("operator_id");
CREATE INDEX "verification_case_status_submitted_at_idx" ON "verification_case"("status","submitted_at");

CREATE TABLE "work_shift" (
  "id" UUID NOT NULL,
  "operator_id" UUID NOT NULL,
  "zone_id" UUID NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "requester" VARCHAR(120) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_shift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_shift_time_ck" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "work_shift_status_ck" CHECK ("status" IN ('ACTIVE','CANCELLED')),
  CONSTRAINT "work_shift_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "work_shift_no_overlap_ex" EXCLUDE USING gist (
    "operator_id" public.gist_uuid_ops WITH =,
    tstzrange("starts_at","ends_at",'[)') WITH &&
  ) WHERE ("status" = 'ACTIVE')
);
CREATE UNIQUE INDEX "work_shift_requester_idempotency_key_key" ON "work_shift"("requester","idempotency_key");
CREATE INDEX "work_shift_operator_id_starts_at_idx" ON "work_shift"("operator_id","starts_at");
CREATE INDEX "work_shift_zone_id_status_starts_at_idx" ON "work_shift"("zone_id","status","starts_at");

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
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at","dead_at","created_at");

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
  CONSTRAINT "audit_entry_actor_kind_ck" CHECK ("actor_kind" IN ('USER','SERVICE','SYSTEM'))
);
CREATE INDEX "audit_entry_target_type_target_id_idx" ON "audit_entry"("target_type","target_id");

ALTER TABLE "work_grant" ADD CONSTRAINT "work_grant_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verification_case" ADD CONSTRAINT "verification_case_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_shift" ADD CONSTRAINT "work_shift_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
