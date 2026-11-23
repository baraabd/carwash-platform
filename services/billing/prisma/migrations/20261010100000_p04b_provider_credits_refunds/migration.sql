-- P04-B1: payment provider credits (received money facts), their allocation to
-- customer claims, provider reconciliation and refunds.
-- Applied by the migration identity (cw_billing_migrate) as a separate job.
-- Application replicas never run this file.
--
-- Expand-only with respect to P03-B1 code:
--   * new tables (provider_credit, payment_refund);
--   * new NULLABLE columns (payment_attempt.credit_id, ledger_journal.credit_id,
--     billing_audit_event.credit_id / refund_id);
--   * CHECK constraints are WIDENED only (every row P03-B1 code can write still
--     passes; existing rows are validated when the constraint is re-added);
--   * replaced guard functions accept every transition P03-B1 code performs,
--     except that an attempt can no longer become MATCHED without a provider
--     credit allocated to it in the same transaction (P03-B1 code is replaced
--     by this release; its manual MATCHED path is refused by the new code too).
--
-- Also fixes a defect on main: 5503125 revoked PUBLIC EXECUTE on the
-- billing_assert_* helpers, but the COMMIT-time trigger functions call them
-- as the invoking runtime role, so every journal-posting command failed with
-- "permission denied". Those trigger functions become SECURITY DEFINER (they
-- run as the migration owner, read only Billing tables, write nothing, can
-- only raise, have a pinned search_path and cannot be called directly), so the
-- helpers stay revoked from PUBLIC.
--
-- Rollback before any P04-B row exists: revert the code, then restore the
-- P03-B1 function bodies/constraints and drop the new objects in reverse order.
-- Rollback after credit/refund rows exist requires a reviewed financial data
-- plan and restore evidence; never drop or edit financial facts silently.

