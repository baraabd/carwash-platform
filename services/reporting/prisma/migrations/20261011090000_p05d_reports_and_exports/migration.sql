-- P05-D reports for the reporting service: the revenue read model (from
-- Billing's published events) and the report export audit. Applied by the
-- migration identity (cw_reporting_migrate) as a separate job; application
-- replicas never run this file. Additive only (expand step): four new tables;
-- no existing table, constraint or row is changed, so the previous image keeps
-- working against this schema.
-- CreateTable
CREATE TABLE "rpt_obligation" (
    "obligation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "financial_status" VARCHAR(16) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "scale" SMALLINT NOT NULL,
    "amount_minor" BIGINT,
    "verified_minor" BIGINT,
    "outstanding_minor" BIGINT,
    "created_at" TIMESTAMPTZ(3),
    "settled_at" TIMESTAMPTZ(3),
    "fingerprint" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rpt_obligation_pkey" PRIMARY KEY ("obligation_id")
);

-- CreateTable
CREATE TABLE "rpt_refund" (
    "refund_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "scale" SMALLINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "first_observed_at" TIMESTAMPTZ(3) NOT NULL,
    "succeeded_at" TIMESTAMPTZ(3),
    "fingerprint" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rpt_refund_pkey" PRIMARY KEY ("refund_id")
);

-- CreateTable
CREATE TABLE "report_export_audit" (
    "export_id" UUID NOT NULL,
    "subject" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "report" VARCHAR(16) NOT NULL,
    "parameters_hash" CHAR(64) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_export_audit_pkey" PRIMARY KEY ("export_id")
);

-- CreateTable
CREATE TABLE "report_export_content" (
    "export_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_export_content_pkey" PRIMARY KEY ("export_id")
);

-- CreateIndex
CREATE INDEX "rpt_obligation_currency_settled_at_idx" ON "rpt_obligation"("currency", "settled_at");

-- CreateIndex
CREATE INDEX "rpt_obligation_currency_created_at_idx" ON "rpt_obligation"("currency", "created_at");

-- CreateIndex
CREATE INDEX "rpt_refund_currency_succeeded_at_idx" ON "rpt_refund"("currency", "succeeded_at");

-- CreateIndex
CREATE INDEX "rpt_refund_currency_first_observed_at_idx" ON "rpt_refund"("currency", "first_observed_at");

-- CreateIndex
CREATE INDEX "report_export_audit_generated_at_idx" ON "report_export_audit"("generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_export_audit_subject_idempotency_key_key" ON "report_export_audit"("subject", "idempotency_key");

-- CreateIndex
CREATE INDEX "report_export_content_expires_at_idx" ON "report_export_content"("expires_at");

-- AddForeignKey
ALTER TABLE "report_export_content" ADD CONSTRAINT "report_export_content_export_id_fkey" FOREIGN KEY ("export_id") REFERENCES "report_export_audit"("export_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Closed vocabularies and invariants enforced by the database itself.
ALTER TABLE "rpt_obligation"
  ADD CONSTRAINT "rpt_obligation_status_known" CHECK ("financial_status" IN (
    'UNPAID', 'AWAITING_CASH', 'AWAITING_PAYMENT', 'UNDER_REVIEW', 'OUTCOME_UNKNOWN',
    'PAID', 'CASH_COLLECTED', 'VOIDED')),
  ADD CONSTRAINT "rpt_obligation_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "rpt_obligation_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "rpt_obligation_scale_range" CHECK ("scale" BETWEEN 0 AND 4),
  ADD CONSTRAINT "rpt_obligation_amounts_range" CHECK (
    ("amount_minor" IS NULL OR ("amount_minor" >= 0 AND "amount_minor" < 1000000000000000000))
    AND ("verified_minor" IS NULL OR ("verified_minor" >= 0 AND "verified_minor" < 1000000000000000000))
    AND ("outstanding_minor" IS NULL OR ("outstanding_minor" >= 0 AND "outstanding_minor" < 1000000000000000000))),
  ADD CONSTRAINT "rpt_obligation_settled_iff_status" CHECK (
    ("financial_status" IN ('PAID', 'CASH_COLLECTED')) = ("settled_at" IS NOT NULL)),
  ADD CONSTRAINT "rpt_obligation_closed_nothing_outstanding" CHECK (
    "financial_status" NOT IN ('PAID', 'CASH_COLLECTED', 'VOIDED')
    OR "outstanding_minor" IS NULL OR "outstanding_minor" = 0),
  ADD CONSTRAINT "rpt_obligation_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "rpt_refund"
  ADD CONSTRAINT "rpt_refund_status_known" CHECK ("status" IN ('REQUESTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN')),
  ADD CONSTRAINT "rpt_refund_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "rpt_refund_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "rpt_refund_scale_range" CHECK ("scale" BETWEEN 0 AND 4),
  ADD CONSTRAINT "rpt_refund_amount_range" CHECK ("amount_minor" > 0 AND "amount_minor" < 1000000000000000000),
  ADD CONSTRAINT "rpt_refund_succeeded_iff_status" CHECK (("status" = 'SUCCEEDED') = ("succeeded_at" IS NOT NULL)),
  ADD CONSTRAINT "rpt_refund_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "report_export_audit"
  ADD CONSTRAINT "report_export_audit_report_known" CHECK ("report" IN ('revenue', 'operations')),
  ADD CONSTRAINT "report_export_audit_key_format" CHECK ("idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$'),
  ADD CONSTRAINT "report_export_audit_row_count_range" CHECK ("row_count" >= 0 AND "row_count" <= 1000),
  ADD CONSTRAINT "report_export_audit_parameters_hex" CHECK ("parameters_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "report_export_audit_content_hex" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "report_export_content"
  ADD CONSTRAINT "report_export_content_bounded" CHECK (octet_length("content") <= 1048576);

-- The export audit is append-only evidence, enforced by the database itself
-- independent of role grants (the runtime role is granted generic DML on
-- every table by provisioning). Reuses the P01-D immutability trigger function.
CREATE TRIGGER "report_export_audit_immutable" BEFORE UPDATE OR DELETE ON "app"."report_export_audit" FOR EACH ROW EXECUTE FUNCTION "app"."reporting_reject_mutation"();
