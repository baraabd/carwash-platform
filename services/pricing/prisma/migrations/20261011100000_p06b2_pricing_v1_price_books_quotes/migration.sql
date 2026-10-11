-- P06-B2: pricing.v1 price books, quotes and audit.
-- Applied by the migration identity (cw_pricing_migrate) as a separate job.
-- Application replicas never run this file. Additive only (expand phase): the
-- P01-B2 price_version/price_rate/quote/quote_line tables are left untouched,
-- receive no new writes from this release and are dropped only by a later,
-- separately reviewed contract migration with a data plan.
-- Money is BIGINT minor units; there is no floating-point amount column.

-- Price books ---------------------------------------------------------------
CREATE TABLE "app"."price_book" (
    "revision" INTEGER NOT NULL,
    "previous_revision" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "scale" SMALLINT NOT NULL,
    "policy_revision" VARCHAR(64) NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "catalog_fingerprint" CHAR(64) NOT NULL,
    "catalog_view" JSONB NOT NULL,
    "entries_fingerprint" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "price_book_pkey" PRIMARY KEY ("revision"),
    CONSTRAINT "price_book_linear_chain" CHECK (
        ("revision" = 1 AND "previous_revision" IS NULL)
        OR ("revision" > 1 AND "previous_revision" = "revision" - 1)
    ),
    -- The closed pricing.v1 Money currency list and its fixed scales.
    CONSTRAINT "price_book_contract_currency" CHECK (("currency", "scale") IN (('SYP', 2), ('USD', 2))),
    CONSTRAINT "price_book_catalog_revision" CHECK ("catalog_revision" > 0),
    CONSTRAINT "price_book_policy_revision" CHECK ("policy_revision" ~ '^[A-Za-z0-9._-]{1,64}$'),
    CONSTRAINT "price_book_fingerprints" CHECK (
        "catalog_fingerprint" ~ '^[0-9a-f]{64}$' AND "entries_fingerprint" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "price_book_catalog_view_object" CHECK (jsonb_typeof("catalog_view") = 'object')
);
CREATE UNIQUE INDEX "price_book_previous_revision_key" ON "app"."price_book"("previous_revision");
ALTER TABLE "app"."price_book" ADD CONSTRAINT "price_book_previous_revision_fkey"
    FOREIGN KEY ("previous_revision") REFERENCES "app"."price_book"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- vehicle_scope '*' is the pricing.v1 `vehicleType: null` entry (every eligible
-- vehicle type without a specific entry); it keeps the key a plain primary key.
CREATE TABLE "app"."price_book_entry" (
    "revision" INTEGER NOT NULL,
    "definition_id" UUID NOT NULL,
    "vehicle_scope" VARCHAR(8) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    CONSTRAINT "price_book_entry_pkey" PRIMARY KEY ("revision","definition_id","vehicle_scope"),
    CONSTRAINT "price_book_entry_vehicle_scope" CHECK ("vehicle_scope" IN ('*', 'sedan', 'suv', 'large', 'pickup')),
    CONSTRAINT "price_book_entry_amount" CHECK ("unit_price_minor" >= 0 AND "unit_price_minor" < 1000000000000000000)
);
ALTER TABLE "app"."price_book_entry" ADD CONSTRAINT "price_book_entry_revision_fkey"
    FOREIGN KEY ("revision") REFERENCES "app"."price_book"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Quotes --------------------------------------------------------------------
CREATE TABLE "app"."pricing_quote" (
    "id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "beneficiary_kind" VARCHAR(8) NOT NULL,
    "beneficiary_subject" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "vehicle_type" VARCHAR(8) NOT NULL,
    "zone_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "scale" SMALLINT NOT NULL,
    "price_book_revision" INTEGER NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "policy_revision" VARCHAR(64) NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "pricing_quote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_quote_revision" CHECK ("revision" >= 1),
    CONSTRAINT "pricing_quote_beneficiary_kind" CHECK ("beneficiary_kind" IN ('account', 'guest')),
    CONSTRAINT "pricing_quote_vehicle_type" CHECK ("vehicle_type" IN ('sedan', 'suv', 'large', 'pickup')),
    CONSTRAINT "pricing_quote_total" CHECK ("total_minor" >= 0 AND "total_minor" < 1000000000000000000),
    CONSTRAINT "pricing_quote_expiry_after_issue" CHECK ("expires_at" > "issued_at")
);
CREATE INDEX "pricing_quote_beneficiary_issued_idx" ON "app"."pricing_quote"("beneficiary_subject", "issued_at");
ALTER TABLE "app"."pricing_quote" ADD CONSTRAINT "pricing_quote_price_book_revision_fkey"
    FOREIGN KEY ("price_book_revision") REFERENCES "app"."price_book"("revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Only PACKAGE and EXTRA lines exist: DISCOUNT/FEE/TAX/VEHICLE_SURCHARGE need
-- owner decisions B-04/B-10 and a reviewed migration before they can be stored.
CREATE TABLE "app"."pricing_quote_line" (
    "quote_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "line_id" UUID NOT NULL,
    "kind" VARCHAR(18) NOT NULL,
    "definition_id" UUID NOT NULL,
    "quantity" SMALLINT NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    CONSTRAINT "pricing_quote_line_pkey" PRIMARY KEY ("quote_id","line_no"),
    CONSTRAINT "pricing_quote_line_no" CHECK ("line_no" >= 0),
    CONSTRAINT "pricing_quote_line_kind" CHECK ("kind" IN ('PACKAGE', 'EXTRA')),
    CONSTRAINT "pricing_quote_line_quantity" CHECK ("quantity" BETWEEN 1 AND 10),
    CONSTRAINT "pricing_quote_line_amount" CHECK (
        "unit_price_minor" >= 0 AND "amount_minor" = "unit_price_minor" * "quantity"
    )
);
CREATE UNIQUE INDEX "pricing_quote_line_line_id_key" ON "app"."pricing_quote_line"("line_id");
ALTER TABLE "app"."pricing_quote_line" ADD CONSTRAINT "pricing_quote_line_quote_id_fkey"
    FOREIGN KEY ("quote_id") REFERENCES "app"."pricing_quote"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Audit ---------------------------------------------------------------------
-- actor is an Identity subject UUID or service:<client id>. No price,
-- beneficiary, credential or personal data is stored here.
CREATE TABLE "app"."pricing_audit_record" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "subject_ref" VARCHAR(80),
    "purpose" VARCHAR(32),
    "outcome" VARCHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,
    CONSTRAINT "pricing_audit_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_audit_record_actor" CHECK (
        "actor" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR "actor" ~ '^service:[a-z][a-z0-9-]{1,63}$'
    ),
    CONSTRAINT "pricing_audit_record_action" CHECK ("action" IN (
        'pricing.price-book.published',
        'pricing.price-book.publish-rejected',
        'pricing.quote.validated'
    )),
    CONSTRAINT "pricing_audit_record_purpose" CHECK (
        "purpose" IS NULL OR "purpose" IN ('booking-quote', 'booking-create', 'booking-display')
    ),
    CONSTRAINT "pricing_audit_record_outcome" CHECK ("outcome" ~ '^[A-Z][A-Z0-9_]{1,63}$')
);
CREATE INDEX "pricing_audit_record_occurred_idx" ON "app"."pricing_audit_record"("occurred_at");

-- Database-enforced invariants ---------------------------------------------
-- Entries may only be written by the transaction that created their book.
CREATE FUNCTION "app"."pricing_require_open_price_book"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."price_book" b
         WHERE b."revision" = NEW."revision" AND b.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'PRICE_BOOK_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Lines may only be written by the transaction that created their quote.
CREATE FUNCTION "app"."pricing_require_open_pricing_quote"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "app"."pricing_quote" q
         WHERE q."id" = NEW."quote_id" AND q.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'QUOTE_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- At COMMIT a price book has at least one entry. An empty book never becomes visible.
CREATE FUNCTION "app"."pricing_check_price_book_entries"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "app"."price_book_entry" e WHERE e."revision" = NEW."revision") THEN
        RAISE EXCEPTION 'PRICE_BOOK_EMPTY' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