-- Provider credits ---------------------------------------------------------------
-- One effective credit per (provider, merchant account, provider reference):
-- active_slot is 1 unless a statement entry was REJECTED (then NULL, history kept,
-- and the correct entry may be recorded again).
CREATE TABLE "app"."provider_credit" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(24) NOT NULL,
    "merchant_account" VARCHAR(64) NOT NULL,
    "provider_reference" VARCHAR(64) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "evidence_digest" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "unallocated_reason" VARCHAR(24),
    "attempt_id" UUID,
    "obligation_id" UUID,
    "active_slot" SMALLINT,
    "recorded_by_subject" UUID,
    "decided_by_subject" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(24),
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "provider_credit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_credit_provider" CHECK ("provider" IN ('SHAM_CASH', 'SYRIATEL_CASH')),
    CONSTRAINT "provider_credit_merchant_account" CHECK ("merchant_account" ~ '^[A-Za-z0-9_-]{1,64}$'),
    CONSTRAINT "provider_credit_reference" CHECK ("provider_reference" ~ '^[A-Z0-9]{4,64}$'),
    CONSTRAINT "provider_credit_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "provider_credit_amount" CHECK ("amount_minor" > 0 AND "amount_minor" < 1000000000000000000),
    CONSTRAINT "provider_credit_source" CHECK ("source" IN ('PROVIDER_NOTIFICATION', 'PROVIDER_QUERY', 'MERCHANT_STATEMENT')),
    CONSTRAINT "provider_credit_evidence" CHECK ("evidence_digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "provider_credit_status" CHECK ("status" IN ('PENDING_APPROVAL', 'REJECTED', 'UNALLOCATED', 'ALLOCATED')),
    CONSTRAINT "provider_credit_unallocated_reason" CHECK ("unallocated_reason" IS NULL OR "unallocated_reason" IN (
        'NO_CLAIM', 'CLAIM_CLOSED', 'OBLIGATION_NOT_OPEN', 'CURRENCY_MISMATCH', 'AMOUNT_MISMATCH', 'REFUND_RESERVED')),
    CONSTRAINT "provider_credit_rejection_reason" CHECK ("rejection_reason" IS NULL OR "rejection_reason" IN (
        'NOT_ON_STATEMENT', 'DETAILS_DIFFER', 'WRONG_MERCHANT_ACCOUNT', 'DUPLICATE_ENTRY')),
    CONSTRAINT "provider_credit_active_slot" CHECK (
        ("status" = 'REJECTED' AND "active_slot" IS NULL)
        OR ("status" <> 'REJECTED' AND "active_slot" = 1)
    ),
    CONSTRAINT "provider_credit_facts" CHECK (
        ("status" = 'PENDING_APPROVAL' AND "source" = 'MERCHANT_STATEMENT'
            AND "decided_by_subject" IS NULL AND "decided_at" IS NULL AND "rejection_reason" IS NULL
            AND "unallocated_reason" IS NULL AND "attempt_id" IS NULL AND "obligation_id" IS NULL)
        OR ("status" = 'REJECTED' AND "source" = 'MERCHANT_STATEMENT'
            AND "decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL AND "rejection_reason" IS NOT NULL
            AND "unallocated_reason" IS NULL AND "attempt_id" IS NULL AND "obligation_id" IS NULL)
        OR ("status" = 'UNALLOCATED' AND "unallocated_reason" IS NOT NULL AND "rejection_reason" IS NULL
            AND "attempt_id" IS NULL AND "obligation_id" IS NULL)
        OR ("status" = 'ALLOCATED' AND "unallocated_reason" IS NULL AND "rejection_reason" IS NULL
            AND "attempt_id" IS NOT NULL AND "obligation_id" IS NOT NULL)
    ),
    -- A statement credit counts only after a second person decided it; a
    -- provider-authenticated credit is never "decided" by a person.
    CONSTRAINT "provider_credit_decision" CHECK (
        ("source" = 'MERCHANT_STATEMENT' AND "recorded_by_subject" IS NOT NULL
            AND ("status" = 'PENDING_APPROVAL' OR ("decided_by_subject" IS NOT NULL AND "decided_at" IS NOT NULL)))
        OR ("source" <> 'MERCHANT_STATEMENT' AND "decided_by_subject" IS NULL AND "decided_at" IS NULL)
    ),
    CONSTRAINT "provider_credit_separation" CHECK (
        "decided_by_subject" IS NULL OR "decided_by_subject" <> "recorded_by_subject"
    ),
    CONSTRAINT "provider_credit_revision" CHECK ("revision" >= 1),
    CONSTRAINT "provider_credit_times" CHECK (
        "updated_at" >= "created_at" AND "occurred_at" <= "created_at"
        AND ("decided_at" IS NULL OR "decided_at" >= "created_at")
    )
);
CREATE UNIQUE INDEX "provider_credit_key" ON "app"."provider_credit"("provider", "merchant_account", "provider_reference", "active_slot");
CREATE UNIQUE INDEX "provider_credit_attempt_id_key" ON "app"."provider_credit"("attempt_id");
CREATE INDEX "provider_credit_reference_idx" ON "app"."provider_credit"("provider", "provider_reference");
CREATE INDEX "provider_credit_status_idx" ON "app"."provider_credit"("status", "created_at");
CREATE INDEX "provider_credit_obligation_id_idx" ON "app"."provider_credit"("obligation_id");
ALTER TABLE "app"."provider_credit" ADD CONSTRAINT "provider_credit_attempt_id_fkey"
    FOREIGN KEY ("attempt_id") REFERENCES "app"."payment_attempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."provider_credit" ADD CONSTRAINT "provider_credit_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Refunds --------------------------------------------------------------------------
