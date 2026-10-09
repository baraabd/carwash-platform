-- P03-B1: cash collection receipt, linked reversal, technician custody,
-- handover to the company, treasury receipt and settlement reconciliation.
-- Applied by the migration identity (cw_billing_migrate) as a separate job.
-- Application replicas never run this file.
--
-- Expand-only with respect to P02-B1 code:
--   * new tables;
--   * new NULLABLE columns (ledger_journal.handover_id, ledger_line.holder_subject,
--     billing_audit_event.receipt_id / handover_id);
--   * ledger_journal.obligation_id and billing_audit_event.obligation_id become
--     NULLABLE (P02-B1 code always writes them);
--   * CHECK constraints are WIDENED only (every row P02-B1 code can write still
--     passes; existing rows are validated when the constraint is re-added);
--   * guard functions are replaced with versions that accept every transition
--     P02-B1 accepted plus the cash transitions below, each of which requires
--     its evidence row to be written in the SAME transaction.
-- Rollback before any P03-B row exists: revert the code, then restore the
-- P02-B1 function bodies/constraints and drop the new objects in reverse order.
-- Rollback after cash rows exist requires a reviewed financial data plan and
-- restore evidence; never drop or edit financial facts silently.

-- Cash receipts ----------------------------------------------------------------
-- One effective (non-reversed) receipt per obligation and per booking:
-- active_slot is 1 until the receipt is reversed, then NULL (history kept).
CREATE TABLE "app"."cash_receipt" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "assignment_revision" INTEGER NOT NULL,
    "collector_subject" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "custody_status" VARCHAR(12) NOT NULL,
    "active_slot" SMALLINT,
    "handover_id" UUID,
    "revision" INTEGER NOT NULL,
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "cash_receipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_receipt_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "cash_receipt_amount" CHECK ("amount_minor" > 0 AND "amount_minor" < 1000000000000000000),
    CONSTRAINT "cash_receipt_assignment_revision" CHECK ("assignment_revision" >= 1),
    CONSTRAINT "cash_receipt_custody_status" CHECK ("custody_status" IN ('HELD', 'IN_HANDOVER', 'DEPOSITED', 'SETTLED', 'REVERSED')),
    CONSTRAINT "cash_receipt_active_slot" CHECK (
        ("custody_status" = 'REVERSED' AND "active_slot" IS NULL)
        OR ("custody_status" <> 'REVERSED' AND "active_slot" = 1)
    ),
    CONSTRAINT "cash_receipt_handover_link" CHECK (
        ("custody_status" IN ('HELD', 'REVERSED') AND "handover_id" IS NULL)
        OR ("custody_status" IN ('IN_HANDOVER', 'DEPOSITED', 'SETTLED') AND "handover_id" IS NOT NULL)
    ),
    CONSTRAINT "cash_receipt_revision" CHECK ("revision" >= 1),
    CONSTRAINT "cash_receipt_times" CHECK ("updated_at" >= "collected_at")
);
CREATE UNIQUE INDEX "cash_receipt_obligation_id_active_slot_key" ON "app"."cash_receipt"("obligation_id", "active_slot");
CREATE UNIQUE INDEX "cash_receipt_booking_id_active_slot_key" ON "app"."cash_receipt"("booking_id", "active_slot");
CREATE INDEX "cash_receipt_collector_idx" ON "app"."cash_receipt"("collector_subject", "custody_status", "collected_at");
CREATE INDEX "cash_receipt_handover_id_idx" ON "app"."cash_receipt"("handover_id");
ALTER TABLE "app"."cash_receipt" ADD CONSTRAINT "cash_receipt_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."cash_receipt" ADD CONSTRAINT "cash_receipt_intent_id_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "app"."payment_intent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- One reversal per receipt, ever. A reversal is a new linked fact; the original
-- receipt and its journal are never edited or deleted.
CREATE TABLE "app"."cash_receipt_reversal" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "reason" VARCHAR(24) NOT NULL,
    "reversed_by_subject" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "cash_receipt_reversal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_receipt_reversal_reason" CHECK ("reason" IN ('RECORDED_IN_ERROR', 'WRONG_BOOKING', 'AMOUNT_NOT_RECEIVED', 'DUPLICATE_RECORD'))
);
CREATE UNIQUE INDEX "cash_receipt_reversal_receipt_id_key" ON "app"."cash_receipt_reversal"("receipt_id");
CREATE INDEX "cash_receipt_reversal_obligation_id_idx" ON "app"."cash_receipt_reversal"("obligation_id");
ALTER TABLE "app"."cash_receipt_reversal" ADD CONSTRAINT "cash_receipt_reversal_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "app"."cash_receipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."cash_receipt_reversal" ADD CONSTRAINT "cash_receipt_reversal_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Custody handovers ------------------------------------------------------------
-- A treasury or settlement reference can be claimed by exactly one handover.
CREATE TABLE "app"."custody_handover" (
    "id" UUID NOT NULL,
    "holder_subject" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "declared_minor" BIGINT NOT NULL,
    "receipt_count" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "counted_minor" BIGINT,
    "shortage_minor" BIGINT,
    "overage_minor" BIGINT,
    "treasury_reference" VARCHAR(64),
    "received_by_subject" UUID,
    "received_at" TIMESTAMPTZ(3),
    "settlement_reference" VARCHAR(64),
    "reconciled_by_subject" UUID,
    "reconciled_at" TIMESTAMPTZ(3),
    "cancelled_by_subject" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "custody_handover_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custody_handover_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "custody_handover_declared" CHECK ("declared_minor" > 0 AND "declared_minor" < 1000000000000000000),
    CONSTRAINT "custody_handover_receipt_count" CHECK ("receipt_count" BETWEEN 1 AND 200),
    CONSTRAINT "custody_handover_status" CHECK ("status" IN ('PENDING', 'RECEIVED', 'RECONCILED', 'CANCELLED')),
    CONSTRAINT "custody_handover_references" CHECK (
        ("treasury_reference" IS NULL OR "treasury_reference" ~ '^[A-Z0-9]{4,64}$')
        AND ("settlement_reference" IS NULL OR "settlement_reference" ~ '^[A-Z0-9]{4,64}$')
    ),
    CONSTRAINT "custody_handover_facts" CHECK (
        ("status" = 'PENDING'
            AND "counted_minor" IS NULL AND "shortage_minor" IS NULL AND "overage_minor" IS NULL
            AND "treasury_reference" IS NULL AND "received_by_subject" IS NULL AND "received_at" IS NULL
            AND "settlement_reference" IS NULL AND "reconciled_by_subject" IS NULL AND "reconciled_at" IS NULL
            AND "cancelled_by_subject" IS NULL AND "cancelled_at" IS NULL)
        OR ("status" = 'CANCELLED'
            AND "counted_minor" IS NULL AND "shortage_minor" IS NULL AND "overage_minor" IS NULL
            AND "treasury_reference" IS NULL AND "received_by_subject" IS NULL AND "received_at" IS NULL
            AND "settlement_reference" IS NULL AND "reconciled_by_subject" IS NULL AND "reconciled_at" IS NULL
            AND "cancelled_by_subject" IS NOT NULL AND "cancelled_at" IS NOT NULL)
        OR ("status" = 'RECEIVED'
            AND "counted_minor" IS NOT NULL AND "shortage_minor" IS NOT NULL AND "overage_minor" IS NOT NULL
            AND "treasury_reference" IS NOT NULL AND "received_by_subject" IS NOT NULL AND "received_at" IS NOT NULL
            AND "settlement_reference" IS NULL AND "reconciled_by_subject" IS NULL AND "reconciled_at" IS NULL
            AND "cancelled_by_subject" IS NULL AND "cancelled_at" IS NULL)
        OR ("status" = 'RECONCILED'
            AND "counted_minor" IS NOT NULL AND "shortage_minor" IS NOT NULL AND "overage_minor" IS NOT NULL
            AND "treasury_reference" IS NOT NULL AND "received_by_subject" IS NOT NULL AND "received_at" IS NOT NULL
            AND "settlement_reference" IS NOT NULL AND "reconciled_by_subject" IS NOT NULL AND "reconciled_at" IS NOT NULL
            AND "cancelled_by_subject" IS NULL AND "cancelled_at" IS NULL)
    ),
    -- counted - declared = overage - shortage, with at most one of them non-zero.
    CONSTRAINT "custody_handover_discrepancy" CHECK (
        "counted_minor" IS NULL OR (
            "counted_minor" >= 0 AND "shortage_minor" >= 0 AND "overage_minor" >= 0
            AND ("shortage_minor" = 0 OR "overage_minor" = 0)
            AND "counted_minor" - "declared_minor" = "overage_minor" - "shortage_minor"
        )
    ),
    -- Separation of duties: the holder never receives or reconciles their own
    -- cash, and the receiver never reconciles their own count.
    CONSTRAINT "custody_handover_separation" CHECK (
        ("received_by_subject" IS NULL OR "received_by_subject" <> "holder_subject")
        AND ("reconciled_by_subject" IS NULL OR ("reconciled_by_subject" <> "holder_subject"
            AND "reconciled_by_subject" <> "received_by_subject"))
    ),
    CONSTRAINT "custody_handover_revision" CHECK ("revision" >= 1),
    CONSTRAINT "custody_handover_times" CHECK (
        "updated_at" >= "created_at"
        AND ("received_at" IS NULL OR "received_at" >= "created_at")
        AND ("reconciled_at" IS NULL OR "reconciled_at" >= "received_at")
        AND ("cancelled_at" IS NULL OR "cancelled_at" >= "created_at")
    )
);
CREATE UNIQUE INDEX "custody_handover_treasury_reference_key" ON "app"."custody_handover"("treasury_reference");
CREATE UNIQUE INDEX "custody_handover_settlement_reference_key" ON "app"."custody_handover"("settlement_reference");
CREATE INDEX "custody_handover_holder_idx" ON "app"."custody_handover"("holder_subject", "status", "created_at");
CREATE INDEX "custody_handover_status_idx" ON "app"."custody_handover"("status", "created_at");
ALTER TABLE "app"."cash_receipt" ADD CONSTRAINT "cash_receipt_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "app"."custody_handover"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "app"."custody_handover_item" (
    "handover_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    CONSTRAINT "custody_handover_item_pkey" PRIMARY KEY ("handover_id", "receipt_id"),
    CONSTRAINT "custody_handover_item_amount" CHECK ("amount_minor" > 0)
);
CREATE INDEX "custody_handover_item_receipt_id_idx" ON "app"."custody_handover_item"("receipt_id");
ALTER TABLE "app"."custody_handover_item" ADD CONSTRAINT "custody_handover_item_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "app"."custody_handover"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."custody_handover_item" ADD CONSTRAINT "custody_handover_item_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "app"."cash_receipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Ledger: handover-scoped journals and the custody holder dimension -------------
ALTER TABLE "app"."ledger_journal" ALTER COLUMN "obligation_id" DROP NOT NULL;
ALTER TABLE "app"."ledger_journal" ADD COLUMN "handover_id" UUID;
ALTER TABLE "app"."ledger_journal" DROP CONSTRAINT "ledger_journal_kind";
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_kind" CHECK ("kind" IN (
    'OBLIGATION_BILLED', 'OBLIGATION_VOIDED', 'PAYMENT_MATCHED',
    'CASH_COLLECTED', 'CASH_COLLECTION_REVERSED', 'CUSTODY_RECEIVED', 'CUSTODY_RECONCILED'));
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_scope" CHECK (
    ("kind" IN ('CUSTODY_RECEIVED', 'CUSTODY_RECONCILED') AND "handover_id" IS NOT NULL AND "obligation_id" IS NULL)
    OR ("kind" NOT IN ('CUSTODY_RECEIVED', 'CUSTODY_RECONCILED') AND "obligation_id" IS NOT NULL AND "handover_id" IS NULL)
);
CREATE INDEX "ledger_journal_handover_id_idx" ON "app"."ledger_journal"("handover_id");
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "app"."custody_handover"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "app"."ledger_line" ADD COLUMN "holder_subject" UUID;
ALTER TABLE "app"."ledger_line" DROP CONSTRAINT "ledger_line_account";
ALTER TABLE "app"."ledger_line" ADD CONSTRAINT "ledger_line_account" CHECK ("account" IN (
    'CUSTOMER_RECEIVABLE', 'BILLED_OBLIGATIONS_CONTROL', 'CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH',
    'CASH_IN_CUSTODY', 'TREASURY_CASH_UNRECONCILED', 'TREASURY_CASH',
    'CUSTODY_SHORTAGE_RECEIVABLE', 'CUSTODY_OVERAGE_SUSPENSE'));
