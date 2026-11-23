-- P05-B3 Wallet: technician-custody READ PROJECTION of registered Billing events
-- (owner decision B-08). Not a second ledger: every movement cites the Billing
-- event it mirrors. Applied by cw_wallet_migrate only; expand-only on W01.

-- Idempotent inbox: one row per consumed Billing event id ----------------------
CREATE TABLE "app"."wallet_inbox" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT,
    "aggregate_id" UUID,
    "aggregate_version" INTEGER,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "correlation_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_inbox_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "wallet_inbox_outcome" CHECK ("outcome" IN ('APPLIED', 'STALE', 'REJECTED')),
    CONSTRAINT "wallet_inbox_reason" CHECK (("outcome" = 'APPLIED') = ("reason" IS NULL)),
    CONSTRAINT "wallet_inbox_event_type" CHECK (char_length("event_type") BETWEEN 1 AND 120),
    CONSTRAINT "wallet_inbox_applied_source" CHECK (
        "outcome" <> 'APPLIED' OR ("aggregate_type" IN ('billing-cash-receipt', 'billing-custody-handover')
            AND "aggregate_id" IS NOT NULL AND "aggregate_version" >= 1))
);
CREATE INDEX "wallet_inbox_received_idx" ON "app"."wallet_inbox"("received_at");

-- Projected state of each Billing receipt / handover aggregate ----------------
CREATE TABLE "app"."custody_source" (
    "kind" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "last_version" INTEGER NOT NULL,
    "holder_subject" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "counted_minor" BIGINT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "custody_source_pkey" PRIMARY KEY ("kind", "aggregate_id"),
    CONSTRAINT "custody_source_kind" CHECK ("kind" IN ('RECEIPT', 'HANDOVER')),
    CONSTRAINT "custody_source_version" CHECK ("last_version" >= 1),
    CONSTRAINT "custody_source_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "custody_source_status" CHECK (
        ("kind" = 'RECEIPT' AND "status" IN ('HELD', 'REVERSED'))
        OR ("kind" = 'HANDOVER' AND "status" IN ('PENDING', 'RECEIVED', 'RECONCILED', 'CANCELLED'))),
    CONSTRAINT "custody_source_amounts" CHECK (
        "amount_minor" > 0 AND ("counted_minor" IS NULL OR "counted_minor" >= 0))
);

-- Custody account per (holder, currency) --------------------------------------
CREATE TABLE "app"."custody_account" (
    "holder_subject" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "held_minor" BIGINT NOT NULL,
    "in_handover_minor" BIGINT NOT NULL,
    "deposited_minor" BIGINT NOT NULL,
    "settled_minor" BIGINT NOT NULL,
    "shortage_minor" BIGINT NOT NULL,
    "overage_minor" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "custody_account_pkey" PRIMARY KEY ("holder_subject", "currency"),
    CONSTRAINT "custody_account_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "custody_account_non_negative" CHECK (
        "held_minor" >= 0 AND "in_handover_minor" >= 0 AND "deposited_minor" >= 0
        AND "settled_minor" >= 0 AND "shortage_minor" >= 0 AND "overage_minor" >= 0),
    CONSTRAINT "custody_account_version" CHECK ("version" >= 0)
);

