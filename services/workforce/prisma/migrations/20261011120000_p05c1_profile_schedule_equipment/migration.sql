-- P05-C1: service area, weekly availability, availability exceptions and
-- operational equipment / service-vehicle readiness.
-- Expand-only: one new column with a default and new tables. Nothing is
-- altered in type, renamed or dropped; existing rows keep their meaning
-- (equipment_blocked = false, no area = home zone only, no schedule, no
-- exception, no equipment). Applied by cw_workforce_migrate only; the runtime
-- role keeps DML-only privileges through the schema default privileges.

-- Mirror of "a REQUIRED equipment item is UNAVAILABLE", maintained in the same
-- transaction as the equipment change. An eligibility input: it moves together
-- with version and eligibility_revision.
ALTER TABLE "operator" ADD COLUMN "equipment_blocked" BOOLEAN NOT NULL DEFAULT false;

-- Service area: extra zones besides the home zone. No row = home zone only.
CREATE TABLE "operator_service_area" (
  "operator_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "operator_service_area_pkey" PRIMARY KEY ("operator_id"),
  CONSTRAINT "operator_service_area_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "operator_service_area_operator_id_fkey"
    FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "operator_service_zone" (
  "operator_id" UUID NOT NULL,
  "zone_id" UUID NOT NULL,
  CONSTRAINT "operator_service_zone_pkey" PRIMARY KEY ("operator_id","zone_id"),
  CONSTRAINT "operator_service_zone_area_fkey"
    FOREIGN KEY ("operator_id") REFERENCES "operator_service_area"("operator_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "operator_service_zone_zone_id_idx" ON "operator_service_zone"("zone_id");

-- Weekly schedule: local wall-clock windows of one IANA time zone.
CREATE TABLE "operator_weekly_schedule" (
  "operator_id" UUID NOT NULL,
  "time_zone" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "operator_weekly_schedule_pkey" PRIMARY KEY ("operator_id"),
  CONSTRAINT "operator_weekly_schedule_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "operator_weekly_schedule_operator_id_fkey"
    FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "operator_weekly_window" (
  "operator_id" UUID NOT NULL,
  "weekday" SMALLINT NOT NULL,
  "start_minute" SMALLINT NOT NULL,
  "end_minute" SMALLINT NOT NULL,
  "zone_id" UUID NOT NULL,
  CONSTRAINT "operator_weekly_window_pkey" PRIMARY KEY ("operator_id","weekday","start_minute"),
  CONSTRAINT "operator_weekly_window_weekday_ck" CHECK ("weekday" BETWEEN 1 AND 7),
  CONSTRAINT "operator_weekly_window_minutes_ck" CHECK (
    "start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 1 AND 1440
    AND "end_minute" - "start_minute" >= 15
  ),
  CONSTRAINT "operator_weekly_window_no_overlap_ex" EXCLUDE USING gist (
    "operator_id" public.gist_uuid_ops WITH =,
    "weekday" public.gist_int2_ops WITH =,
    int4range("start_minute","end_minute",'[)') WITH &&
  ),
  CONSTRAINT "operator_weekly_window_schedule_fkey"
    FOREIGN KEY ("operator_id") REFERENCES "operator_weekly_schedule"("operator_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Dated periods without work. ACTIVE exceptions of one operator never overlap.
CREATE TABLE "availability_exception" (
  "id" UUID NOT NULL,
  "operator_id" UUID NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "requester" VARCHAR(120) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "availability_exception_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_exception_time_ck" CHECK (
    "ends_at" > "starts_at" AND "ends_at" - "starts_at" <= interval '31 days'
  ),
  CONSTRAINT "availability_exception_reason_ck"
    CHECK ("reason" IN ('LEAVE','SICKNESS','EQUIPMENT','PERSONAL','OTHER')),
  CONSTRAINT "availability_exception_status_ck" CHECK ("status" IN ('ACTIVE','CANCELLED')),
  CONSTRAINT "availability_exception_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "availability_exception_no_overlap_ex" EXCLUDE USING gist (
    "operator_id" public.gist_uuid_ops WITH =,
    tstzrange("starts_at","ends_at",'[)') WITH &&
  ) WHERE ("status" = 'ACTIVE'),
  CONSTRAINT "availability_exception_operator_id_fkey"
    FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "availability_exception_requester_idempotency_key_key"
  ON "availability_exception"("requester","idempotency_key");
CREATE INDEX "availability_exception_operator_id_starts_at_idx"
  ON "availability_exception"("operator_id","starts_at");

-- Operational equipment / service vehicle readiness. Readiness facts only:
-- no plate, VIN, serial number, location or free text.
CREATE TABLE "operator_equipment" (
  "id" UUID NOT NULL,
  "operator_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "issue" TEXT,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "operator_equipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operator_equipment_kind_ck" CHECK ("kind" IN
    ('SERVICE_VEHICLE','PRESSURE_WASHER','WATER_SUPPLY','POWER_SUPPLY','VACUUM','CLEANING_KIT')),
  CONSTRAINT "operator_equipment_status_ck" CHECK ("status" IN ('READY','DEGRADED','UNAVAILABLE')),
  CONSTRAINT "operator_equipment_issue_ck" CHECK (
    ("status" = 'READY' AND "issue" IS NULL) OR
    ("status" <> 'READY' AND "issue" IN ('BREAKDOWN','MAINTENANCE','MISSING','SUPPLIES_EMPTY','OTHER'))
  ),
  CONSTRAINT "operator_equipment_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "operator_equipment_operator_id_fkey"
    FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "operator_equipment_operator_id_kind_key"
  ON "operator_equipment"("operator_id","kind");
