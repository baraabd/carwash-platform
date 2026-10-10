-- P04-D1 exception cases for the support service: cases, reasoned decisions
-- (resolution requests) with the owner's answer, and an append-only audit.
-- Applied by the migration identity (cw_support_migrate) as a separate job;
-- application replicas never run this file. Additive only (expand step): the
-- foundation service_marker table is untouched.
-- CreateTable
CREATE TABLE "support_case" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "subject_type" VARCHAR(32) NOT NULL,
    "subject_id" UUID NOT NULL,
    "subject_parent_id" UUID,
    "summary" VARCHAR(200) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "revision" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "open_key" VARCHAR(128) NOT NULL,
    "open_fingerprint" CHAR(64) NOT NULL,
    "active_slot" SMALLINT,

    CONSTRAINT "support_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_request" (
    "case_id" UUID NOT NULL,
    "decision_no" INTEGER NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "reason_code" VARCHAR(32) NOT NULL,
    "reason_note" VARCHAR(500) NOT NULL,
    "evidence" JSONB NOT NULL,
    "amount_currency" CHAR(3),
    "amount_minor" DECIMAL(20,0),
    "amount_scale" SMALLINT,
    "window_starts_at" TIMESTAMPTZ(3),
    "window_ends_at" TIMESTAMPTZ(3),
    "status" VARCHAR(24) NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approval_note" VARCHAR(500),
    "approval_key" VARCHAR(128),
    "owner_operation" VARCHAR(32),
    "owner_target_id" UUID,
    "owner_key" VARCHAR(128),
    "owner_body" JSONB,
    "owner_http_status" INTEGER,
    "owner_code" VARCHAR(64),
    "owner_state" VARCHAR(32),
    "execution_attempts" INTEGER NOT NULL DEFAULT 0,
    "execution_fence" INTEGER NOT NULL DEFAULT 0,
    "last_executed_at" TIMESTAMPTZ(3),
    "inflight_slot" SMALLINT,

    CONSTRAINT "resolution_request_pkey" PRIMARY KEY ("case_id","decision_no")
);

-- CreateTable
CREATE TABLE "case_event" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "case_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "decision_no" INTEGER,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "outcome" VARCHAR(96),
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "case_event_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "support_case_queue_idx" ON "support_case"("kind", "opened_at", "id");

-- CreateIndex
CREATE INDEX "support_case_subject_idx" ON "support_case"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_case_open_key_key" ON "support_case"("opened_by", "open_key");

-- CreateIndex
CREATE UNIQUE INDEX "support_case_active_subject_key" ON "support_case"("kind", "subject_type", "subject_id", "active_slot");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_request_key_key" ON "resolution_request"("case_id", "decided_by", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_request_owner_key_key" ON "resolution_request"("owner_key");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_request_inflight_key" ON "resolution_request"("case_id", "inflight_slot");

-- CreateIndex
CREATE UNIQUE INDEX "case_event_seq_key" ON "case_event"("seq");

