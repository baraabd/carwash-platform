-- Canonical billing.v1 obligation refunds. Expand-only: existing rows keep
-- CREDIT_V1 and its approval/evidence workflow. OBLIGATION_V1 uses the published
-- two-person manual outcome protocol, including durable UNKNOWN reservations.
-- Both workflows use the SAME credit, refund table, cap, financial journal and
-- commit-time ledger guards. No cash disbursement policy is created here.
--
-- Deploy migration before code. Roll back code only while no OBLIGATION_V1 row
-- exists; after canonical financial facts exist, use a reviewed forward repair
-- or restore plan. Never delete or rewrite refund history to enable rollback.
ALTER TABLE "app"."payment_refund"
    ADD COLUMN "workflow" VARCHAR(24) NOT NULL DEFAULT 'CREDIT_V1';
ALTER TABLE "app"."payment_refund" ADD CONSTRAINT "payment_refund_workflow"
    CHECK ("workflow" IN ('CREDIT_V1', 'OBLIGATION_V1'));

-- The published event is distinct from the legacy credit-refund workflow event.
-- Persist it atomically; broker publication remains a separate declared runtime.
ALTER TABLE "app"."outbox_message" DROP CONSTRAINT "outbox_message_event_type";
ALTER TABLE "app"."outbox_message" ADD CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN (
    'billing.obligation-created.v1', 'billing.obligation-status-changed.v1',
    'billing.cash-collected.v1', 'billing.cash-collection-reversed.v1',
    'billing.custody-handover-changed.v1',
    'billing.provider-credit-changed.v1', 'billing.refund-changed.v1',
    'billing.refund-status-changed.v1'));