ALTER TABLE "app"."ledger_line" ADD CONSTRAINT "ledger_line_holder" CHECK (
    ("account" IN ('CASH_IN_CUSTODY', 'CUSTODY_SHORTAGE_RECEIVABLE')) = ("holder_subject" IS NOT NULL)
);
CREATE INDEX "ledger_line_holder_idx" ON "app"."ledger_line"("account", "holder_subject", "currency");

-- Payment intents: cash may now SUCCEED (collection) and a succeeded cash intent
-- may be CANCELLED (linked reversal). Electronic rules are unchanged.
ALTER TABLE "app"."payment_intent" DROP CONSTRAINT "payment_intent_method_status";
ALTER TABLE "app"."payment_intent" ADD CONSTRAINT "payment_intent_method_status" CHECK (
    ("method" = 'CASH_ON_COMPLETION' AND "status" IN ('AWAITING_CASH_COLLECTION', 'SUCCEEDED', 'SUPERSEDED', 'CANCELLED'))
    OR ("method" <> 'CASH_ON_COMPLETION' AND "status" <> 'AWAITING_CASH_COLLECTION')
);

-- Audit: custody facts are not obligation-scoped.
ALTER TABLE "app"."billing_audit_event" ALTER COLUMN "obligation_id" DROP NOT NULL;
ALTER TABLE "app"."billing_audit_event" ADD COLUMN "receipt_id" UUID;
ALTER TABLE "app"."billing_audit_event" ADD COLUMN "handover_id" UUID;
ALTER TABLE "app"."billing_audit_event" DROP CONSTRAINT "billing_audit_event_action";
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_action" CHECK ("action" IN (
    'billing.obligation.created', 'billing.obligation.voided', 'billing.intent.initialized',
    'billing.attempt.submitted', 'billing.attempt.reconciled',
    'billing.cash.collected', 'billing.cash.reversed',
    'billing.custody.handover-declared', 'billing.custody.handover-cancelled',
    'billing.custody.handover-received', 'billing.custody.handover-reconciled'));
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_scope" CHECK (
    "obligation_id" IS NOT NULL OR "handover_id" IS NOT NULL
);
CREATE INDEX "billing_audit_event_handover_idx" ON "app"."billing_audit_event"("handover_id", "occurred_at");
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "app"."cash_receipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_handover_id_fkey"
    FOREIGN KEY ("handover_id") REFERENCES "app"."custody_handover"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Outbox: proposed cash/custody event types (relay still not started).
