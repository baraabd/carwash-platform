ALTER TABLE "subscription_plan_revision" ADD COLUMN "vehicle_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "customer_subscription" ADD COLUMN "vehicle_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "subscription_plan_revision" ADD CONSTRAINT "subscription_plan_vehicles_known" CHECK (
  "vehicle_types" <@ ARRAY['sedan','suv','large','pickup']::TEXT[] AND array_position("vehicle_types", NULL) IS NULL);
CREATE FUNCTION "app"."subscription_guard_vehicle_terms"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "app"."subscription_plan_revision" r WHERE r."plan_code" = NEW."plan_code"
    AND r."revision" = NEW."plan_revision" AND r."vehicle_types" = NEW."vehicle_types") THEN
    RAISE EXCEPTION 'subscription vehicle coverage must match its immutable revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "customer_subscription_vehicle_terms" BEFORE INSERT OR UPDATE ON "customer_subscription"
  FOR EACH ROW EXECUTE FUNCTION "app"."subscription_guard_vehicle_terms"();
REVOKE ALL ON FUNCTION "app"."subscription_guard_vehicle_terms"() FROM PUBLIC;
