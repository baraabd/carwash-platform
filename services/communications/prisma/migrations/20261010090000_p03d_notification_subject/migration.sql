-- P03-D: link a notification to the owner fact it is about (for example a
-- booking), so staff can see its delivery state. Applied by the migration
-- identity (cw_communications_migrate) as a separate job. Additive only
-- (expand step): two nullable columns, two indexes and one CHECK that every
-- existing row (both columns NULL) already satisfies. Previous code never
-- writes the columns and keeps working unchanged.
-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "subject_ref" UUID,
ADD COLUMN     "subject_type" VARCHAR(32);

-- CreateIndex
CREATE INDEX "notification_subject_type_subject_ref_idx" ON "notification"("subject_type", "subject_ref");

-- CreateIndex
CREATE INDEX "notification_created_at_id_idx" ON "notification"("created_at", "id");

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_subject_complete" CHECK (("subject_type" IS NULL) = ("subject_ref" IS NULL)),
  ADD CONSTRAINT "notification_subject_type_format" CHECK ("subject_type" IS NULL OR "subject_type" ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$');