ALTER TABLE "app"."outbox_message" DROP CONSTRAINT "outbox_message_event_type";
ALTER TABLE "app"."outbox_message" ADD CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN (
    'billing.obligation-created.v1', 'billing.obligation-status-changed.v1',
    'billing.cash-collected.v1', 'billing.cash-collection-reversed.v1',
    'billing.custody-handover-changed.v1'));

-- Replaced P02-B1 functions (same signatures, so existing triggers keep them) --

-- Balanced journal: the currency now comes from the journal's obligation OR
-- handover (exactly one is set, ledger_journal_scope).
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
        (SELECT h."currency" FROM "app"."custody_handover" h WHERE h."id" = NEW."handover_id"))
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

-- Obligation guard: unchanged, except that a SETTLED obligation may reopen
-- (SETTLED -> OPEN, verified decreasing) when, and only when, a cash receipt
-- reversal for it is written in this same transaction. The COMMIT-time ledger
-- check still requires the matching reversal journal.
CREATE OR REPLACE FUNCTION "app"."billing_guard_obligation_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    reopening BOOLEAN;
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."owner_kind" <> OLD."owner_kind"
       OR NEW."owner_subject" <> OLD."owner_subject" OR NEW."quote_id" <> OLD."quote_id"
       OR NEW."currency" <> OLD."currency" OR NEW."amount_minor" <> OLD."amount_minor"
       OR NEW."created_at" <> OLD."created_at" OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'BILLING_OBLIGATION_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    reopening := OLD."status" = 'SETTLED' AND NEW."status" = 'OPEN'
        AND EXISTS (
            SELECT 1 FROM "app"."cash_receipt_reversal" v
             WHERE v."obligation_id" = NEW."id" AND v.xmin = pg_current_xact_id()::xid
        );
    IF OLD."status" <> 'OPEN' AND NOT reopening THEN
        RAISE EXCEPTION 'BILLING_OBLIGATION_TERMINAL' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at"
       OR (NEW."verified_minor" < OLD."verified_minor" AND NOT reopening) THEN
        RAISE EXCEPTION 'BILLING_OBLIGATION_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Intent guard: the P02-B1 transition table plus