-- At COMMIT a quote has exactly one PACKAGE line, its lines sum exactly to its
-- total, and it carries its price book's currency, scale, catalog revision and
-- policy revision. A partial or inconsistent quote never becomes visible.
CREATE FUNCTION "app"."pricing_check_pricing_quote"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    line_sum NUMERIC;
    package_lines INTEGER;
BEGIN
    SELECT COALESCE(SUM(l."amount_minor"), 0), COUNT(*) FILTER (WHERE l."kind" = 'PACKAGE')
      INTO line_sum, package_lines
      FROM "app"."pricing_quote_line" l WHERE l."quote_id" = NEW."id";
    IF package_lines <> 1 OR line_sum <> NEW."total_minor" THEN
        RAISE EXCEPTION 'QUOTE_LINES_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "app"."price_book" b
         WHERE b."revision" = NEW."price_book_revision"
           AND b."currency" = NEW."currency"
           AND b."scale" = NEW."scale"
           AND b."catalog_revision" = NEW."catalog_revision"
           AND b."policy_revision" = NEW."policy_revision"
    ) THEN
        RAISE EXCEPTION 'QUOTE_PRICE_BOOK_INCONSISTENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "price_book_entry_open_book" BEFORE INSERT ON "app"."price_book_entry" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_require_open_price_book"();
CREATE TRIGGER "pricing_quote_line_open_quote" BEFORE INSERT ON "app"."pricing_quote_line" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_require_open_pricing_quote"();
CREATE CONSTRAINT TRIGGER "price_book_has_entries" AFTER INSERT ON "app"."price_book"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."pricing_check_price_book_entries"();
CREATE CONSTRAINT TRIGGER "pricing_quote_consistency" AFTER INSERT ON "app"."pricing_quote"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "app"."pricing_check_pricing_quote"();

CREATE TRIGGER "price_book_immutable" BEFORE UPDATE OR DELETE ON "app"."price_book" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "price_book_entry_immutable" BEFORE UPDATE OR DELETE ON "app"."price_book_entry" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "pricing_quote_immutable" BEFORE UPDATE OR DELETE ON "app"."pricing_quote" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "pricing_quote_line_immutable" BEFORE UPDATE OR DELETE ON "app"."pricing_quote_line" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();
CREATE TRIGGER "pricing_audit_record_immutable" BEFORE UPDATE OR DELETE ON "app"."pricing_audit_record" FOR EACH ROW EXECUTE FUNCTION "app"."pricing_reject_mutation"();

-- Trigger functions need no caller privilege (it is checked when the trigger
-- is created), so no other role may run them directly.
REVOKE ALL ON FUNCTION "app"."pricing_require_open_price_book"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."pricing_require_open_pricing_quote"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."pricing_check_price_book_entries"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."pricing_check_pricing_quote"() FROM PUBLIC;
