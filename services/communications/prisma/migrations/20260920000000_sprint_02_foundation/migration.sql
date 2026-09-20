-- Sprint 0.2 foundation migration for the communications service.
-- Applied by the migration identity (cw_communications_migrate) as a separate job.
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

-- CreateTable
CREATE TABLE "inbox_message" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_message_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "probe_notification" (
    "probe_id" UUID NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "apply_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "probe_notification_pkey" PRIMARY KEY ("probe_id")
);
