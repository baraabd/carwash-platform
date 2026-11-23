-- Strengthen the deferred quote invariant without rewriting applied migrations.
-- CREATE OR REPLACE retains the existing trigger and restricted function ACL.
CREATE OR REPLACE FUNCTION "app"."pricing_check_quote_consistency"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    line_sum NUMERIC;
    package_lines INTEGER;
    vehicle_lines INTEGER;
BEGIN
    SELECT COALESCE(SUM(l."amount_minor"), 0),
           COUNT(*) FILTER (WHERE l."kind" = 'PACKAGE'),
           COUNT(*) FILTER (WHERE l."kind" = 'VEHICLE')
      INTO line_sum, package_lines, vehicle_lines
      FROM "app"."quote_line" l WHERE l."quote_id" = NEW."id";
    IF package_lines <> 1 OR vehicle_lines <> 1 OR line_sum <> NEW."subtotal_minor" THEN
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