-- The amount of every refund that may still move money is reserved against its
-- credit; the provider refund reference can be claimed by one refund only.
CREATE TABLE "app"."payment_refund" (
    "id" UUID NOT NULL,
    "credit_id" UUID NOT NULL,
    "provider" VARCHAR(24) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason" VARCHAR(24) NOT NULL,
    "channel" VARCHAR(24) NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "requested_by_subject" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_by_subject" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "provider_refund_reference" VARCHAR(64),
    "evidence_digest" CHAR(64),
    "completed_by_subject" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "payment_refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_refund_provider" CHECK ("provider" IN ('SHAM_CASH', 'SYRIATEL_CASH')),
    CONSTRAINT "payment_refund_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "payment_refund_amount" CHECK ("amount_minor" > 0 AND "amount_minor" < 1000000000000000000),
    CONSTRAINT "payment_refund_reason" CHECK ("reason" IN (
        'SERVICE_NOT_DELIVERED', 'BOOKING_CANCELLED', 'DUPLICATE_PAYMENT', 'UNALLOCATABLE_CREDIT')),
    CONSTRAINT "payment_refund_channel" CHECK ("channel" IN ('PROVIDER_API', 'MANUAL_OUT_OF_BAND')),
    CONSTRAINT "payment_refund_status" CHECK ("status" IN (
        'REQUESTED', 'REJECTED', 'APPROVED', 'SUBMITTED', 'UNKNOWN', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT "payment_refund_references" CHECK (
        ("provider_refund_reference" IS NULL OR "provider_refund_reference" ~ '^[A-Z0-9]{4,64}$')
        AND ("evidence_digest" IS NULL OR "evidence_digest" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "payment_refund_facts" CHECK (
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
    ),
    -- Request, approval and the manual money-out record need two people.
    CONSTRAINT "payment_refund_separation" CHECK (
        ("decided_by_subject" IS NULL OR "decided_by_subject" <> "requested_by_subject")
        AND ("completed_by_subject" IS NULL OR "completed_by_subject" <> "requested_by_subject")
    ),
    CONSTRAINT "payment_refund_revision" CHECK ("revision" >= 1),
    CONSTRAINT "payment_refund_times" CHECK (
        "updated_at" >= "requested_at"
        AND ("decided_at" IS NULL OR "decided_at" >= "requested_at")
        AND ("completed_at" IS NULL OR "completed_at" >= "decided_at")
    )
);
CREATE UNIQUE INDEX "payment_refund_provider_reference_key" ON "app"."payment_refund"("provider", "provider_refund_reference");
CREATE INDEX "payment_refund_credit_id_idx" ON "app"."payment_refund"("credit_id");
CREATE INDEX "payment_refund_status_idx" ON "app"."payment_refund"("status", "requested_at");
ALTER TABLE "app"."payment_refund" ADD CONSTRAINT "payment_refund_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "app"."provider_credit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Attempts: MATCHED now names the allocated credit ------------------------------
ALTER TABLE "app"."payment_attempt" ADD COLUMN "credit_id" UUID;
CREATE UNIQUE INDEX "payment_attempt_credit_id_key" ON "app"."payment_attempt"("credit_id");
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "app"."provider_credit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Widened: a claim matched by a provider-notified credit has no human reviewer.
ALTER TABLE "app"."payment_attempt" DROP CONSTRAINT "payment_attempt_review_facts";
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_review_facts" CHECK (
    ("status" = 'PENDING_REVIEW' AND "reconciled_at" IS NULL AND "reconciled_by_kind" IS NULL
        AND "reconciled_by_subject" IS NULL AND "observed_minor" IS NULL AND "credit_id" IS NULL)
    OR ("status" <> 'PENDING_REVIEW' AND "reconciled_at" IS NOT NULL AND "reconciled_at" >= "submitted_at"
        AND (("reconciled_by_kind" IS NOT NULL AND "reconciled_by_subject" IS NOT NULL)
             OR ("status" = 'MATCHED' AND "credit_id" IS NOT NULL
                 AND "reconciled_by_kind" IS NULL AND "reconciled_by_subject" IS NULL)))
);
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_credit_link" CHECK (
    "credit_id" IS NULL OR "status" = 'MATCHED'
);

-- Ledger: credit-scoped journals and the new accounts ---------------------------
ALTER TABLE "app"."ledger_journal" ADD COLUMN "credit_id" UUID;
ALTER TABLE "app"."ledger_journal" DROP CONSTRAINT "ledger_journal_kind";
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_kind" CHECK ("kind" IN (
    'OBLIGATION_BILLED', 'OBLIGATION_VOIDED', 'PAYMENT_MATCHED',
    'CASH_COLLECTED', 'CASH_COLLECTION_REVERSED', 'CUSTODY_RECEIVED', 'CUSTODY_RECONCILED',
    'CREDIT_RECEIVED', 'CREDIT_ALLOCATED', 'REFUND_PAID'));
ALTER TABLE "app"."ledger_journal" DROP CONSTRAINT "ledger_journal_scope";
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_scope" CHECK (
    ("kind" IN ('CUSTODY_RECEIVED', 'CUSTODY_RECONCILED')
        AND "handover_id" IS NOT NULL AND "obligation_id" IS NULL AND "credit_id" IS NULL)
    OR ("kind" IN ('CREDIT_RECEIVED', 'REFUND_PAID')
        AND "credit_id" IS NOT NULL AND "obligation_id" IS NULL AND "handover_id" IS NULL)
    OR ("kind" = 'CREDIT_ALLOCATED'
        AND "credit_id" IS NOT NULL AND "obligation_id" IS NOT NULL AND "handover_id" IS NULL)
    OR ("kind" NOT IN ('CUSTODY_RECEIVED', 'CUSTODY_RECONCILED', 'CREDIT_RECEIVED', 'REFUND_PAID', 'CREDIT_ALLOCATED')
        AND "obligation_id" IS NOT NULL AND "handover_id" IS NULL AND "credit_id" IS NULL)
);
CREATE INDEX "ledger_journal_credit_id_idx" ON "app"."ledger_journal"("credit_id");
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "app"."provider_credit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "app"."ledger_line" DROP CONSTRAINT "ledger_line_account";
ALTER TABLE "app"."ledger_line" ADD CONSTRAINT "ledger_line_account" CHECK ("account" IN (
    'CUSTOMER_RECEIVABLE', 'BILLED_OBLIGATIONS_CONTROL', 'CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH',
    'CASH_IN_CUSTODY', 'TREASURY_CASH_UNRECONCILED', 'TREASURY_CASH',
    'CUSTODY_SHORTAGE_RECEIVABLE', 'CUSTODY_OVERAGE_SUSPENSE',
    'PROVIDER_CREDITS_UNALLOCATED', 'REFUNDS_CONTROL'));

