-- Expand only: keep legacy contact data, widen the canonical V1 display name,
-- and record service snapshot reads without manufacturing an Identity user.
ALTER TABLE "customer_profile" ALTER COLUMN "display_name" TYPE VARCHAR(80);

ALTER TABLE "audit_entry"
  ALTER COLUMN "actor_subject" DROP NOT NULL,
  ALTER COLUMN "actor_session_id" DROP NOT NULL,
  ADD COLUMN "actor_service" VARCHAR(64),
  ADD COLUMN "actor_purpose" VARCHAR(32);

ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actor_shape" CHECK (
  (
    "actor_subject" IS NOT NULL AND "actor_session_id" IS NOT NULL
    AND "actor_service" IS NULL AND "actor_purpose" IS NULL
  ) OR (
    "actor_subject" IS NULL AND "actor_session_id" IS NULL
    AND "actor_service" IS NOT NULL AND "actor_purpose" IS NOT NULL
    AND "actor_service" ~ '^[a-z][a-z0-9-]{1,63}$'
    AND "actor_purpose" IN ('booking-quote', 'booking-create', 'booking-display')
  )
);
-- The append-only trigger and existing runtime grants remain in force.
-- No down migration: shrinking names or discarding service audit facts would
-- lose data and requires a separately reviewed retention/migration plan.