-- Append-only projection movements, one per applied Billing event -------------
CREATE TABLE "app"."custody_movement" (
    "id" UUID NOT NULL,
    "holder_subject" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "held_delta" BIGINT NOT NULL,
    "in_handover_delta" BIGINT NOT NULL,
    "deposited_delta" BIGINT NOT NULL,
    "settled_delta" BIGINT NOT NULL,
    "shortage_delta" BIGINT NOT NULL,
    "overage_delta" BIGINT NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "custody_movement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custody_movement_account_fkey" FOREIGN KEY ("holder_subject", "currency")
        REFERENCES "app"."custody_account"("holder_subject", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "custody_movement_event_fkey" FOREIGN KEY ("event_id")
        REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "custody_movement_source_fkey" FOREIGN KEY ("source_kind", "source_id")
        REFERENCES "app"."custody_source"("kind", "aggregate_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "custody_movement_kind" CHECK (
        ("kind" = 'CASH_COLLECTED' AND "source_kind" = 'RECEIPT' AND "event_type" = 'billing.cash-collected.v1'
            AND "held_delta" > 0 AND "in_handover_delta" = 0 AND "deposited_delta" = 0 AND "settled_delta" = 0
            AND "shortage_delta" = 0 AND "overage_delta" = 0)
        OR ("kind" = 'CASH_COLLECTION_REVERSED' AND "source_kind" = 'RECEIPT' AND "event_type" = 'billing.cash-collection-reversed.v1'
            AND "held_delta" < 0 AND "in_handover_delta" = 0 AND "deposited_delta" = 0 AND "settled_delta" = 0
            AND "shortage_delta" = 0 AND "overage_delta" = 0)
        OR ("kind" = 'HANDOVER_DECLARED' AND "source_kind" = 'HANDOVER' AND "event_type" = 'billing.custody-handover-changed.v1'
            AND "held_delta" < 0 AND "in_handover_delta" = -"held_delta" AND "deposited_delta" = 0
            AND "settled_delta" = 0 AND "shortage_delta" = 0 AND "overage_delta" = 0)
        OR ("kind" = 'HANDOVER_CANCELLED' AND "source_kind" = 'HANDOVER' AND "event_type" = 'billing.custody-handover-changed.v1'
            AND "in_handover_delta" < 0 AND "held_delta" = -"in_handover_delta" AND "deposited_delta" = 0
            AND "settled_delta" = 0 AND "shortage_delta" = 0 AND "overage_delta" = 0)
        OR ("kind" = 'HANDOVER_RECEIVED' AND "source_kind" = 'HANDOVER' AND "event_type" = 'billing.custody-handover-changed.v1'
            AND "held_delta" = 0 AND "in_handover_delta" < 0 AND "deposited_delta" >= 0 AND "settled_delta" = 0
            AND "shortage_delta" >= 0 AND "overage_delta" >= 0
            AND "deposited_delta" + "shortage_delta" - "overage_delta" = -"in_handover_delta")
        OR ("kind" = 'HANDOVER_RECONCILED' AND "source_kind" = 'HANDOVER' AND "event_type" = 'billing.custody-handover-changed.v1'
            AND "held_delta" = 0 AND "in_handover_delta" = 0 AND "deposited_delta" <= 0
            AND "settled_delta" = -"deposited_delta" AND "shortage_delta" = 0 AND "overage_delta" = 0)),
    CONSTRAINT "custody_movement_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "custody_movement_source_version" CHECK ("source_version" >= 1)
);
-- One movement per Billing event at most.
CREATE UNIQUE INDEX "custody_movement_event_key" ON "app"."custody_movement"("event_id");
CREATE INDEX "custody_movement_holder_idx" ON "app"."custody_movement"("holder_subject", "recorded_at");

-- Database-enforced invariants ----------------------------------------------
-- No function is revoked from PUBLIC: trigger functions run as the invoking
-- runtime role, so revoking EXECUTE would break every write.
CREATE FUNCTION "app"."wallet_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'WALLET_APPEND_ONLY: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "wallet_inbox_immutable" BEFORE UPDATE OR DELETE ON "app"."wallet_inbox"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "custody_movement_immutable" BEFORE UPDATE OR DELETE ON "app"."custody_movement"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "custody_account_no_delete" BEFORE DELETE ON "app"."custody_account"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "custody_source_no_delete" BEFORE DELETE ON "app"."custody_source"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_inbox_no_truncate" BEFORE TRUNCATE ON "app"."wallet_inbox"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "custody_movement_no_truncate" BEFORE TRUNCATE ON "app"."custody_movement"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "custody_account_no_truncate" BEFORE TRUNCATE ON "app"."custody_account"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "custody_source_no_truncate" BEFORE TRUNCATE ON "app"."custody_source"
    FOR EACH STATEMENT EXECUTE FUNCTION "app"."wallet_reject_mutation"();

-- A movement mirrors an APPLIED inbox row of the same event written by the same
-- transaction, and its source row was written by that transaction too.
CREATE FUNCTION "app"."wallet_guard_movement"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."wallet_inbox" i
         WHERE i."event_id" = NEW."event_id" AND i."outcome" = 'APPLIED' AND i."event_type" = NEW."event_type"
           AND i."aggregate_id" = NEW."source_id" AND i."aggregate_version" = NEW."source_version"
           AND i.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'MOVEMENT_WITHOUT_APPLIED_EVENT' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "app"."custody_source" s
         WHERE s."kind" = NEW."source_kind" AND s."aggregate_id" = NEW."source_id"
           AND s."last_version" = NEW."source_version" AND s."holder_subject" = NEW."holder_subject"
           AND s."currency" = NEW."currency" AND s.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'MOVEMENT_SOURCE_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "custody_movement_guard" BEFORE INSERT ON "app"."custody_movement"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_guard_movement"();

-- Source identity never changes and its version only moves forward.
CREATE FUNCTION "app"."wallet_guard_source"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."kind" <> OLD."kind" OR NEW."aggregate_id" <> OLD."aggregate_id"
       OR NEW."holder_subject" <> OLD."holder_subject" OR NEW."currency" <> OLD."currency"
       OR NEW."amount_minor" <> OLD."amount_minor" THEN
        RAISE EXCEPTION 'SOURCE_IDENTITY_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."last_version" <= OLD."last_version" THEN
        RAISE EXCEPTION 'SOURCE_VERSION_NOT_NEWER' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "custody_source_guard" BEFORE UPDATE ON "app"."custody_source"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_guard_source"();

-- COMMIT-time: every account equals the sum of its movements (a pure projection).
CREATE FUNCTION "app"."wallet_check_account"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    stored RECORD;
    summed RECORD;
BEGIN
    SELECT * INTO stored FROM "app"."custody_account"
     WHERE "holder_subject" = NEW."holder_subject" AND "currency" = NEW."currency";
    SELECT COALESCE(sum("held_delta"), 0) AS held, COALESCE(sum("in_handover_delta"), 0) AS in_handover,
           COALESCE(sum("deposited_delta"), 0) AS deposited, COALESCE(sum("settled_delta"), 0) AS settled,
           COALESCE(sum("shortage_delta"), 0) AS shortage, COALESCE(sum("overage_delta"), 0) AS overage
      INTO summed FROM "app"."custody_movement"
     WHERE "holder_subject" = NEW."holder_subject" AND "currency" = NEW."currency";
    IF stored."held_minor" <> summed.held OR stored."in_handover_minor" <> summed.in_handover
       OR stored."deposited_minor" <> summed.deposited OR stored."settled_minor" <> summed.settled
       OR stored."shortage_minor" <> summed.shortage OR stored."overage_minor" <> summed.overage THEN
        RAISE EXCEPTION 'CUSTODY_PROJECTION_UNBALANCED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "custody_account_balanced" AFTER INSERT OR UPDATE ON "app"."custody_account"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."wallet_check_account"();
CREATE CONSTRAINT TRIGGER "custody_movement_balanced" AFTER INSERT ON "app"."custody_movement"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."wallet_check_account"();

-- No trigger body above calls another function, so none needs EXECUTE at run
-- time (firing a trigger never checks it). Revoking PUBLIC keeps every foreign
-- service role, and the runtime role, unable to call them directly.
REVOKE ALL ON FUNCTION "app"."wallet_reject_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."wallet_guard_movement"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."wallet_guard_source"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."wallet_check_account"() FROM PUBLIC;
