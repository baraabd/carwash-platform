-- P01-D notification intent and delivery state for the communications service.
-- Applied by the migration identity (cw_communications_migrate) as a separate
-- job; application replicas never run this file. Additive only (expand step):
-- the foundation inbox and probe tables are untouched, so the previous worker
-- build keeps running against this schema.

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "source_service" VARCHAR(32) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "recipient_ref" UUID NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "template_key" VARCHAR(64) NOT NULL,
    "template_version" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "lease_owner" VARCHAR(64),
    "lease_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "provider_message_id" VARCHAR(128),
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_channel_known" CHECK ("channel" IN ('SMS', 'PUSH', 'EMAIL')),
    CONSTRAINT "notification_state_known" CHECK ("state" IN (
        'QUEUED', 'SENDING', 'RETRY_WAIT', 'UNKNOWN', 'PROVIDER_ACCEPTED',
        'DELIVERED', 'FAILED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT "notification_counters_non_negative" CHECK ("attempt_count" >= 0 AND "fence" >= 0),
    CONSTRAINT "notification_template_version_positive" CHECK ("template_version" >= 1),
    CONSTRAINT "notification_request_hash_hex" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "notification_parameters_object" CHECK (jsonb_typeof("parameters") = 'object'),
    -- A lease exists exactly while a worker is sending.
    CONSTRAINT "notification_lease_only_while_sending" CHECK (
        ("state" = 'SENDING') = ("lease_owner" IS NOT NULL AND "lease_until" IS NOT NULL)),
    -- Only an accepted or delivered message has a provider id to correlate.
    CONSTRAINT "notification_provider_id_only_when_accepted" CHECK (
        "provider_message_id" IS NULL OR "state" IN ('PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED'))
);

-- CreateTable
CREATE TABLE "delivery_attempt" (
    "notification_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "fence" INTEGER NOT NULL,
    "worker_id" VARCHAR(64) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "outcome" VARCHAR(24),
    "provider_message_id" VARCHAR(128),
    "error_code" VARCHAR(64),

    CONSTRAINT "delivery_attempt_pkey" PRIMARY KEY ("notification_id","attempt_no"),
    CONSTRAINT "delivery_attempt_number_positive" CHECK ("attempt_no" >= 1 AND "fence" >= 1),
    CONSTRAINT "delivery_attempt_finished_has_outcome" CHECK (("finished_at" IS NULL) = ("outcome" IS NULL))
);

-- CreateIndex
CREATE INDEX "notification_state_next_attempt_at_idx" ON "notification"("state", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_source_service_idempotency_key_key" ON "notification"("source_service", "idempotency_key");

-- AddForeignKey
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
