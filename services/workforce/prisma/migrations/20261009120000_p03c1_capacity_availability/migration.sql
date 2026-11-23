-- P03-C1: published capacity resources and technician availability.
-- Expand-only: one new column with a default and one new table. Nothing is
-- altered in type, renamed or dropped. Applied by cw_workforce_migrate only;
-- the runtime role keeps DML-only privileges.

-- Eligibility revision of the capacity resource (= operator). Increases in the
-- same transaction as every change of an eligibility input (employment,
-- suspension, verification status/validity, skill grant/revoke). Every such
-- change also bumps "version", so the revision can never overtake it.
ALTER TABLE "operator" ADD COLUMN "eligibility_revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "operator" ADD CONSTRAINT "operator_eligibility_revision_ck"
  CHECK ("eligibility_revision" >= 1 AND "eligibility_revision" <= "version");

-- Technician ready/break state. A missing row means "never set" (ON_BREAK,
-- revision 0). Availability is not an eligibility input and emits no event.
CREATE TABLE "operator_availability" (
  "operator_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "operator_availability_pkey" PRIMARY KEY ("operator_id"),
  CONSTRAINT "operator_availability_status_ck" CHECK ("status" IN ('AVAILABLE','ON_BREAK')),
  CONSTRAINT "operator_availability_version_ck" CHECK ("version" >= 1)
);

ALTER TABLE "operator_availability" ADD CONSTRAINT "operator_availability_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
