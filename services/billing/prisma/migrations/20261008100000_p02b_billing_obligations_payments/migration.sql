-- P02-B1: financial obligations, payment intents, payment attempts,
-- reconciliation, append-only double-entry ledger, idempotency, audit, outbox.
-- Applied by the migration identity (cw_billing_migrate) as a separate job.
-- Application replicas never run this file. Additive only (expand phase): no
-- existing object is altered or dropped.
-- Rollback before any row is written: drop the new tables and functions in
-- reverse order. Rollback after rows exist requires a reviewed financial data
-- plan and restore evidence; never drop silently.
-- Money is BIGINT minor units with an explicit currency; there is no
-- floating-point amount column. Supported currencies mirror the published
-- @carwash/contracts CURRENCIES (SYP 2, USD 2).

-- Obligations ---------------------------------------------------------------
CREATE TABLE "app"."billing_obligation" (
    "id" UUID NOT NULL,
    "owner_kind" VARCHAR(8) NOT NULL,
    "owner_subject" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "verified_minor" BIGINT NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "billing_obligation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_obligation_owner_kind" CHECK ("owner_kind" IN ('account', 'guest')),
    CONSTRAINT "billing_obligation_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "billing_obligation_amount" CHECK ("amount_minor" > 0 AND "amount_minor" < 1000000000000000000),
    CONSTRAINT "billing_obligation_verified" CHECK ("verified_minor" >= 0 AND "verified_minor" <= "amount_minor"),
    CONSTRAINT "billing_obligation_status" CHECK ("status" IN ('OPEN', 'SETTLED', 'VOIDED')),
    CONSTRAINT "billing_obligation_settled_iff_paid" CHECK (("status" = 'SETTLED') = ("verified_minor" = "amount_minor")),
    CONSTRAINT "billing_obligation_voided_unpaid" CHECK ("status" <> 'VOIDED' OR "verified_minor" = 0),
    CONSTRAINT "billing_obligation_revision" CHECK ("revision" >= 1),
    CONSTRAINT "billing_obligation_times" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "billing_obligation_quote_id_key" ON "app"."billing_obligation"("quote_id");
CREATE INDEX "billing_obligation_owner_idx" ON "app"."billing_obligation"("owner_kind", "owner_subject", "created_at");

-- Payment intents -----------------------------------------------------------
-- active_slot is 1 for the single active intent of an obligation and NULL for
-- closed ones; the unique (obligation_id, active_slot) index therefore allows
-- exactly one active intent while keeping full history.
CREATE TABLE "app"."payment_intent" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "method" VARCHAR(24) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "active_slot" SMALLINT,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "payment_intent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_intent_method" CHECK ("method" IN ('CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH')),
    CONSTRAINT "payment_intent_status" CHECK ("status" IN ('AWAITING_CASH_COLLECTION', 'AWAITING_CUSTOMER_PAYMENT', 'UNDER_REVIEW', 'SUCCEEDED', 'SUPERSEDED', 'CANCELLED')),
    CONSTRAINT "payment_intent_active_slot" CHECK (
        ("status" IN ('AWAITING_CASH_COLLECTION', 'AWAITING_CUSTOMER_PAYMENT', 'UNDER_REVIEW') AND "active_slot" = 1)
        OR ("status" IN ('SUCCEEDED', 'SUPERSEDED', 'CANCELLED') AND "active_slot" IS NULL)
    ),
    -- Cash is collected after the wash (a later custody flow); it never passes
    -- through the electronic review states and is never SUCCEEDED here.
    CONSTRAINT "payment_intent_method_status" CHECK (
        ("method" = 'CASH_ON_COMPLETION' AND "status" IN ('AWAITING_CASH_COLLECTION', 'SUPERSEDED', 'CANCELLED'))
        OR ("method" <> 'CASH_ON_COMPLETION' AND "status" <> 'AWAITING_CASH_COLLECTION')
    ),
    CONSTRAINT "payment_intent_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "payment_intent_amount" CHECK ("amount_minor" > 0),
    CONSTRAINT "payment_intent_times" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "payment_intent_obligation_id_active_slot_key" ON "app"."payment_intent"("obligation_id", "active_slot");
ALTER TABLE "app"."payment_intent" ADD CONSTRAINT "payment_intent_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Payment attempts ----------------------------------------------------------
-- (method, provider_reference) is globally unique: one provider transaction can
-- be claimed by exactly one attempt, ever.
CREATE TABLE "app"."payment_attempt" (
    "id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "method" VARCHAR(24) NOT NULL,
    "provider_reference" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "claimed_minor" BIGINT NOT NULL,
    "observed_minor" BIGINT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "reconciled_at" TIMESTAMPTZ(3),
    "reconciled_by_kind" VARCHAR(8),
    "reconciled_by_subject" UUID,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_attempt_method" CHECK ("method" IN ('SHAM_CASH', 'SYRIATEL_CASH')),
    CONSTRAINT "payment_attempt_reference" CHECK ("provider_reference" ~ '^[A-Z0-9]{4,64}$'),
    CONSTRAINT "payment_attempt_status" CHECK ("status" IN ('PENDING_REVIEW', 'MATCHED', 'MISMATCHED', 'UNKNOWN')),
    CONSTRAINT "payment_attempt_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "payment_attempt_amounts" CHECK ("claimed_minor" > 0 AND ("observed_minor" IS NULL OR "observed_minor" >= 0)),
    CONSTRAINT "payment_attempt_reviewer_kind" CHECK ("reconciled_by_kind" IS NULL OR "reconciled_by_kind" IN ('account', 'guest')),
    CONSTRAINT "payment_attempt_review_facts" CHECK (
        ("status" = 'PENDING_REVIEW' AND "reconciled_at" IS NULL AND "reconciled_by_kind" IS NULL
            AND "reconciled_by_subject" IS NULL AND "observed_minor" IS NULL)
        OR ("status" <> 'PENDING_REVIEW' AND "reconciled_at" IS NOT NULL AND "reconciled_by_kind" IS NOT NULL
            AND "reconciled_by_subject" IS NOT NULL AND "reconciled_at" >= "submitted_at")
    ),
    -- Money is recognised only for an exact match of the requested amount.
    CONSTRAINT "payment_attempt_matched_exact" CHECK ("status" <> 'MATCHED' OR "observed_minor" = "claimed_minor"),
    CONSTRAINT "payment_attempt_unknown_unobserved" CHECK ("status" <> 'UNKNOWN' OR "observed_minor" IS NULL)
);
CREATE UNIQUE INDEX "payment_attempt_method_provider_reference_key" ON "app"."payment_attempt"("method", "provider_reference");
CREATE INDEX "payment_attempt_obligation_id_idx" ON "app"."payment_attempt"("obligation_id");
CREATE INDEX "payment_attempt_status_submitted_idx" ON "app"."payment_attempt"("status", "submitted_at");
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_intent_id_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "app"."payment_intent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Ledger --------------------------------------------------------------------
CREATE TABLE "app"."ledger_journal" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "business_ref" VARCHAR(96) NOT NULL,
    "obligation_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "ledger_journal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_journal_kind" CHECK ("kind" IN ('OBLIGATION_BILLED', 'OBLIGATION_VOIDED', 'PAYMENT_MATCHED')),
    CONSTRAINT "ledger_journal_business_ref" CHECK ("business_ref" ~ '^[a-z]+:[0-9a-f-]{36}:[a-z]+$')
);
CREATE UNIQUE INDEX "ledger_journal_business_ref_key" ON "app"."ledger_journal"("business_ref");
CREATE INDEX "ledger_journal_obligation_id_idx" ON "app"."ledger_journal"("obligation_id");
ALTER TABLE "app"."ledger_journal" ADD CONSTRAINT "ledger_journal_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "app"."ledger_line" (
    "journal_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "account" VARCHAR(32) NOT NULL,
    "side" VARCHAR(6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    CONSTRAINT "ledger_line_pkey" PRIMARY KEY ("journal_id","line_no"),
    CONSTRAINT "ledger_line_no" CHECK ("line_no" >= 0),
    CONSTRAINT "ledger_line_account" CHECK ("account" IN ('CUSTOMER_RECEIVABLE', 'BILLED_OBLIGATIONS_CONTROL', 'CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH')),
    CONSTRAINT "ledger_line_side" CHECK ("side" IN ('DEBIT', 'CREDIT')),
    CONSTRAINT "ledger_line_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "ledger_line_amount" CHECK ("amount_minor" > 0)
);
ALTER TABLE "app"."ledger_line" ADD CONSTRAINT "ledger_line_journal_id_fkey"
    FOREIGN KEY ("journal_id") REFERENCES "app"."ledger_journal"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Idempotency, audit and outbox ---------------------------------------------