-- Audit: provider-caused facts and credit/refund scope ---------------------------
ALTER TABLE "app"."billing_audit_event" ADD COLUMN "credit_id" UUID;
ALTER TABLE "app"."billing_audit_event" ADD COLUMN "refund_id" UUID;
ALTER TABLE "app"."billing_audit_event" DROP CONSTRAINT "billing_audit_event_actor_kind";
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_actor_kind" CHECK ("actor_kind" IN ('account', 'guest', 'provider'));
ALTER TABLE "app"."billing_audit_event" DROP CONSTRAINT "billing_audit_event_action";
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_action" CHECK ("action" IN (
    'billing.obligation.created', 'billing.obligation.voided', 'billing.intent.initialized',
    'billing.attempt.submitted', 'billing.attempt.reconciled',
    'billing.cash.collected', 'billing.cash.reversed',
    'billing.custody.handover-declared', 'billing.custody.handover-cancelled',
    'billing.custody.handover-received', 'billing.custody.handover-reconciled',
    'billing.credit.recorded', 'billing.credit.approved', 'billing.credit.rejected', 'billing.credit.allocated',
    'billing.refund.requested', 'billing.refund.approved', 'billing.refund.rejected',
    'billing.refund.outcome-recorded'));
ALTER TABLE "app"."billing_audit_event" DROP CONSTRAINT "billing_audit_event_scope";
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_scope" CHECK (
    "obligation_id" IS NOT NULL OR "handover_id" IS NOT NULL OR "credit_id" IS NOT NULL
);
CREATE INDEX "billing_audit_event_credit_idx" ON "app"."billing_audit_event"("credit_id", "occurred_at");
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "app"."provider_credit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_refund_id_fkey"
    FOREIGN KEY ("refund_id") REFERENCES "app"."payment_refund"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Outbox: proposed credit/refund event types (relay still not started).
ALTER TABLE "app"."outbox_message" DROP CONSTRAINT "outbox_message_event_type";
ALTER TABLE "app"."outbox_message" ADD CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN (
    'billing.obligation-created.v1', 'billing.obligation-status-changed.v1',
    'billing.cash-collected.v1', 'billing.cash-collection-reversed.v1',
    'billing.custody-handover-changed.v1',
    'billing.provider-credit-changed.v1', 'billing.refund-changed.v1'));

-- Replaced functions (same signatures, so existing triggers keep them) ----------

-- Balanced journal: the currency comes from the journal's obligation, handover
-- or credit (ledger_journal_scope fixes which are set).
CREATE OR REPLACE FUNCTION "app"."billing_check_journal_balanced"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    line_count INTEGER;
    unbalanced INTEGER;
    foreign_currency INTEGER;
    scope_currency CHAR(3);
BEGIN
    SELECT COALESCE(
        (SELECT o."currency" FROM "app"."billing_obligation" o WHERE o."id" = NEW."obligation_id"),
        (SELECT h."currency" FROM "app"."custody_handover" h WHERE h."id" = NEW."handover_id"),
        (SELECT c."currency" FROM "app"."provider_credit" c WHERE c."id" = NEW."credit_id"))
      INTO scope_currency;
    SELECT COUNT(*) INTO line_count FROM "app"."ledger_line" l WHERE l."journal_id" = NEW."id";
    SELECT COUNT(*) INTO unbalanced FROM (
        SELECT l."currency"
          FROM "app"."ledger_line" l
         WHERE l."journal_id" = NEW."id"
         GROUP BY l."currency"
        HAVING SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END) <> 0
    ) totals;
    SELECT COUNT(*) INTO foreign_currency
      FROM "app"."ledger_line" l
     WHERE l."journal_id" = NEW."id" AND l."currency" IS DISTINCT FROM scope_currency;
    IF line_count < 2 OR unbalanced <> 0 OR foreign_currency <> 0 THEN
        RAISE EXCEPTION 'LEDGER_JOURNAL_UNBALANCED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

