-- Sprint 0.2 foundation migration for the catalog service.
-- Applied by the migration identity (cw_catalog_migrate) as a separate job.
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
CREATE TABLE "foundation_probe" (
    "id" UUID NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foundation_probe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_message" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_by" TEXT,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "published_at" TIMESTAMP(3),
    "dead_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");