CREATE TABLE "app"."billing_idempotency_receipt" (
    "actor_kind" VARCHAR(8) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "billing_idempotency_receipt_pkey" PRIMARY KEY ("actor_kind","actor_subject","operation","idempotency_key"),
    CONSTRAINT "billing_idempotency_receipt_actor_kind" CHECK ("actor_kind" IN ('account', 'guest')),
    CONSTRAINT "billing_idempotency_receipt_key_format" CHECK ("idempotency_key" ~ '^[A-Za-z0-9_-]{16,128}$'),
    CONSTRAINT "billing_idempotency_receipt_fingerprint_hex" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "billing_idempotency_receipt_success_only" CHECK ("response_status" BETWEEN 200 AND 299),
    CONSTRAINT "billing_idempotency_receipt_body_object" CHECK (jsonb_typeof("response_body") = 'object')
);

CREATE TABLE "app"."billing_audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_kind" VARCHAR(8) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "obligation_id" UUID NOT NULL,
    "attempt_id" UUID,
    "outcome" VARCHAR(32) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "billing_audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_audit_event_actor_kind" CHECK ("actor_kind" IN ('account', 'guest')),
    CONSTRAINT "billing_audit_event_action" CHECK ("action" IN ('billing.obligation.created', 'billing.obligation.voided', 'billing.intent.initialized', 'billing.attempt.submitted', 'billing.attempt.reconciled')),
    CONSTRAINT "billing_audit_event_outcome" CHECK ("outcome" ~ '^[A-Z_]{2,32}$')
);
CREATE INDEX "billing_audit_event_obligation_idx" ON "app"."billing_audit_event"("obligation_id", "occurred_at");
ALTER TABLE "app"."billing_audit_event" ADD CONSTRAINT "billing_audit_event_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "app"."billing_obligation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Same layout as the platform-messaging relay expects. The relay is NOT started
-- until Lane E registers the billing event contracts and broker topology.
CREATE TABLE "app"."outbox_message" (
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
    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_message_event_type" CHECK ("event_type" IN ('billing.obligation-created.v1', 'billing.obligation-status-changed.v1')),
    CONSTRAINT "outbox_message_attempts" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "app"."outbox_message"("event_id");
CREATE INDEX "outbox_message_pending_idx" ON "app"."outbox_message"("published_at", "dead_at", "created_at");

-- Database-enforced invariants ----------------------------------------------
CREATE FUNCTION "app"."billing_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'BILLING_APPEND_ONLY: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- Ledger lines may only be written by the transaction that created their journal.
CREATE FUNCTION "app"."billing_require_open_journal"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."ledger_journal" j
         WHERE j."id" = NEW."journal_id" AND j.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'LEDGER_JOURNAL_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- At COMMIT every journal has at least two lines, balances per currency and
-- uses only its obligation's currency. An unbalanced journal never commits.
CREATE FUNCTION "app"."billing_check_journal_balanced"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    line_count INTEGER;
    unbalanced INTEGER;
    foreign_currency INTEGER;
BEGIN
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
      JOIN "app"."billing_obligation" o ON o."id" = NEW."obligation_id"
     WHERE l."journal_id" = NEW."id" AND l."currency" <> o."currency";
    IF line_count < 2 OR unbalanced <> 0 OR foreign_currency <> 0 THEN
        RAISE EXCEPTION 'LEDGER_JOURNAL_UNBALANCED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

-- Obligation state machine: identity, owner, quote and amount are immutable;
-- each write bumps the revision by exactly one; verified never decreases;
-- SETTLED and VOIDED are terminal.
CREATE FUNCTION "app"."billing_guard_obligation_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."owner_kind" <> OLD."owner_kind"
       OR NEW."owner_subject" <> OLD."owner_subject" OR NEW."quote_id" <> OLD."quote_id"
       OR NEW."currency" <> OLD."currency" OR NEW."amount_minor" <> OLD."amount_minor"
       OR NEW."created_at" <> OLD."created_at" OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'BILLING_OBLIGATION_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF OLD."status" <> 'OPEN' THEN
        RAISE EXCEPTION 'BILLING_OBLIGATION_TERMINAL' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."verified_minor" < OLD."verified_minor"
       OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'BILLING_OBLIGATION_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_intent_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."billing_obligation" o
         WHERE o."id" = NEW."obligation_id" AND o."status" = 'OPEN'
           AND o."currency" = NEW."currency"
           AND o."amount_minor" - o."verified_minor" = NEW."amount_minor"
    ) OR NEW."status" NOT IN ('AWAITING_CASH_COLLECTION', 'AWAITING_CUSTOMER_PAYMENT') THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_intent_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."obligation_id" <> OLD."obligation_id"
       OR NEW."method" <> OLD."method" OR NEW."currency" <> OLD."currency"
       OR NEW."amount_minor" <> OLD."amount_minor" OR NEW."created_at" <> OLD."created_at"
       OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (
        (OLD."status" = 'AWAITING_CASH_COLLECTION' AND NEW."status" IN ('SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'AWAITING_CUSTOMER_PAYMENT' AND NEW."status" IN ('UNDER_REVIEW', 'SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('AWAITING_CUSTOMER_PAYMENT', 'SUCCEEDED'))
    ) OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_attempt_insert"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."status" <> 'PENDING_REVIEW' OR NOT EXISTS (
        SELECT 1 FROM "app"."payment_intent" i
         WHERE i."id" = NEW."intent_id" AND i."obligation_id" = NEW."obligation_id"
           AND i."method" = NEW."method" AND i."currency" = NEW."currency"
           AND i."amount_minor" = NEW."claimed_minor" AND i."status" = 'AWAITING_CUSTOMER_PAYMENT'
    ) THEN
        RAISE EXCEPTION 'PAYMENT_ATTEMPT_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."billing_guard_attempt_update"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."id" <> OLD."id" OR NEW."intent_id" <> OLD."intent_id"
       OR NEW."obligation_id" <> OLD."obligation_id" OR NEW."method" <> OLD."method"
       OR NEW."provider_reference" <> OLD."provider_reference" OR NEW."currency" <> OLD."currency"
       OR NEW."claimed_minor" <> OLD."claimed_minor" OR NEW."submitted_at" <> OLD."submitted_at"
       OR NEW."correlation_id" <> OLD."correlation_id" THEN
        RAISE EXCEPTION 'PAYMENT_ATTEMPT_IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (
        (OLD."status" = 'PENDING_REVIEW' AND NEW."status" IN ('MATCHED', 'MISMATCHED', 'UNKNOWN'))
        OR (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('MATCHED', 'MISMATCHED'))
    ) THEN
        RAISE EXCEPTION 'PAYMENT_ATTEMPT_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- At COMMIT the ledger agrees with every obligation it touched:
