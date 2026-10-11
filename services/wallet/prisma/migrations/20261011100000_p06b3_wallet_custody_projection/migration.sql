-- P06-B3: technician cash-custody READ PROJECTION folded from the published
-- billing.v1 events (cash-collected, cash-collection-reversed,
-- custody-handover-changed). The Billing ledger stays the only financial
-- ledger: every row here references the Billing event or aggregate it came
-- from, and nothing here can create, move or settle money.
-- Expand-only: new tables, no change to existing objects.

-- Inbox ---------------------------------------------------------------------
-- One row per delivered event id, written in the same transaction as its effect.
CREATE TABLE "app"."wallet_inbox" (
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(96) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "outcome" VARCHAR(8) NOT NULL,
    "reason" VARCHAR(64),
    "aggregate_type" VARCHAR(48),
    "aggregate_id" UUID,
    "aggregate_version" INTEGER,
    "correlation_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_inbox_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "wallet_inbox_payload_hash" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "wallet_inbox_outcome" CHECK ("outcome" IN ('APPLIED', 'STALE', 'IGNORED', 'POISON')),
    CONSTRAINT "wallet_inbox_reason" CHECK (
        ("reason" IS NULL OR "reason" ~ '^[A-Z][A-Z0-9_]{2,63}$')
        AND (("outcome" IN ('IGNORED', 'POISON')) = ("reason" IS NOT NULL))
    ),
    CONSTRAINT "wallet_inbox_aggregate" CHECK (
        ("aggregate_type" IS NULL) = ("aggregate_id" IS NULL)
        AND ("aggregate_id" IS NULL) = ("aggregate_version" IS NULL)
        AND ("aggregate_version" IS NULL OR "aggregate_version" >= 1)
        AND ("outcome" NOT IN ('APPLIED', 'STALE') OR "aggregate_id" IS NOT NULL)
    )
);
CREATE INDEX "wallet_inbox_aggregate_idx" ON "app"."wallet_inbox"("aggregate_id", "aggregate_version");
CREATE INDEX "wallet_inbox_outcome_idx" ON "app"."wallet_inbox"("outcome", "received_at");

