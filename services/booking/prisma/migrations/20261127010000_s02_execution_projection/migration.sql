-- Owner-local inbox and monotonic Dispatch execution observation. Expand-only.
CREATE TABLE "inbox_message" (
  "consumer_name" VARCHAR(80) NOT NULL,
  "event_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_message_pkey" PRIMARY KEY ("consumer_name", "event_id")
);
CREATE TABLE "booking_dispatch_projection" (
  "booking_id" UUID NOT NULL REFERENCES "booking"("id") ON DELETE RESTRICT,
  "assignment_id" UUID NOT NULL,
  "assignment_revision" INTEGER NOT NULL CHECK ("assignment_revision" > 0),
  "task_id" UUID,
  "task_revision" INTEGER,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_dispatch_projection_pkey" PRIMARY KEY ("booking_id"),
  CONSTRAINT "booking_dispatch_projection_task_ck" CHECK (
    ("task_id" IS NULL AND "task_revision" IS NULL) OR
    ("task_id" IS NOT NULL AND "task_revision" > 0))
);