--   receivable balance = amount - verified (0 once VOIDED), and
--   verified = the sum of matched receipts booked to clearing accounts.
-- A state change without its journal (or a journal without its state change)
-- can never become visible.
CREATE FUNCTION "app"."billing_check_obligation_ledger"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    current_row RECORD;
    receivable NUMERIC;
    cleared NUMERIC;
    expected_receivable NUMERIC;
BEGIN
    SELECT * INTO current_row FROM "app"."billing_obligation" o WHERE o."id" = NEW."id";
    -- Computed outside IF: PL/pgSQL ends an IF condition at the first THEN.
    expected_receivable := CASE WHEN current_row."status" = 'VOIDED' THEN 0
                                ELSE current_row."amount_minor"::NUMERIC - current_row."verified_minor"::NUMERIC END;
    SELECT COALESCE(SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END), 0)
      INTO receivable
      FROM "app"."ledger_line" l JOIN "app"."ledger_journal" j ON j."id" = l."journal_id"
     WHERE j."obligation_id" = NEW."id" AND l."account" = 'CUSTOMER_RECEIVABLE';
    SELECT COALESCE(SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amount_minor"::NUMERIC ELSE -l."amount_minor"::NUMERIC END), 0)
      INTO cleared
      FROM "app"."ledger_line" l JOIN "app"."ledger_journal" j ON j."id" = l."journal_id"
     WHERE j."obligation_id" = NEW."id" AND l."account" IN ('CLEARING_SHAM_CASH', 'CLEARING_SYRIATEL_CASH');
    IF receivable <> expected_receivable OR cleared <> current_row."verified_minor"::NUMERIC THEN
        RAISE EXCEPTION 'BILLING_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "ledger_line_open_journal" BEFORE INSERT ON "app"."ledger_line" FOR EACH ROW EXECUTE FUNCTION "app"."billing_require_open_journal"();
CREATE CONSTRAINT TRIGGER "ledger_journal_balanced" AFTER INSERT ON "app"."ledger_journal"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_journal_balanced"();
CREATE CONSTRAINT TRIGGER "billing_obligation_ledger" AFTER INSERT OR UPDATE ON "app"."billing_obligation"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."billing_check_obligation_ledger"();
CREATE TRIGGER "billing_obligation_guard" BEFORE UPDATE ON "app"."billing_obligation" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_obligation_update"();
CREATE TRIGGER "payment_intent_guard_insert" BEFORE INSERT ON "app"."payment_intent" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_intent_insert"();
CREATE TRIGGER "payment_intent_guard_update" BEFORE UPDATE ON "app"."payment_intent" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_intent_update"();
CREATE TRIGGER "payment_attempt_guard_insert" BEFORE INSERT ON "app"."payment_attempt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_attempt_insert"();
CREATE TRIGGER "payment_attempt_guard_update" BEFORE UPDATE ON "app"."payment_attempt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_guard_attempt_update"();

-- Financial facts are never deleted; journals, receipts and audit never change.
CREATE TRIGGER "billing_obligation_no_delete" BEFORE DELETE ON "app"."billing_obligation" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "payment_intent_no_delete" BEFORE DELETE ON "app"."payment_intent" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "payment_attempt_no_delete" BEFORE DELETE ON "app"."payment_attempt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "ledger_journal_immutable" BEFORE UPDATE OR DELETE ON "app"."ledger_journal" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "ledger_line_immutable" BEFORE UPDATE OR DELETE ON "app"."ledger_line" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "billing_idempotency_receipt_immutable" BEFORE UPDATE OR DELETE ON "app"."billing_idempotency_receipt" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "billing_audit_event_immutable" BEFORE UPDATE OR DELETE ON "app"."billing_audit_event" FOR EACH ROW EXECUTE FUNCTION "app"."billing_reject_mutation"();
-- TRUNCATE bypasses row triggers; statement-level triggers close that path too.
CREATE TRIGGER "billing_obligation_no_truncate" BEFORE TRUNCATE ON "app"."billing_obligation" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "ledger_journal_no_truncate" BEFORE TRUNCATE ON "app"."ledger_journal" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();
CREATE TRIGGER "ledger_line_no_truncate" BEFORE TRUNCATE ON "app"."ledger_line" FOR EACH STATEMENT EXECUTE FUNCTION "app"."billing_reject_mutation"();

-- Functions are created with EXECUTE granted to PUBLIC by default. Trigger
-- functions need no caller privilege, so no role (including foreign service
-- roles) may call them directly.
REVOKE ALL ON FUNCTION "app"."billing_reject_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_require_open_journal"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_journal_balanced"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_obligation_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_intent_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_intent_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_attempt_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_guard_attempt_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."billing_check_obligation_ledger"() FROM PUBLIC;