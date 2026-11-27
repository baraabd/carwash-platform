-- Expand only: automatic policy/attempt history belongs exclusively to Dispatch.
CREATE TABLE "automatic_assignment_policy" (
  "assignment_id" UUID PRIMARY KEY REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "state" TEXT NOT NULL CHECK ("state" IN ('ACTIVE','PAUSED','EXHAUSTED')),
  "offered_count" INTEGER NOT NULL DEFAULT 0 CHECK ("offered_count" BETWEEN 0 AND 10),
  "failed_passes" INTEGER NOT NULL DEFAULT 0 CHECK ("failed_passes" BETWEEN 0 AND 20),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "automatic_assignment_attempt" (
  "assignment_id" UUID NOT NULL REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resource_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL UNIQUE REFERENCES "dispatch_offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("assignment_id","resource_id")
);
CREATE INDEX "automatic_assignment_policy_state_next_attempt_at_idx"
  ON "automatic_assignment_policy"("state","next_attempt_at");
-- Existing offers were explicitly created by operations: preserve that decision.
INSERT INTO "automatic_assignment_policy" (assignment_id,state,next_attempt_at,reason)
  SELECT a.id,'PAUSED',CURRENT_TIMESTAMP,'PREEXISTING_MANUAL_ASSIGNMENT'
    FROM "assignment" a WHERE EXISTS (SELECT 1 FROM "dispatch_offer" o WHERE o.assignment_id=a.id);