-- Attempt guard: the P02-B1 rules, plus: MATCHED requires a provider credit
-- ALLOCATED to exactly this claim (same provider, reference, currency and the
-- claimed amount) written in this same transaction; the credit link is set
-- only by that transition and never changes.
CREATE OR REPLACE FUNCTION "app"."billing_guard_attempt_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."intent_id" <> OLD."intent_id"
       OR NEW."obligation_id" <> OLD."obligation_id" OR NEW."method" <> OLD."method"
       OR NEW."provider_reference" <> OLD."provider_reference" OR NEW."currency" <> OLD."currency"
       OR NEW."claimed_minor" <> OLD."claimed_minor" OR NEW."submitted_at" <> OLD."submitted_at"
       OR NEW."correlation_id" <> OLD."correlation_id"
       OR (OLD."credit_id" IS NOT NULL AND NEW."credit_id" IS DISTINCT FROM OLD."credit_id") THEN
        RAISE EXCEPTION 'PAYMENT_ATTEMPT_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (
        (OLD."status" = 'PENDING_REVIEW' AND NEW."status" IN ('MATCHED', 'MISMATCHED', 'UNKNOWN'))
        OR (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('MATCHED', 'MISMATCHED'))
    ) THEN
        RAISE EXCEPTION 'PAYMENT_ATTEMPT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."status" = 'MATCHED' AND (NEW."credit_id" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "app"."provider_credit" c
         WHERE c."id" = NEW."credit_id" AND c."attempt_id" = NEW."id" AND c."status" = 'ALLOCATED'
           AND c."provider" = NEW."method" AND c."provider_reference" = NEW."provider_reference"
           AND c."currency" = NEW."currency" AND c."amount_minor" = NEW."claimed_minor"
           AND c.xmin = pg_current_xact_id()::xid
    )) THEN
        RAISE EXCEPTION 'PAYMENT_ATTEMPT_MATCH_WITHOUT_CREDIT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Intent guard: the P03-B1 table, except that an electronic intent can become
