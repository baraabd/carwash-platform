-- P06-CLOSE-07 (CR-P08-C1, finding OPS-F01 / B-07-01): a claim holder revokes
-- the uploader's user access to an object it claimed. Expand only: a new
-- append-only table; object_claim and its append-only guard are unchanged.
-- Applied by the migration identity (cw_media_migrate) as a separate job.

-- CreateTable
CREATE TABLE "object_owner_fence" (
    "object_id" UUID NOT NULL,
    "claim_ref" UUID NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "object_owner_fence_pkey" PRIMARY KEY ("object_id", "claim_ref"),
    CONSTRAINT "object_owner_fence_reason_ck" CHECK ("reason" IN ('TASK_ENDED'))
);

-- AddForeignKey: a fence always names an existing claim.
ALTER TABLE "object_owner_fence" ADD CONSTRAINT "object_owner_fence_claim_fkey" FOREIGN KEY ("object_id", "claim_ref") REFERENCES "object_claim"("object_id", "claim_ref") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A fence is never lifted: access is not re-granted by any route.
CREATE FUNCTION "object_owner_fence_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'OWNER_FENCES_ARE_APPEND_ONLY' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "object_owner_fence_append_only_trg"
    BEFORE UPDATE OR DELETE ON "object_owner_fence"
    FOR EACH ROW EXECUTE FUNCTION "object_owner_fence_append_only"();

REVOKE ALL ON FUNCTION "object_owner_fence_append_only"() FROM PUBLIC;
