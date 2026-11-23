-- Expand to customer.v1 without rewriting old addresses or inventing location
-- provenance. Canonical coordinates may omit both description and source.
ALTER TABLE "customer_address"
  ALTER COLUMN "label" TYPE VARCHAR(40),
  ALTER COLUMN "line" TYPE VARCHAR(300),
  ALTER COLUMN "line" DROP NOT NULL,
  ALTER COLUMN "access_note" TYPE VARCHAR(300);

ALTER TABLE "customer_address"
  DROP CONSTRAINT "customer_address_line_check",
  DROP CONSTRAINT "customer_address_location_check";

ALTER TABLE "customer_address"
  ADD CONSTRAINT "customer_address_line_check" CHECK (
    "line" IS NULL OR char_length(btrim("line")) >= 1
  ),
  ADD CONSTRAINT "customer_address_location_check" CHECK (
    ("location_kind" = 'manual' AND "line" IS NOT NULL
      AND "location_source" IS NULL AND "latitude" IS NULL AND "longitude" IS NULL)
    OR
    ("location_kind" = 'coordinates'
      AND ("location_source" IS NULL OR "location_source" IN ('pin', 'device', 'geocoder'))
      AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL
      AND "latitude" <> 'NaN'::numeric AND "longitude" <> 'NaN'::numeric
      AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  );

-- Stable, owner-scoped keyset pagination; old rows retain their IDs and order.
CREATE INDEX "customer_address_owner_page_idx"
  ON "customer_address" ("customer_id", "status", "created_at", "id");