-- SUCCEEDED only when one of its attempts was MATCHED in this same transaction.
CREATE OR REPLACE FUNCTION "app"."billing_guard_intent_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    collected BOOLEAN;
    reversed BOOLEAN;
    matched BOOLEAN;
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."obligation_id" <> OLD."obligation_id"
       OR NEW."method" <> OLD."method" OR NEW."currency" <> OLD."currency"
       OR NEW."amount_minor" <> OLD."amount_minor" OR NEW."created_at" <> OLD."created_at"
       OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    collected := OLD."method" = 'CASH_ON_COMPLETION'
        AND OLD."status" = 'AWAITING_CASH_COLLECTION' AND NEW."status" = 'SUCCEEDED'
        AND EXISTS (
            SELECT 1 FROM "app"."cash_receipt" r
             WHERE r."intent_id" = NEW."id" AND r."custody_status" = 'HELD'
               AND r.xmin = pg_current_xact_id()::xid
        );
    reversed := OLD."method" = 'CASH_ON_COMPLETION'
        AND OLD."status" = 'SUCCEEDED' AND NEW."status" = 'CANCELLED'
        AND EXISTS (
            SELECT 1 FROM "app"."cash_receipt" r
              JOIN "app"."cash_receipt_reversal" v ON v."receipt_id" = r."id"
             WHERE r."intent_id" = NEW."id" AND v.xmin = pg_current_xact_id()::xid
        );
    matched := OLD."method" <> 'CASH_ON_COMPLETION'
        AND OLD."status" = 'UNDER_REVIEW' AND NEW."status" = 'SUCCEEDED'
        AND EXISTS (
            SELECT 1 FROM "app"."payment_attempt" a
             WHERE a."intent_id" = NEW."id" AND a."status" = 'MATCHED' AND a."credit_id" IS NOT NULL
               AND a.xmin = pg_current_xact_id()::xid
        );
    IF NOT (
        (OLD."status" = 'AWAITING_CASH_COLLECTION' AND NEW."status" IN ('SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'AWAITING_CUSTOMER_PAYMENT' AND NEW."status" IN ('UNDER_REVIEW', 'SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" = 'AWAITING_CUSTOMER_PAYMENT')
        OR matched
        OR collected
        OR reversed
    ) OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Obligation/ledger agreement: money applied from a provider credit (a debit of
-- the unallocated-credit account in the obligation's own journals) counts as
-- cleared, like provider clearing (P02-B1 rows) and cash in custody.
CREATE OR REPLACE FUNCTION "app"."billing_assert_obligation_ledger"(target UUID) RETURNS void
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    current_row RECORD;
    receivable NUMERIC;
    cleared NUMERIC;
    expected_receivable NUMERIC;
BEGIN
    SELECT * INTO current_row FROM "app"."billing_obligation" o WHERE o."id" = target;
    -- Computed outside IF: PL/pgSQL ends an IF condition at the first THEN.
    expected_receivable := CASE WHEN current_row."status" = 'VOIDED' THEN 0
                                ELSE current_row."amount_minor"::NUMERIC - current_row."verified_minor"::NUMERIC END;
    SELECT COALESCE(SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END), 0)
      INTO receivable
      FROM "app"."ledger_line" l JOIN "app"."ledger_journal" j ON j."id" = l."journal_id"
     WHERE j."obligation_id" = target AND l."account" = 'CUSTOMER_RECEIVABLE';
    SELECT COALESCE(SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END), 0)
      INTO cleared
      FROM "app"."ledger_line" l JOIN "app"."ledger_journal" j ON j."id" = l."journal_id"
     WHERE j."obligation_id" = target
       AND l."account" IN ('CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH', 'CASH_IN_CUSTODY',
                           'PROVIDER_CREDITS_UNALLOCATED');
    IF receivable <> expected_receivable OR cleared <> current_row."verified_minor"::NUMERIC THEN
        RAISE EXCEPTION 'BILLING_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
END;
$$;

-- New guards -------------------------------------------------------------------

-- A credit is born at revision 1. A statement credit awaits approval; a
-- provider-authenticated credit is established immediately.
CREATE FUNCTION "app"."billing_guard_credit_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."revision" <> 1 OR NEW."updated_at" <> NEW."created_at"
       OR (NEW."source" = 'MERCHANT_STATEMENT' AND NEW."status" <> 'PENDING_APPROVAL')
       OR (NEW."source" <> 'MERCHANT_STATEMENT' AND NEW."status" NOT IN ('UNALLOCATED', 'ALLOCATED')) THEN
        RAISE EXCEPTION 'PROVIDER_CREDIT_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- The money facts of a credit never change; only its decision and allocation
-- move forward: PENDING_APPROVAL -> REJECTED | UNALLOCATED | ALLOCATED, and
-- UNALLOCATED -> ALLOCATED. ALLOCATED and REJECTED are terminal.
CREATE FUNCTION "app"."billing_guard_credit_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."provider" <> OLD."provider"
       OR NEW."merchant_account" <> OLD."merchant_account"
       OR NEW."provider_reference" <> OLD."provider_reference" OR NEW."currency" <> OLD."currency"
       OR NEW."amount_minor" <> OLD."amount_minor" OR NEW."occurred_at" <> OLD."occurred_at"
       OR NEW."source" <> OLD."source" OR NEW."evidence_digest" <> OLD."evidence_digest"
       OR NEW."recorded_by_subject" IS DISTINCT FROM OLD."recorded_by_subject"
       OR NEW."created_at" <> OLD."created_at" OR NEW."correlation_id" <> OLD."correlation_id"
       OR (OLD."decided_by_subject" IS NOT NULL
           AND (NEW."decided_by_subject" IS DISTINCT FROM OLD."decided_by_subject"
                OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at")) THEN
        RAISE EXCEPTION 'PROVIDER_CREDIT_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (
        (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('REJECTED', 'UNALLOCATED', 'ALLOCATED'))
        OR (OLD."status" = 'UNALLOCATED' AND NEW."status" = 'ALLOCATED')
    ) OR NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'PROVIDER_CREDIT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- A refund is requested against an established credit, in its provider and
-- currency, and only while the reservations (including this one) fit within
-- the credit. The credit row is locked here, so concurrent requests serialise
-- even when a writer does not lock it itself.
CREATE FUNCTION "app"."billing_guard_refund_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    credit RECORD;
    reserved NUMERIC;
BEGIN
    SELECT * INTO credit FROM "app"."provider_credit" c WHERE c."id" = NEW."credit_id" FOR UPDATE;
    SELECT COALESCE(SUM(r."amount_minor"::NUMERIC), 0) INTO reserved
      FROM "app"."payment_refund" r
     WHERE r."credit_id" = NEW."credit_id"
       AND r."status" IN ('REQUESTED', 'APPROVED', 'SUBMITTED', 'UNKNOWN', 'SUCCEEDED');
    IF NEW."status" <> 'REQUESTED' OR NEW."revision" <> 1 OR NEW."updated_at" <> NEW."requested_at"
       OR credit."id" IS NULL OR credit."status" NOT IN ('UNALLOCATED', 'ALLOCATED')
       OR credit."provider" <> NEW."provider" OR credit."currency" <> NEW."currency"
       OR reserved + NEW."amount_minor"::NUMERIC > credit."amount_minor"::NUMERIC THEN
        RAISE EXCEPTION 'PAYMENT_REFUND_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_refund_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."credit_id" <> OLD."credit_id" OR NEW."provider" <> OLD."provider"
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
    IF NOT (
        (OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED'))
        OR (OLD."status" = 'APPROVED' AND OLD."channel" = 'PROVIDER_API'
            AND NEW."status" IN ('SUBMITTED', 'UNKNOWN', 'SUCCEEDED', 'FAILED'))
        OR (OLD."status" = 'APPROVED' AND OLD."channel" = 'MANUAL_OUT_OF_BAND'
            AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
        OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
        OR (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('SUBMITTED', 'SUCCEEDED', 'FAILED'))
    ) OR NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'PAYMENT_REFUND_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- At COMMIT, per credit: reservations fit within the credit, and the credit's
-- own journals carry exactly the expected net per account for its status and
-- its completed refunds. An ALLOCATED credit names the MATCHED claim that
-- names it back. A pending or rejected statement entry has no ledger effect.
CREATE FUNCTION "app"."billing_assert_provider_credit"(target UUID) RETURNS void
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    c RECORD;
    clearing VARCHAR(32);
    reserved NUMERIC;
    refunded NUMERIC;
    net_clearing NUMERIC;
    net_unallocated NUMERIC;
    net_refunds NUMERIC;
    net_receivable NUMERIC;
    foreign_lines INTEGER;
    confirmed BOOLEAN;
BEGIN
    SELECT * INTO c FROM "app"."provider_credit" x WHERE x."id" = target;
    clearing := CASE c."provider" WHEN 'SHAM_CASH' THEN 'CLEARING_SHAM_CASH' ELSE 'CLEARING_SYRIATEL_CASH' END;
    SELECT
        COALESCE(SUM(r."amount_minor"::NUMERIC) FILTER (
            WHERE r."status" IN ('REQUESTED', 'APPROVED', 'SUBMITTED', 'UNKNOWN', 'SUCCEEDED')), 0),
        COALESCE(SUM(r."amount_minor"::NUMERIC) FILTER (WHERE r."status" = 'SUCCEEDED'), 0)
      INTO reserved, refunded
      FROM "app"."payment_refund" r WHERE r."credit_id" = c."id";
    SELECT
        COALESCE(SUM(CASE WHEN l."account" = clearing THEN
            CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'PROVIDER_CREDITS_UNALLOCATED' THEN
            CASE WHEN l."side" = 'CREDIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'REFUNDS_CONTROL' THEN
            CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'CUSTOMER_RECEIVABLE' THEN
            CASE WHEN l."side" = 'CREDIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COUNT(*) FILTER (WHERE l."account" NOT IN (clearing, 'PROVIDER_CREDITS_UNALLOCATED',
                                                   'REFUNDS_CONTROL', 'CUSTOMER_RECEIVABLE'))
      INTO net_clearing, net_unallocated, net_refunds, net_receivable, foreign_lines
      FROM "app"."ledger_line" l JOIN "app"."ledger_journal" j ON j."id" = l."journal_id"
     WHERE j."credit_id" = c."id";

    confirmed := c."status" IN ('UNALLOCATED', 'ALLOCATED');
    IF reserved > c."amount_minor"::NUMERIC
       OR (NOT confirmed AND reserved <> 0)
       OR foreign_lines <> 0
       OR net_clearing <> (CASE WHEN confirmed THEN c."amount_minor"::NUMERIC - refunded ELSE 0 END)
       OR net_unallocated <> (CASE WHEN c."status" = 'UNALLOCATED' THEN c."amount_minor"::NUMERIC - refunded ELSE 0 END)
       OR net_refunds <> (CASE WHEN c."status" = 'ALLOCATED' THEN refunded ELSE 0 END)
       OR net_receivable <> (CASE WHEN c."status" = 'ALLOCATED' THEN c."amount_minor"::NUMERIC ELSE 0 END) THEN
        RAISE EXCEPTION 'PROVIDER_CREDIT_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    IF c."status" = 'ALLOCATED' AND NOT EXISTS (
        SELECT 1 FROM "app"."payment_attempt" a
         WHERE a."id" = c."attempt_id" AND a."credit_id" = c."id" AND a."status" = 'MATCHED'
           AND a."obligation_id" = c."obligation_id"
    ) THEN
        RAISE EXCEPTION 'PROVIDER_CREDIT_ALLOCATION_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
END;
$$;

-- COMMIT-time trigger functions. SECURITY DEFINER so that they may call the
-- billing_assert_* helpers (EXECUTE revoked from PUBLIC) as the owner; see the
-- header. They cannot be invoked directly (trigger functions), read only, and
-- keep the pinned search_path with pg_temp last.
CREATE FUNCTION "app"."billing_check_provider_credit"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM "app"."billing_assert_provider_credit"(NEW."id");
    RETURN NULL;
END;
$$;

CREATE FUNCTION "app"."billing_check_refund_credit"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM "app"."billing_assert_provider_credit"(NEW."credit_id");
    RETURN NULL;
END;
$$;

-- Every journal is checked against the facts it moves (P03-B1), now including
-- the provider credit it is posted against.
CREATE OR REPLACE FUNCTION "app"."billing_check_journal_effects"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    touched RECORD;
BEGIN
    IF NEW."obligation_id" IS NOT NULL THEN
        PERFORM "app"."billing_assert_obligation_ledger"(NEW."obligation_id");
    END IF;
    IF NEW."handover_id" IS NOT NULL THEN
        PERFORM "app"."billing_assert_handover"(NEW."handover_id");
    END IF;
    IF NEW."credit_id" IS NOT NULL THEN
        PERFORM "app"."billing_assert_provider_credit"(NEW."credit_id");
    END IF;
    FOR touched IN
        SELECT DISTINCT l."holder_subject" AS holder, l."currency" AS money_currency
          FROM "app"."ledger_line" l
         WHERE l."journal_id" = NEW."id" AND l."account" = 'CASH_IN_CUSTODY'
    LOOP
        PERFORM "app"."billing_assert_custody_holder"(touched.holder, touched.money_currency);
    END LOOP;
    RETURN NULL;
END;
$$;

-- The other P03-B1 COMMIT-time trigger functions that call the helpers.
ALTER FUNCTION "app"."billing_check_obligation_ledger"() SECURITY DEFINER;
ALTER FUNCTION "app"."billing_check_custody_holder"() SECURITY DEFINER;
ALTER FUNCTION "app"."billing_check_handover"() SECURITY DEFINER;

CREATE TRIGGER "provider_credit_guard_insert" BEFORE INSERT ON "app"."provider_credit" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_credit_insert"();
CREATE TRIGGER "provider_credit_guard_update" BEFORE UPDATE ON "app"."provider_credit" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_credit_update"();
CREATE TRIGGER "payment_refund_guard_insert" BEFORE INSERT ON "app"."payment_refund" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_refund_insert"();
CREATE TRIGGER "payment_refund_guard_update" BEFORE UPDATE ON "app"."payment_refund" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_refund_update"();
CREATE CONSTRAINT TRIGGER "provider_credit_consistency" AFTER INSERT OR UPDATE ON "app"."provider_credit"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_provider_credit"();
CREATE CONSTRAINT TRIGGER "payment_refund_consistency" AFTER INSERT OR UPDATE ON "app"."payment_refund"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_refund_credit"();

-- Financial facts are never deleted.
CREATE TRIGGER "provider_credit_no_delete" BEFORE DELETE ON "app"."provider_credit" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "payment_refund_no_delete" BEFORE DELETE ON "app"."payment_refund" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "provider_credit_no_truncate" BEFORE TRUNCATE ON "app"."provider_credit" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "payment_refund_no_truncate" BEFORE TRUNCATE ON "app"."payment_refund" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();

REVOKE ALL ON FUNCTION "app"."billing_guard_credit_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_credit_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_refund_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_refund_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_assert_provider_credit"(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_provider_credit"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_refund_credit"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_journal_effects"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_journal_balanced"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_attempt_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_intent_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_assert_obligation_ledger"(UUID) FROM PUBLIC;