--   cash AWAITING_CASH_COLLECTION -> SUCCEEDED (receipt for this intent written now),
--   cash SUCCEEDED -> CANCELLED (reversal of this intent's receipt written now).
CREATE OR REPLACE FUNCTION "app"."billing_guard_intent_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    collected BOOLEAN;
    reversed BOOLEAN;
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
    IF NOT (
        (OLD."status" = 'AWAITING_CASH_COLLECTION' AND NEW."status" IN ('SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'AWAITING_CUSTOMER_PAYMENT' AND NEW."status" IN ('UNDER_REVIEW', 'SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('AWAITING_CUSTOMER_PAYMENT', 'SUCCEEDED'))
        OR collected
        OR reversed
    ) OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Obligation/ledger agreement: cash held in custody counts as cleared receipt.
CREATE FUNCTION "app"."billing_assert_obligation_ledger"(target UUID) RETURNS void
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
       AND l."account" IN ('CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH', 'CASH_IN_CUSTODY');
    IF receivable <> expected_receivable OR cleared <> current_row."verified_minor"::NUMERIC THEN
        RAISE EXCEPTION 'BILLING_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION "app"."billing_check_obligation_ledger"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM "app"."billing_assert_obligation_ledger"(NEW."id");
    RETURN NULL;
END;
$$;

-- New guards ----------------------------------------------------------------

-- A receipt is born HELD, for an active cash intent of an OPEN obligation, for
-- exactly the outstanding amount, by someone other than the obligation's owner.
CREATE FUNCTION "app"."billing_guard_receipt_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."custody_status" <> 'HELD' OR NEW."revision" <> 1 OR NEW."updated_at" <> NEW."collected_at"
       OR NOT EXISTS (
        SELECT 1 FROM "app"."payment_intent" i
          JOIN "app"."billing_obligation" o ON o."id" = i."obligation_id"
         WHERE i."id" = NEW."intent_id" AND i."obligation_id" = NEW."obligation_id"
           AND i."method" = 'CASH_ON_COMPLETION' AND i."status" = 'AWAITING_CASH_COLLECTION'
           AND i."currency" = NEW."currency" AND i."amount_minor" = NEW."amount_minor"
           AND o."status" = 'OPEN' AND o."currency" = NEW."currency"
           AND o."amount_minor" - o."verified_minor" = NEW."amount_minor"
           AND o."owner_subject" <> NEW."collector_subject"
    ) THEN
        RAISE EXCEPTION 'CASH_RECEIPT_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Receipt custody transitions, each backed by the handover/reversal fact that
-- justifies it. Identity, amount, collector and links are immutable.
CREATE FUNCTION "app"."billing_guard_receipt_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    handover_status VARCHAR(12);
    handover_holder UUID;
    handover_currency CHAR(3);
    allowed BOOLEAN;
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."obligation_id" <> OLD."obligation_id"
       OR NEW."intent_id" <> OLD."intent_id" OR NEW."booking_id" <> OLD."booking_id"
       OR NEW."assignment_id" <> OLD."assignment_id" OR NEW."assignment_revision" <> OLD."assignment_revision"
       OR NEW."collector_subject" <> OLD."collector_subject" OR NEW."currency" <> OLD."currency"
       OR NEW."amount_minor" <> OLD."amount_minor" OR NEW."collected_at" <> OLD."collected_at"
       OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'CASH_RECEIPT_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'CASH_RECEIPT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    SELECT h."status", h."holder_subject", h."currency"
      INTO handover_status, handover_holder, handover_currency
      FROM "app"."custody_handover" h
     WHERE h."id" = COALESCE(NEW."handover_id", OLD."handover_id");
    allowed := CASE
        WHEN OLD."custody_status" = 'HELD' AND NEW."custody_status" = 'IN_HANDOVER' THEN
            handover_status = 'PENDING' AND handover_holder = NEW."collector_subject"
            AND handover_currency = NEW."currency"
        WHEN OLD."custody_status" = 'IN_HANDOVER' AND NEW."custody_status" = 'HELD' THEN
            handover_status = 'CANCELLED' AND NEW."handover_id" IS NULL
        WHEN OLD."custody_status" = 'IN_HANDOVER' AND NEW."custody_status" = 'DEPOSITED' THEN
            handover_status = 'RECEIVED' AND NEW."handover_id" = OLD."handover_id"
        WHEN OLD."custody_status" = 'DEPOSITED' AND NEW."custody_status" = 'SETTLED' THEN
            handover_status = 'RECONCILED' AND NEW."handover_id" = OLD."handover_id"
        WHEN OLD."custody_status" = 'HELD' AND NEW."custody_status" = 'REVERSED' THEN
            EXISTS (
                SELECT 1 FROM "app"."cash_receipt_reversal" v
                 WHERE v."receipt_id" = NEW."id" AND v.xmin = pg_current_xact_id()::xid
            )
        ELSE FALSE
    END;
    IF allowed IS NOT TRUE THEN
        RAISE EXCEPTION 'CASH_RECEIPT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_reversal_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."cash_receipt" r
         WHERE r."id" = NEW."receipt_id" AND r."obligation_id" = NEW."obligation_id"
           AND r."custody_status" = 'HELD' AND r."collector_subject" <> NEW."reversed_by_subject"
           AND NEW."reversed_at" >= r."collected_at"
    ) THEN
        RAISE EXCEPTION 'CASH_RECEIPT_REVERSAL_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_handover_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."status" <> 'PENDING' OR NEW."revision" <> 1 OR NEW."updated_at" <> NEW."created_at" THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Handover transitions: PENDING -> RECEIVED | CANCELLED, RECEIVED -> RECONCILED.
-- The declared facts never change; the received facts never change once set.
CREATE FUNCTION "app"."billing_guard_handover_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."holder_subject" <> OLD."holder_subject"
       OR NEW."currency" <> OLD."currency" OR NEW."declared_minor" <> OLD."declared_minor"
       OR NEW."receipt_count" <> OLD."receipt_count" OR NEW."created_at" <> OLD."created_at"
       OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF OLD."status" = 'RECEIVED' AND (
        NEW."counted_minor" IS DISTINCT FROM OLD."counted_minor"
        OR NEW."shortage_minor" IS DISTINCT FROM OLD."shortage_minor"
        OR NEW."overage_minor" IS DISTINCT FROM OLD."overage_minor"
        OR NEW."treasury_reference" IS DISTINCT FROM OLD."treasury_reference"
        OR NEW."received_by_subject" IS DISTINCT FROM OLD."received_by_subject"
        OR NEW."received_at" IS DISTINCT FROM OLD."received_at") THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (
        (OLD."status" = 'PENDING' AND NEW."status" IN ('RECEIVED', 'CANCELLED'))
        OR (OLD."status" = 'RECEIVED' AND NEW."status" = 'RECONCILED')
    ) OR NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Items are written once, by the transaction that created their PENDING
-- handover, and copy the receipt's exact amount for the holder's own receipt.
CREATE FUNCTION "app"."billing_guard_handover_item_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."custody_handover" h
          JOIN "app"."cash_receipt" r ON r."id" = NEW."receipt_id"
         WHERE h."id" = NEW."handover_id" AND h."status" = 'PENDING'
           AND h.xmin = pg_current_xact_id()::xid
           AND r."collector_subject" = h."holder_subject"
           AND r."currency" = h."currency" AND NEW."currency" = h."currency"
           AND r."amount_minor" = NEW."amount_minor"
    ) THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_ITEM_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- At COMMIT, per holder and currency: the holder's CASH_IN_CUSTODY ledger