-- Same event id delivered with different bytes: an integrity fault kept for review.
CREATE TABLE "app"."wallet_inbox_conflict" (
    "id" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_inbox_conflict_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_inbox_conflict_payload_hash" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "wallet_inbox_conflict_event_id_idx" ON "app"."wallet_inbox_conflict"("event_id");
ALTER TABLE "app"."wallet_inbox_conflict" ADD CONSTRAINT "wallet_inbox_conflict_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Source state, one row per Billing aggregate ---------------------------------
-- A receipt known only by its reversal has no holder until its collection arrives.
CREATE TABLE "app"."wallet_custody_receipt" (
    "receipt_id" UUID NOT NULL,
    "holder_subject" UUID,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "collected_event_id" UUID,
    "reversed_event_id" UUID,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_custody_receipt_pkey" PRIMARY KEY ("receipt_id"),
    CONSTRAINT "wallet_custody_receipt_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "wallet_custody_receipt_amount" CHECK ("amount_minor" >= 0 AND "amount_minor" < 1000000000000000000),
    CONSTRAINT "wallet_custody_receipt_version" CHECK ("version" >= 1),
    CONSTRAINT "wallet_custody_receipt_facts" CHECK (
        ("collected_event_id" IS NOT NULL OR "reversed_event_id" IS NOT NULL)
        AND (("collected_event_id" IS NULL) = ("holder_subject" IS NULL))
        AND ("reversed_event_id" IS NULL OR "version" >= 2)
    )
);
CREATE INDEX "wallet_custody_receipt_holder_idx" ON "app"."wallet_custody_receipt"("holder_subject", "currency");
ALTER TABLE "app"."wallet_custody_receipt" ADD CONSTRAINT "wallet_custody_receipt_collected_event_id_fkey"
    FOREIGN KEY ("collected_event_id") REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."wallet_custody_receipt" ADD CONSTRAINT "wallet_custody_receipt_reversed_event_id_fkey"
    FOREIGN KEY ("reversed_event_id") REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Mirrors the producer's own handover shape rules for each status.
CREATE TABLE "app"."wallet_custody_handover" (
    "handover_id" UUID NOT NULL,
    "holder_subject" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "receipt_count" INTEGER NOT NULL,
    "declared_minor" BIGINT NOT NULL,
    "counted_minor" BIGINT,
    "shortage_minor" BIGINT,
    "overage_minor" BIGINT,
    "version" INTEGER NOT NULL,
    "last_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_custody_handover_pkey" PRIMARY KEY ("handover_id"),
    CONSTRAINT "wallet_custody_handover_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "wallet_custody_handover_status" CHECK ("status" IN ('PENDING', 'CANCELLED', 'RECEIVED', 'RECONCILED')),
    CONSTRAINT "wallet_custody_handover_receipt_count" CHECK ("receipt_count" BETWEEN 1 AND 200),
    CONSTRAINT "wallet_custody_handover_version" CHECK ("version" >= 1),
    CONSTRAINT "wallet_custody_handover_declared" CHECK ("declared_minor" >= 0 AND "declared_minor" < 1000000000000000000),
    CONSTRAINT "wallet_custody_handover_counted" CHECK (
        CASE WHEN "status" IN ('PENDING', 'CANCELLED')
             THEN "counted_minor" IS NULL AND "shortage_minor" IS NULL AND "overage_minor" IS NULL
             ELSE "counted_minor" IS NOT NULL AND "shortage_minor" IS NOT NULL AND "overage_minor" IS NOT NULL
                  AND "counted_minor" >= 0 AND "shortage_minor" >= 0 AND "overage_minor" >= 0
                  AND ("shortage_minor" = 0 OR "overage_minor" = 0)
                  AND "counted_minor" - "declared_minor" = "overage_minor" - "shortage_minor"
        END
    )
);
CREATE INDEX "wallet_custody_handover_holder_idx" ON "app"."wallet_custody_handover"("holder_subject", "currency", "status");
ALTER TABLE "app"."wallet_custody_handover" ADD CONSTRAINT "wallet_custody_handover_last_event_id_fkey"
    FOREIGN KEY ("last_event_id") REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Derived holder accounts -----------------------------------------------------
-- Balances are re-derived from the state rows on every applied event; "held"
-- may be transiently negative while a handover precedes its collections.
CREATE TABLE "app"."wallet_accounts" (
    "id" UUID NOT NULL,
    "holder_subject" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "purpose" VARCHAR(24) NOT NULL,
    "collected_minor" BIGINT NOT NULL,
    "reversed_minor" BIGINT NOT NULL,
    "in_handover_minor" BIGINT NOT NULL,
    "received_minor" BIGINT NOT NULL,
    "settled_minor" BIGINT NOT NULL,
    "shortage_minor" BIGINT NOT NULL,
    "overage_minor" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "last_event_id" UUID,
    "last_event_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_accounts_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "wallet_accounts_purpose" CHECK ("purpose" = 'TECHNICIAN_CUSTODY'),
    CONSTRAINT "wallet_accounts_amounts" CHECK (
        "collected_minor" >= 0 AND "reversed_minor" >= 0 AND "in_handover_minor" >= 0
        AND "received_minor" >= 0 AND "settled_minor" >= 0 AND "shortage_minor" >= 0
        AND "overage_minor" >= 0 AND "reversed_minor" <= "collected_minor"
    ),
    CONSTRAINT "wallet_accounts_revision" CHECK ("revision" >= 0),
    CONSTRAINT "wallet_accounts_last_event" CHECK (
        ("last_event_id" IS NULL) = ("last_event_at" IS NULL)
        AND ("revision" = 0) = ("last_event_id" IS NULL)
    )
);
CREATE UNIQUE INDEX "wallet_accounts_holder_currency_purpose_key" ON "app"."wallet_accounts"("holder_subject", "currency", "purpose");

-- One movement per (Billing event, account). Append-only.
CREATE TABLE "app"."wallet_movements" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "applied_with_event_id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "source_type" VARCHAR(48) NOT NULL,
    "source_id" UUID NOT NULL,
    "account_revision" INTEGER NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wallet_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_movements_kind" CHECK ("kind" IN ('CASH_COLLECTED', 'COLLECTION_REVERSED',
        'HANDOVER_DECLARED', 'HANDOVER_CANCELLED', 'HANDOVER_RECEIVED', 'HANDOVER_RECONCILED')),
    CONSTRAINT "wallet_movements_currency" CHECK ("currency" IN ('SYP', 'USD')),
    CONSTRAINT "wallet_movements_amount" CHECK ("amount_minor" >= 0 AND "amount_minor" < 1000000000000000000),
    CONSTRAINT "wallet_movements_revision" CHECK ("account_revision" >= 1)
);
CREATE UNIQUE INDEX "wallet_movements_event_id_account_id_key" ON "app"."wallet_movements"("event_id", "account_id");
CREATE INDEX "wallet_movements_account_idx" ON "app"."wallet_movements"("account_id", "recorded_at");
ALTER TABLE "app"."wallet_movements" ADD CONSTRAINT "wallet_movements_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "app"."wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."wallet_movements" ADD CONSTRAINT "wallet_movements_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app"."wallet_movements" ADD CONSTRAINT "wallet_movements_applied_with_event_id_fkey"
    FOREIGN KEY ("applied_with_event_id") REFERENCES "app"."wallet_inbox"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Database-enforced invariants ----------------------------------------------