ALTER TABLE "app"."payment_refund" DROP CONSTRAINT "payment_refund_reason";
ALTER TABLE "app"."payment_refund" ADD CONSTRAINT "payment_refund_reason" CHECK (
    ("workflow" = 'CREDIT_V1' AND "reason" IN (
        'SERVICE_NOT_DELIVERED', 'BOOKING_CANCELLED', 'DUPLICATE_PAYMENT', 'UNALLOCATABLE_CREDIT'))
    OR ("workflow" = 'OBLIGATION_V1' AND "reason" IN (
        'SERVICE_NOT_DELIVERED', 'BOOKING_CANCELLED', 'DUPLICATE_PAYMENT', 'SERVICE_QUALITY', 'PRICE_CORRECTION'))
);
ALTER TABLE "app"."payment_refund" DROP CONSTRAINT "payment_refund_references";
ALTER TABLE "app"."payment_refund" ADD CONSTRAINT "payment_refund_references" CHECK (
    ("provider_refund_reference" IS NULL OR
        ("workflow" = 'CREDIT_V1' AND "provider_refund_reference" ~ '^[A-Z0-9]{4,64}$') OR
        ("workflow" = 'OBLIGATION_V1' AND "provider_refund_reference" ~ '^[A-Za-z0-9-]{4,64}$'))
    AND ("evidence_digest" IS NULL OR "evidence_digest" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "app"."payment_refund" DROP CONSTRAINT "payment_refund_facts";
ALTER TABLE "app"."payment_refund" ADD CONSTRAINT "payment_refund_facts" CHECK (
    ("workflow" = 'CREDIT_V1' AND (

        ("status" = 'REQUESTED' AND "decided_by_subject" IS NULL AND "decided_at" IS NULL
            AND "completed_by_subject" IS NULL AND "completed_at" IS NULL
            AND "provider_refund_reference" IS NULL AND "evidence_digest" IS NULL)
        OR ("status" IN ('REJECTED', 'APPROVED') AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NULL AND "completed_at" IS NULL
            AND "provider_refund_reference" IS NULL AND "evidence_digest" IS NULL)
        OR ("status" IN ('SUBMITTED', 'UNKNOWN') AND "channel" = 'PROVIDER_API'
            AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NULL AND "completed_at" IS NULL AND "evidence_digest" IS NULL)
        OR ("status" IN ('SUCCEEDED', 'FAILED') AND "channel" = 'PROVIDER_API'
            AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NULL AND "completed_at" IS NOT NULL AND "evidence_digest" IS NULL)
        OR ("status" = 'SUCCEEDED' AND "channel" = 'MANUAL_OUT_OF_BAND'
            AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NOT NULL AND "completed_at" IS NOT NULL
            AND "provider_refund_reference" IS NOT NULL AND "evidence_digest" IS NOT NULL)
        OR ("status" = 'FAILED' AND "channel" = 'MANUAL_OUT_OF_BAND'
            AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NOT NULL AND "completed_at" IS NOT NULL)
    )) OR ("workflow" = 'OBLIGATION_V1' AND "channel" = 'MANUAL_OUT_OF_BAND'
        AND "evidence_digest" IS NULL AND (
        ("status" = 'REQUESTED' AND "decided_by_subject" IS NULL AND "decided_at" IS NULL
            AND "completed_by_subject" IS NULL AND "completed_at" IS NULL
            AND "provider_refund_reference" IS NULL)
        OR ("status" = 'UNKNOWN' AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NULL AND "completed_at" IS NULL
            AND "provider_refund_reference" IS NULL)
        OR ("status" IN ('SUCCEEDED', 'FAILED') AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL
            AND "completed_by_subject" IS NOT NULL AND "completed_at" IS NOT NULL
            AND (("status" = 'SUCCEEDED' AND "provider_refund_reference" IS NOT NULL)
                OR ("status" = 'FAILED' AND "provider_refund_reference" IS NULL)))
    ))
);

CREATE OR REPLACE FUNCTION "app"."billing_guard_refund_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    credit RECORD;
    obligation RECORD;
    reserved NUMERIC;
    refund_count INTEGER;
BEGIN
    -- Common lock order: credit -> obligation -> refund. All refund workflows
    -- reserve against this same locked credit, including legacy API refunds.
    SELECT * INTO credit FROM "app"."provider_credit" c WHERE c."id" = NEW."credit_id" FOR UPDATE;
    SELECT COALESCE(SUM(r."amount_minor"::NUMERIC) FILTER (
        WHERE r."status" IN ('REQUESTED', 'APPROVED', 'SUBMITTED', 'UNKNOWN', 'SUCCEEDED')), 0), COUNT(*)
      INTO reserved, refund_count FROM "app"."payment_refund" r WHERE r."credit_id" = NEW."credit_id";
    IF NEW."status" <> 'REQUESTED' OR NEW."revision" <> 1 OR NEW."updated_at" <> NEW."requested_at"
       OR credit."id" IS NULL OR credit."status" NOT IN ('UNALLOCATED', 'ALLOCATED')
       OR credit."provider" <> NEW."provider" OR credit."currency" <> NEW."currency"
       OR reserved + NEW."amount_minor"::NUMERIC > credit."amount_minor"::NUMERIC
       OR (credit."obligation_id" IS NOT NULL AND refund_count >= 20) THEN
        RAISE EXCEPTION 'PAYMENT_REFUND_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."workflow" = 'OBLIGATION_V1' THEN
        SELECT * INTO obligation FROM "app"."billing_obligation" o
         WHERE o."id" = credit."obligation_id" FOR UPDATE;
        IF credit."status" <> 'ALLOCATED' OR obligation."id" IS NULL
           OR obligation."status" <> 'SETTLED' OR obligation."verified_minor" <> credit."amount_minor"
           OR obligation."currency" <> credit."currency"
           OR NEW."requested_by_subject" = obligation."owner_subject"
           OR NEW."channel" <> 'MANUAL_OUT_OF_BAND' THEN
            RAISE EXCEPTION 'CANONICAL_REFUND_CREDIT_BINDING_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "app"."billing_guard_refund_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."workflow" <> OLD."workflow"
       OR NEW."credit_id" <> OLD."credit_id" OR NEW."provider" <> OLD."provider"
       OR NEW."currency" <> OLD."currency" OR NEW."amount_minor" <> OLD."amount_minor"
       OR NEW."reason" <> OLD."reason" OR NEW."channel" <> OLD."channel"
       OR NEW."requested_by_subject" <> OLD."requested_by_subject"
       OR NEW."requested_at" <> OLD."requested_at" OR NEW."correlation_id" <> OLD."correlation_id"
       OR (OLD."decided_by_subject" IS NOT NULL
           AND (NEW."decided_by_subject" IS DISTINCT FROM OLD."decided_by_subject"
                OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at"))
       OR (OLD."provider_refund_reference" IS NOT NULL
           AND NEW."provider_refund_reference" IS DISTINCT FROM OLD."provider_refund_reference") THEN
        RAISE EXCEPTION 'PAYMENT_REFUND_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" OR NOT (
        (OLD."workflow" = 'CREDIT_V1' AND (
            (OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED'))
            OR (OLD."status" = 'APPROVED' AND OLD."channel" = 'PROVIDER_API'
                AND NEW."status" IN ('SUBMITTED', 'UNKNOWN', 'SUCCEEDED', 'FAILED'))
            OR (OLD."status" = 'APPROVED' AND OLD."channel" = 'MANUAL_OUT_OF_BAND'
                AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
            OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
            OR (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('SUBMITTED', 'SUCCEEDED', 'FAILED'))
        )) OR (OLD."workflow" = 'OBLIGATION_V1' AND (
            (OLD."status" = 'REQUESTED' AND NEW."status" IN ('UNKNOWN', 'SUCCEEDED', 'FAILED'))
            OR (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
        ))
    ) THEN
        RAISE EXCEPTION 'PAYMENT_REFUND_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."workflow" = 'OBLIGATION_V1' AND EXISTS (
        SELECT 1 FROM "app"."provider_credit" c
          JOIN "app"."billing_obligation" o ON o."id" = c."obligation_id"
         WHERE c."id" = NEW."credit_id"
           AND (o."owner_subject" = NEW."decided_by_subject"
                OR o."owner_subject" = NEW."completed_by_subject")
    ) THEN
        RAISE EXCEPTION 'CANONICAL_REFUND_SELF_DECISION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
-- Replacement retains existing function ACLs. State them explicitly for review.
REVOKE ALL ON FUNCTION "app"."billing_guard_refund_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_refund_update"() FROM PUBLIC;