-- balance equals the receipts they still hold (HELD or IN_HANDOVER).
CREATE FUNCTION "app"."billing_assert_custody_holder"(holder UUID, money_currency CHAR(3)) RETURNS void
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    ledger_balance NUMERIC;
    held NUMERIC;
BEGIN
    SELECT COALESCE(SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END), 0)
      INTO ledger_balance
      FROM "app"."ledger_line" l
     WHERE l."account" = 'CASH_IN_CUSTODY' AND l."holder_subject" = holder
       AND l."currency" = money_currency;
    SELECT COALESCE(SUM(r."amount_minor"::NUMERIC), 0)
      INTO held
      FROM "app"."cash_receipt" r
     WHERE r."collector_subject" = holder AND r."currency" = money_currency
       AND r."custody_status" IN ('HELD', 'IN_HANDOVER');
    IF ledger_balance <> held THEN
        RAISE EXCEPTION 'CUSTODY_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
END;
$$;

CREATE FUNCTION "app"."billing_check_custody_holder"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM "app"."billing_assert_custody_holder"(NEW."collector_subject", NEW."currency");
    RETURN NULL;
END;
$$;

-- At COMMIT, per handover: items add up to the declared total, every item's
-- receipt is in the custody status the handover status implies, and the
-- handover's journals carry exactly the expected net per account.
CREATE FUNCTION "app"."billing_assert_handover"(target UUID) RETURNS void
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    h RECORD;
    item_count INTEGER;
    item_total NUMERIC;
    linked INTEGER;
    expected_status VARCHAR(12);
    received BOOLEAN;
    net_unreconciled NUMERIC;
    net_treasury NUMERIC;
    net_custody NUMERIC;
    net_shortage NUMERIC;
    net_overage NUMERIC;
    foreign_holder INTEGER;
