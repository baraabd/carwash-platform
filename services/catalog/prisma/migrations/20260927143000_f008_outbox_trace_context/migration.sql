-- F008: technical transport context only. Existing rows remain valid with NULL.
ALTER TABLE "app"."outbox_message" ADD COLUMN "trace_parent" VARCHAR(55);