-- The runtime role keeps table DML from the provisioner, so history tables are
-- protected here rather than by privileges.
CREATE FUNCTION "app"."wallet_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'WALLET_APPEND_ONLY: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- State rows only move forward and never change their identity.
CREATE FUNCTION "app"."wallet_guard_receipt"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."receipt_id" <> OLD."receipt_id" OR NEW."currency" <> OLD."currency"
       OR NEW."amount_minor" <> OLD."amount_minor"
       OR (OLD."holder_subject" IS NOT NULL AND NEW."holder_subject" IS DISTINCT FROM OLD."holder_subject")
       OR (OLD."collected_event_id" IS NOT NULL AND NEW."collected_event_id" IS DISTINCT FROM OLD."collected_event_id")
       OR (OLD."reversed_event_id" IS NOT NULL AND NEW."reversed_event_id" IS DISTINCT FROM OLD."reversed_event_id")
       OR NEW."version" < OLD."version" THEN
        RAISE EXCEPTION 'WALLET_RECEIPT_REWRITE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."wallet_guard_handover"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."handover_id" <> OLD."handover_id" OR NEW."holder_subject" <> OLD."holder_subject"
       OR NEW."currency" <> OLD."currency" OR NEW."declared_minor" <> OLD."declared_minor"
       OR NEW."receipt_count" <> OLD."receipt_count" OR NEW."version" <= OLD."version"
       OR OLD."status" IN ('CANCELLED', 'RECONCILED')
       OR (OLD."status" = 'RECEIVED' AND NEW."status" <> 'RECONCILED') THEN
        RAISE EXCEPTION 'WALLET_HANDOVER_REWRITE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "wallet_inbox_append_only" BEFORE UPDATE OR DELETE ON "app"."wallet_inbox"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_inbox_conflict_append_only" BEFORE UPDATE OR DELETE ON "app"."wallet_inbox_conflict"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_movements_append_only" BEFORE UPDATE OR DELETE ON "app"."wallet_movements"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_custody_receipt_no_delete" BEFORE DELETE ON "app"."wallet_custody_receipt"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_custody_handover_no_delete" BEFORE DELETE ON "app"."wallet_custody_handover"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_accounts_no_delete" BEFORE DELETE ON "app"."wallet_accounts"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_reject_mutation"();
CREATE TRIGGER "wallet_custody_receipt_guard" BEFORE UPDATE ON "app"."wallet_custody_receipt"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_guard_receipt"();
CREATE TRIGGER "wallet_custody_handover_guard" BEFORE UPDATE ON "app"."wallet_custody_handover"
    FOR EACH ROW EXECUTE FUNCTION "app"."wallet_guard_handover"();