BEGIN
    SELECT * INTO h FROM "app"."custody_handover" x WHERE x."id" = target;
    SELECT COUNT(*), COALESCE(SUM(i."amount_minor"::NUMERIC), 0)
      INTO item_count, item_total
      FROM "app"."custody_handover_item" i WHERE i."handover_id" = h."id";
    IF item_count <> h."receipt_count" OR item_total <> h."declared_minor"::NUMERIC THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_ITEMS_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    expected_status := CASE h."status" WHEN 'PENDING' THEN 'IN_HANDOVER' WHEN 'RECEIVED' THEN 'DEPOSITED'
                                       WHEN 'RECONCILED' THEN 'SETTLED' ELSE NULL END;
    IF expected_status IS NULL THEN
        SELECT COUNT(*) INTO linked
          FROM "app"."custody_handover_item" i JOIN "app"."cash_receipt" r ON r."id" = i."receipt_id"
         WHERE i."handover_id" = h."id" AND r."handover_id" = h."id";
        IF linked <> 0 THEN
            RAISE EXCEPTION 'CUSTODY_HANDOVER_RECEIPTS_MISMATCH' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        SELECT COUNT(*) INTO linked
          FROM "app"."custody_handover_item" i JOIN "app"."cash_receipt" r ON r."id" = i."receipt_id"
         WHERE i."handover_id" = h."id" AND r."handover_id" = h."id"
           AND r."custody_status" = expected_status;
        IF linked <> h."receipt_count" THEN
            RAISE EXCEPTION 'CUSTODY_HANDOVER_RECEIPTS_MISMATCH' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN l."account" = 'TREASURY_CASH_UNRECONCILED' THEN
            CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'TREASURY_CASH' THEN
            CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'CASH_IN_CUSTODY' THEN
            CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'CUSTODY_SHORTAGE_RECEIVABLE' THEN
            CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COALESCE(SUM(CASE WHEN l."account" = 'CUSTODY_OVERAGE_SUSPENSE' THEN
            CASE WHEN l."side" = 'CREDIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END END), 0),
        COUNT(*) FILTER (WHERE l."holder_subject" IS NOT NULL AND l."holder_subject" <> h."holder_subject")
      INTO net_unreconciled, net_treasury, net_custody, net_shortage, net_overage, foreign_holder
      FROM "app"."ledger_line" l JOIN "app"."ledger_journal" j ON j."id" = l."journal_id"
     WHERE j."handover_id" = h."id";

    received := h."status" IN ('RECEIVED', 'RECONCILED');
    IF foreign_holder <> 0
       OR net_custody <> (CASE WHEN received THEN -h."declared_minor"::NUMERIC ELSE 0 END)
       OR net_shortage <> (CASE WHEN received THEN h."shortage_minor"::NUMERIC ELSE 0 END)
       OR net_overage <> (CASE WHEN received THEN h."overage_minor"::NUMERIC ELSE 0 END)
       OR net_unreconciled <> (CASE WHEN h."status" = 'RECEIVED' THEN h."counted_minor"::NUMERIC ELSE 0 END)
       OR net_treasury <> (CASE WHEN h."status" = 'RECONCILED' THEN h."counted_minor"::NUMERIC ELSE 0 END) THEN
        RAISE EXCEPTION 'CUSTODY_HANDOVER_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
END;
$$;

CREATE FUNCTION "app"."billing_check_handover"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM "app"."billing_assert_handover"(NEW."id");
    RETURN NULL;
END;
$$;

-- At COMMIT, every journal is checked against the facts it moves, so a stray
-- journal (one without its state change) can never commit either: its
-- obligation's ledger agreement, its handover's consistency and the custody
-- balance of every holder it touches.
CREATE FUNCTION "app"."billing_check_journal_effects"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    touched RECORD;
BEGIN
    IF NEW."obligation_id" IS NOT NULL THEN
        PERFORM "app"."billing_assert_obligation_ledger"(NEW."obligation_id");
    END IF;
    IF NEW."handover_id" IS NOT NULL THEN
        PERFORM "app"."billing_assert_handover"(NEW."handover_id");
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

CREATE TRIGGER "cash_receipt_guard_insert" BEFORE INSERT ON "app"."cash_receipt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_receipt_insert"();
CREATE TRIGGER "cash_receipt_guard_update" BEFORE UPDATE ON "app"."cash_receipt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_receipt_update"();
CREATE TRIGGER "cash_receipt_reversal_guard_insert" BEFORE INSERT ON "app"."cash_receipt_reversal" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_reversal_insert"();
CREATE TRIGGER "custody_handover_guard_insert" BEFORE INSERT ON "app"."custody_handover" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_handover_insert"();
CREATE TRIGGER "custody_handover_guard_update" BEFORE UPDATE ON "app"."custody_handover" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_handover_update"();
CREATE TRIGGER "custody_handover_item_guard_insert" BEFORE INSERT ON "app"."custody_handover_item" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_handover_item_insert"();
CREATE CONSTRAINT TRIGGER "cash_receipt_custody_ledger" AFTER INSERT OR UPDATE ON "app"."cash_receipt"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_custody_holder"();
CREATE CONSTRAINT TRIGGER "ledger_journal_effects" AFTER INSERT ON "app"."ledger_journal"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_journal_effects"();
CREATE CONSTRAINT TRIGGER "custody_handover_consistency" AFTER INSERT OR UPDATE ON "app"."custody_handover"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_handover"();

-- Financial facts are never deleted; reversals and items never change.
CREATE TRIGGER "cash_receipt_no_delete" BEFORE DELETE ON "app"."cash_receipt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "cash_receipt_reversal_immutable" BEFORE UPDATE OR DELETE ON "app"."cash_receipt_reversal" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "custody_handover_no_delete" BEFORE DELETE ON "app"."custody_handover" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "custody_handover_item_immutable" BEFORE UPDATE OR DELETE ON "app"."custody_handover_item" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "cash_receipt_no_truncate" BEFORE TRUNCATE ON "app"."cash_receipt" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "cash_receipt_reversal_no_truncate" BEFORE TRUNCATE ON "app"."cash_receipt_reversal" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "custody_handover_no_truncate" BEFORE TRUNCATE ON "app"."custody_handover" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "custody_handover_item_no_truncate" BEFORE TRUNCATE ON "app"."custody_handover_item" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();

REVOKE ALL ON FUNCTION "app"."billing_guard_receipt_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_receipt_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_reversal_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_handover_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_handover_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_handover_item_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_custody_holder"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_handover"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_journal_effects"() FROM PUBLIC;
-- The three billing_assert_* helpers keep PostgreSQL's default EXECUTE privilege: they are
-- called (PERFORM) by the trigger functions as the invoking runtime role, are
-- SECURITY INVOKER, read only Billing tables under the caller's own privileges,
-- write nothing and can only raise. Only this service's roles can connect here.
