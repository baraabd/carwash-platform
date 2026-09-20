-- Sprint 0.2 foundation migration for the identity service.
-- Applied by the migration identity (cw_identity_migrate) as a separate job.
-- Application replicas never run this file.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "service_marker" (
    "service" TEXT NOT NULL,
    "schema_rev" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_marker_pkey" PRIMARY KEY ("service")
);