-- CreateIndex
CREATE INDEX "case_event_case_idx" ON "case_event"("case_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- AddForeignKey
ALTER TABLE "resolution_request" ADD CONSTRAINT "resolution_request_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_event" ADD CONSTRAINT "case_event_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Database-enforced invariants ----------------------------------------------

ALTER TABLE "support_case"
    ADD CONSTRAINT "support_case_kind_known" CHECK ("kind" IN (
        'PAYMENT_REVIEW', 'REFUND', 'LATE_PAYMENT', 'BOOKING_CANCELLATION', 'BOOKING_RESCHEDULE')),
    ADD CONSTRAINT "support_case_status_known" CHECK ("status" IN (
        'OPEN', 'AWAITING_APPROVAL', 'EXECUTING', 'OUTCOME_UNKNOWN', 'BLOCKED_ON_OWNER',
        'OWNER_REJECTED', 'RESOLVED', 'CLOSED')),
    ADD CONSTRAINT "support_case_subject_known" CHECK ("subject_type" IN (
        'billing.payment-attempt', 'billing.obligation', 'booking')),
    -- A payment attempt is always located through its obligation; nothing else has a parent.
    ADD CONSTRAINT "support_case_parent_only_for_attempt" CHECK (
        ("subject_type" = 'billing.payment-attempt') = ("subject_parent_id" IS NOT NULL)),
    ADD CONSTRAINT "support_case_kind_subject" CHECK (
        ("kind" IN ('PAYMENT_REVIEW', 'LATE_PAYMENT') AND "subject_type" = 'billing.payment-attempt')
        OR ("kind" = 'REFUND' AND "subject_type" = 'billing.obligation')
        OR ("kind" IN ('BOOKING_CANCELLATION', 'BOOKING_RESCHEDULE') AND "subject_type" = 'booking')),
    ADD CONSTRAINT "support_case_revision_positive" CHECK ("revision" >= 1),
    ADD CONSTRAINT "support_case_fingerprint_hex" CHECK ("open_fingerprint" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "support_case_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object'),
    ADD CONSTRAINT "support_case_summary_present" CHECK (char_length(btrim("summary")) >= 3),
    -- One active case per subject: the slot is 1 exactly while the case is not finished.
    ADD CONSTRAINT "support_case_active_slot" CHECK (
        ("active_slot" IS NULL AND "status" IN ('RESOLVED', 'CLOSED'))
        OR ("active_slot" = 1 AND "status" NOT IN ('RESOLVED', 'CLOSED')));

ALTER TABLE "resolution_request"
    ADD CONSTRAINT "resolution_request_decision_no_positive" CHECK ("decision_no" >= 1),
    ADD CONSTRAINT "resolution_request_action_known" CHECK ("action" IN (
        'APPROVE_MATCH', 'REJECT_MISMATCH', 'MARK_UNKNOWN', 'ACCEPT_LATE_PAYMENT', 'REFUND',
        'CANCEL_BOOKING', 'RESCHEDULE_BOOKING', 'DISMISS')),
    ADD CONSTRAINT "resolution_request_status_known" CHECK ("status" IN (
        'AWAITING_APPROVAL', 'REJECTED_BY_APPROVER', 'EXECUTING', 'APPLIED', 'OWNER_REJECTED',
        'OUTCOME_UNKNOWN', 'BLOCKED_ON_OWNER', 'NO_OWNER_ACTION', 'SUPERSEDED')),
    ADD CONSTRAINT "resolution_request_reason_known" CHECK ("reason_code" IN (
        'PROVIDER_CONFIRMED', 'PROVIDER_AMOUNT_DIFFERS', 'PROVIDER_NO_RECORD',
        'PROVIDER_UNREACHABLE', 'DUPLICATE_PAYMENT', 'SERVICE_NOT_DELIVERED',
        'PAID_AFTER_CANCELLATION', 'PAID_AFTER_DEADLINE', 'CUSTOMER_REQUEST',
        'TECHNICIAN_UNAVAILABLE', 'WEATHER_OR_SAFETY', 'OPERATIONAL_ERROR', 'ALREADY_HANDLED',
        'OTHER')),
    -- Every manual decision is explained.
    ADD CONSTRAINT "resolution_request_reason_note" CHECK (char_length(btrim("reason_note")) >= 10),
    ADD CONSTRAINT "resolution_request_evidence_array" CHECK (
        jsonb_typeof("evidence") = 'array' AND jsonb_array_length("evidence") <= 5),
    -- Money-moving decisions cite evidence.
    ADD CONSTRAINT "resolution_request_evidence_required" CHECK (
        "action" NOT IN ('APPROVE_MATCH', 'REJECT_MISMATCH', 'ACCEPT_LATE_PAYMENT', 'REFUND')
        OR jsonb_array_length("evidence") >= 1),
    -- Exact money: integer minor units with explicit currency and scale, all or nothing.
    ADD CONSTRAINT "resolution_request_amount_whole" CHECK (
        ("amount_currency" IS NULL AND "amount_minor" IS NULL AND "amount_scale" IS NULL)
        OR ("amount_currency" ~ '^[A-Z]{3}$' AND "amount_minor" >= 0
            AND "amount_scale" BETWEEN 0 AND 3)),
    ADD CONSTRAINT "resolution_request_window_whole" CHECK (
        ("window_starts_at" IS NULL AND "window_ends_at" IS NULL)
        OR ("window_starts_at" IS NOT NULL AND "window_ends_at" > "window_starts_at")),
    -- Four-eyes: approval data is complete or absent, and never by the proposer.
    ADD CONSTRAINT "resolution_request_approval_whole" CHECK (
        ("approved_by" IS NULL AND "approved_at" IS NULL AND "approval_note" IS NULL
            AND "approval_key" IS NULL)
        OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL
            AND "approval_note" IS NOT NULL AND "approval_key" IS NOT NULL)),
    ADD CONSTRAINT "resolution_request_four_eyes" CHECK (
        "approved_by" IS NULL OR "approved_by" <> "decided_by"),
    ADD CONSTRAINT "resolution_request_owner_whole" CHECK (
        ("owner_operation" IS NULL AND "owner_target_id" IS NULL AND "owner_key" IS NULL
            AND "owner_body" IS NULL)
        OR ("owner_operation" IN ('billing.reconcile', 'billing.refund', 'booking.cancel',
                'booking.reschedule')
            AND "owner_target_id" IS NOT NULL AND "owner_key" ~ '^[A-Za-z0-9_-]{16,128}$'
            AND jsonb_typeof("owner_body") = 'object')),
    -- Nothing is sent to an owner without a frozen request.
    ADD CONSTRAINT "resolution_request_executes_frozen" CHECK (
        "status" NOT IN ('EXECUTING', 'APPLIED', 'OWNER_REJECTED', 'OUTCOME_UNKNOWN',
            'BLOCKED_ON_OWNER')
        OR "owner_operation" IS NOT NULL),
    ADD CONSTRAINT "resolution_request_counters" CHECK (
        "execution_attempts" >= 0 AND "execution_fence" >= 0),
    ADD CONSTRAINT "resolution_request_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
    -- One decision in flight per case.
    ADD CONSTRAINT "resolution_request_inflight_slot" CHECK (
        ("inflight_slot" = 1 AND "status" IN ('AWAITING_APPROVAL', 'EXECUTING',
            'OUTCOME_UNKNOWN', 'BLOCKED_ON_OWNER'))
        OR ("inflight_slot" IS NULL AND "status" NOT IN ('AWAITING_APPROVAL', 'EXECUTING',
            'OUTCOME_UNKNOWN', 'BLOCKED_ON_OWNER')));

ALTER TABLE "case_event"
    ADD CONSTRAINT "case_event_status_known" CHECK ("to_status" IN (
        'OPEN', 'AWAITING_APPROVAL', 'EXECUTING', 'OUTCOME_UNKNOWN', 'BLOCKED_ON_OWNER',
        'OWNER_REJECTED', 'RESOLVED', 'CLOSED'));

ALTER TABLE "outbox_message"
    ADD CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN (
        'support.case-opened.v1', 'support.case-status-changed.v1')),
    ADD CONSTRAINT "outbox_message_attempts" CHECK ("attempts" >= 0);

