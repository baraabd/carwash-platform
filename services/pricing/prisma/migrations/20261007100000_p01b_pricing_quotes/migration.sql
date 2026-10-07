-- P01-B2: price versions, exact rates, immutable quotes, idempotency receipts, audit.
-- Applied by the migration identity (cw_pricing_migrate) as a separate job.
-- Application replicas never run this file. Additive only (expand phase).
-- Money is BIGINT minor units; there is no floating-point amount column.

-- Publication serialisation -------------------------------------------------
CREATE TABLE "app"."pricing_publication_lock" (
    "id" SMALLINT NOT NULL,
    CONSTRAINT "pricing_publication_lock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_publication_lock_singleton" CHECK ("id" = 1)
);
INSERT INTO "app"."pricing_publication_lock" ("id") VALUES (1);

-- Price versions ------------------------------------------------------------
CREATE TABLE "app"."price_version" (
    "version" INTEGER NOT NULL,
    "previous_version" INTEGER,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "catalog_fingerprint" CHAR(64) NOT NULL,
    "catalog_snapshot" JSONB NOT NULL,
    "policy_revision" VARCHAR(64) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "minor_unit_exponent" SMALLINT NOT NULL,
    "rates_fingerprint" CHAR(64) NOT NULL,
    CONSTRAINT "price_version_pkey" PRIMARY KEY ("version"),
    CONSTRAINT "price_version_positive" CHECK ("version" > 0 AND "catalog_revision" > 0),
    CONSTRAINT "price_version_linear_chain" CHECK (
        ("version" = 1 AND "previous_version" IS NULL)
        OR ("version" > 1 AND "previous_version" = "version" - 1)
    ),
    CONSTRAINT "price_version_not_retroactive" CHECK ("effective_from" >= "published_at"),
    CONSTRAINT "price_version_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "price_version_exponent" CHECK ("minor_unit_exponent" BETWEEN 0 AND 4),
    CONSTRAINT "price_version_policy_revision" CHECK ("policy_revision" ~ '^[A-Za-z0-9._-]{1,64}$'),
    CONSTRAINT "price_version_fingerprints" CHECK (
        "catalog_fingerprint" ~ '^[0-9a-f]{64}$' AND "rates_fingerprint" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "price_version_snapshot_object" CHECK (jsonb_typeof("catalog_snapshot") = 'object')
);
CREATE UNIQUE INDEX "price_version_previous_version_key" ON "app"."price_version"("previous_version");
CREATE UNIQUE INDEX "price_version_effective_from_key" ON "app"."price_version"("effective_from");
ALTER TABLE "app"."price_version" ADD CONSTRAINT "price_version_previous_version_fkey"
    FOREIGN KEY ("previous_version") REFERENCES "app"."price_version"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "app"."price_rate" (
    "version" INTEGER NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "definition_id" VARCHAR(48) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    CONSTRAINT "price_rate_pkey" PRIMARY KEY ("version","kind","definition_id"),
    CONSTRAINT "price_rate_kind" CHECK ("kind" IN ('PACKAGE', 'VEHICLE', 'ADDON')),
    CONSTRAINT "price_rate_definition_id" CHECK ("definition_id" ~ '^[a-z][a-z0-9-]{1,47}$'),
    CONSTRAINT "price_rate_amount" CHECK ("amount_minor" >= 0)
);
ALTER TABLE "app"."price_rate" ADD CONSTRAINT "price_rate_version_fkey"
    FOREIGN KEY ("version") REFERENCES "app"."price_version"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Quotes --------------------------------------------------------------------
CREATE TABLE "app"."quote" (
    "id" UUID NOT NULL,
    "owner_subject" UUID NOT NULL,
    "price_version" INTEGER NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "policy_revision" VARCHAR(64) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "minor_unit_exponent" SMALLINT NOT NULL,
    "category_id" VARCHAR(48) NOT NULL,
    "package_id" VARCHAR(48) NOT NULL,
    "addon_ids" TEXT[],
    "subtotal_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "input_fingerprint" CHAR(64) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "quote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_expiry_after_issue" CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "quote_amounts" CHECK ("subtotal_minor" >= 0 AND "total_minor" >= 0),
    -- v1 computes no discount, fee or tax (owner decisions B-04/B-10 are open).
    CONSTRAINT "quote_total_equals_subtotal" CHECK ("total_minor" = "subtotal_minor"),
    CONSTRAINT "quote_duration" CHECK ("duration_minutes" BETWEEN 1 AND 1440),
    CONSTRAINT "quote_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "quote_addon_ids" CHECK ("addon_ids" IS NOT NULL AND cardinality("addon_ids") <= 20),
    CONSTRAINT "quote_fingerprint_hex" CHECK ("input_fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "quote_owner_issued_idx" ON "app"."quote"("owner_subject", "issued_at");
ALTER TABLE "app"."quote" ADD CONSTRAINT "quote_price_version_fkey"
    FOREIGN KEY ("price_version") REFERENCES "app"."price_version"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "app"."quote_line" (
    "quote_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "definition_id" VARCHAR(48) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "included" BOOLEAN NOT NULL,
    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("quote_id","line_no"),
    CONSTRAINT "quote_line_no" CHECK ("line_no" >= 0),
    CONSTRAINT "quote_line_kind" CHECK ("kind" IN ('PACKAGE', 'VEHICLE', 'ADDON')),
    CONSTRAINT "quote_line_amount" CHECK ("amount_minor" >= 0),
    CONSTRAINT "quote_line_included_is_free" CHECK (NOT "included" OR ("kind" = 'ADDON' AND "amount_minor" = 0))
);
ALTER TABLE "app"."quote_line" ADD CONSTRAINT "quote_line_quote_id_fkey"
    FOREIGN KEY ("quote_id") REFERENCES "app"."quote"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Idempotency and audit -----------------------------------------------------
CREATE TABLE "app"."pricing_idempotency_receipt" (
    "actor_subject" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "pricing_idempotency_receipt_pkey" PRIMARY KEY ("actor_subject","operation","idempotency_key"),
    CONSTRAINT "pricing_idempotency_receipt_key_format" CHECK ("idempotency_key" ~ '^[A-Za-z0-9_-]{16,128}$'),
    CONSTRAINT "pricing_idempotency_receipt_fingerprint_hex" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "pricing_idempotency_receipt_status" CHECK ("response_status" BETWEEN 200 AND 599)
);

CREATE TABLE "app"."pricing_audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "version" INTEGER,
    "outcome" VARCHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "pricing_audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_audit_event_action" CHECK ("action" IN ('pricing.version.published', 'pricing.version.publish-rejected'))
);
CREATE INDEX "pricing_audit_event_occurred_idx" ON "app"."pricing_audit_event"("occurred_at");

-- Database-enforced immutability -------------------------------------------
CREATE FUNCTION "app"."pricing_reject_mutation"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'PRICING_IMMUTABLE: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- Rates may only be written by the transaction that created their version.
CREATE FUNCTION "app"."pricing_require_open_version"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."price_version" v
         WHERE v."version" = NEW."version" AND v.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'PRICE_VERSION_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Quote lines may only be written by the transaction that created their quote.
CREATE FUNCTION "app"."pricing_require_open_quote"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."quote" q
         WHERE q."id" = NEW."quote_id" AND q.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'QUOTE_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "app"."pricing_require_increasing_effective_from"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW."previous_version" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "app"."price_version" p
         WHERE p."version" = NEW."previous_version" AND p."effective_from" >= NEW."effective_from"
    ) THEN
        RAISE EXCEPTION 'PRICE_EFFECTIVE_FROM_NOT_INCREASING' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- At COMMIT every quote must have its PACKAGE and VEHICLE lines and its lines
-- must sum exactly to its subtotal, and it must match its price version's
-- catalog revision, policy and currency. A partial or inconsistent quote can
-- never become visible.
CREATE FUNCTION "app"."pricing_check_quote_consistency"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    line_sum NUMERIC;
    base_lines INTEGER;
BEGIN
    SELECT COALESCE(SUM(l."amount_minor"), 0), COUNT(*) FILTER (WHERE l."kind" IN ('PACKAGE', 'VEHICLE'))
      INTO line_sum, base_lines
      FROM "app"."quote_line" l WHERE l."quote_id" = NEW."id";
    IF base_lines <> 2 OR line_sum <> NEW."subtotal_minor" THEN
        RAISE EXCEPTION 'QUOTE_LINES_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "app"."price_version" v
         WHERE v."version" = NEW."price_version"
           AND v."catalog_revision" = NEW."catalog_revision"
           AND v."policy_revision" = NEW."policy_revision"
           AND v."currency" = NEW."currency"
           AND v."minor_unit_exponent" = NEW."minor_unit_exponent"
    ) THEN
        RAISE EXCEPTION 'QUOTE_VERSION_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "price_version_increasing_effective_from" BEFORE INSERT ON "app"."price_version" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_require_increasing_effective_from"();
CREATE TRIGGER "price_rate_open_version" BEFORE INSERT ON "app"."price_rate" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_require_open_version"();
CREATE TRIGGER "quote_line_open_quote" BEFORE INSERT ON "app"."quote_line" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_require_open_quote"();
CREATE CONSTRAINT TRIGGER "quote_consistency" AFTER INSERT ON "app"."quote"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."pricing_check_quote_consistency"();

CREATE TRIGGER "pricing_publication_lock_immutable" BEFORE UPDATE OR DELETE ON "app"."pricing_publication_lock" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "price_version_immutable" BEFORE UPDATE OR DELETE ON "app"."price_version" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "price_rate_immutable" BEFORE UPDATE OR DELETE ON "app"."price_rate" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "quote_immutable" BEFORE UPDATE OR DELETE ON "app"."quote" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "quote_line_immutable" BEFORE UPDATE OR DELETE ON "app"."quote_line" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "pricing_idempotency_receipt_immutable" BEFORE UPDATE OR DELETE ON "app"."pricing_idempotency_receipt" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "pricing_audit_event_immutable" BEFORE UPDATE OR DELETE ON "app"."pricing_audit_event" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
