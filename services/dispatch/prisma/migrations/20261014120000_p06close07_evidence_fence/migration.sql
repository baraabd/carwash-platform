-- P06-CLOSE-07 (CR-P08-C1, finding OPS-F01 / B-07-01): when a task ends without
-- closing, Dispatch asks Media to revoke the uploader's access to the task's
-- evidence. The request is written in the transaction that ends the task and
-- delivered by the evidence-fence worker until Media confirms it.
-- Applied by the migration identity (cw_dispatch_migrate) as a separate job.
--
-- EXPAND ONLY: one new table. It is NOT the broker outbox, so the shared relay
-- never publishes these rows. A request is never dropped: a failure is kept
-- for the next attempt and only Media's 200 completes it.

-- CreateTable
CREATE TABLE "evidence_fence" (
    "evidence_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_by" TEXT,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" VARCHAR(64),
    "fenced_at" TIMESTAMPTZ(3),

    CONSTRAINT "evidence_fence_pkey" PRIMARY KEY ("evidence_id"),
    CONSTRAINT "evidence_fence_attempts_ck" CHECK ("attempts" >= 0)
);

-- CreateIndex
CREATE INDEX "evidence_fence_due_idx" ON "evidence_fence"("fenced_at", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "evidence_fence" ADD CONSTRAINT "evidence_fence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "task_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_fence" ADD CONSTRAINT "evidence_fence_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No delete; identity columns immutable; a confirmed fence is final.
CREATE FUNCTION "app"."dispatch_evidence_fence_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'EVIDENCE_FENCE_NO_DELETE' USING ERRCODE = '23514';
    END IF;
    IF NEW."evidence_id" IS DISTINCT FROM OLD."evidence_id"
       OR NEW."task_id" IS DISTINCT FROM OLD."task_id"
       OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
        RAISE EXCEPTION 'EVIDENCE_FENCE_IMMUTABLE_FIELD' USING ERRCODE = '23514';
    END IF;
    IF OLD."fenced_at" IS NOT NULL THEN
        RAISE EXCEPTION 'EVIDENCE_FENCE_FINAL' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "evidence_fence_guard" BEFORE UPDATE OR DELETE ON "evidence_fence"
    FOR EACH ROW EXECUTE FUNCTION "app"."dispatch_evidence_fence_guard"();

REVOKE ALL ON FUNCTION "app"."dispatch_evidence_fence_guard"() FROM PUBLIC;