-- The audit trail is append-only, even for the runtime identity.
CREATE FUNCTION "support_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'SUPPORT_APPEND_ONLY: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "case_event_append_only"
    BEFORE UPDATE OR DELETE ON "case_event"
    FOR EACH ROW EXECUTE FUNCTION "support_reject_mutation"();

-- What a case is about, and what a decision said, never changes after the fact.
CREATE FUNCTION "support_reject_frozen_change"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'SUPPORT_FROZEN: DELETE on %', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    IF TG_TABLE_NAME = 'support_case' THEN
        IF ROW(NEW."id", NEW."kind", NEW."subject_type", NEW."subject_id", NEW."subject_parent_id",
               NEW."summary", NEW."snapshot", NEW."opened_by", NEW."opened_at", NEW."open_key",
               NEW."open_fingerprint")
           IS DISTINCT FROM
           ROW(OLD."id", OLD."kind", OLD."subject_type", OLD."subject_id", OLD."subject_parent_id",
               OLD."summary", OLD."snapshot", OLD."opened_by", OLD."opened_at", OLD."open_key",
               OLD."open_fingerprint")
           OR NEW."revision" <> OLD."revision" + 1 THEN
            RAISE EXCEPTION 'SUPPORT_FROZEN: support_case' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        IF ROW(NEW."case_id", NEW."decision_no", NEW."action", NEW."reason_code", NEW."reason_note",
               NEW."evidence", NEW."amount_currency", NEW."amount_minor", NEW."amount_scale",
               NEW."window_starts_at", NEW."window_ends_at", NEW."decided_by", NEW."decided_at",
               NEW."idempotency_key", NEW."fingerprint")
           IS DISTINCT FROM
           ROW(OLD."case_id", OLD."decision_no", OLD."action", OLD."reason_code", OLD."reason_note",
               OLD."evidence", OLD."amount_currency", OLD."amount_minor", OLD."amount_scale",
               OLD."window_starts_at", OLD."window_ends_at", OLD."decided_by", OLD."decided_at",
               OLD."idempotency_key", OLD."fingerprint")
           OR (OLD."owner_body" IS NOT NULL AND NEW."owner_body" IS DISTINCT FROM OLD."owner_body")
           OR (OLD."owner_key" IS NOT NULL AND NEW."owner_key" IS DISTINCT FROM OLD."owner_key")
           OR (OLD."approved_by" IS NOT NULL AND NEW."approved_by" IS DISTINCT FROM OLD."approved_by")
           OR NEW."execution_fence" < OLD."execution_fence" THEN
            RAISE EXCEPTION 'SUPPORT_FROZEN: resolution_request' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "support_case_frozen"
    BEFORE UPDATE OR DELETE ON "support_case"
    FOR EACH ROW EXECUTE FUNCTION "support_reject_frozen_change"();

CREATE TRIGGER "resolution_request_frozen"
    BEFORE UPDATE OR DELETE ON "resolution_request"
    FOR EACH ROW EXECUTE FUNCTION "support_reject_frozen_change"();
