-- P04-C2: Booking-requested changes to a booking's job (cancellation, rebind
-- to a new slot for a reschedule) and the work-progress gate.
-- Applied by the migration identity (cw_dispatch_migrate) as a separate job.
--
-- EXPAND ONLY with respect to running code:
--   * assignment.pending_change_id: new nullable column (NULL = binding final,
--     which is what every existing row is);
--   * CHECK constraints widened with new values only (every existing row stays
--     valid): assignment cancel reason BOOKING_CANCELLED, offer withdraw reason
--     and task end reason JOB_RESCHEDULED, idempotency result BOOKING_CHANGE,
--     audit target BOOKING;
--   * new table booking_change (+ indexes).
-- Nothing is dropped and no existing row is rewritten.
--
-- Invariants added HERE, not only in application code:
--   * a CANCELLED assignment is never pending a rebind;
--   * one cancellation record per booking, one rebind awaiting confirm/revert
--     per booking (partial UNIQUE);
--   * a rebind record carries both slots exactly when a rebind happened; a
--     cancellation carries none.

ALTER TABLE "assignment" ADD COLUMN "pending_change_id" UUID;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_pending_change_ck"
    CHECK ("pending_change_id" IS NULL OR "status" <> 'CANCELLED');

ALTER TABLE "assignment" DROP CONSTRAINT "assignment_cancel_ck";
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_cancel_ck" CHECK (
    ("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL)
    AND ("cancel_reason" IS NULL OR "cancel_reason" IN (
        'HOLD_RELEASED', 'HOLD_EXPIRED', 'BOOKING_CANCELLED'
    ))
);

ALTER TABLE "dispatch_offer" DROP CONSTRAINT "dispatch_offer_withdraw_ck";
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_withdraw_ck" CHECK (
    ("status" = 'WITHDRAWN') = ("withdraw_reason" IS NOT NULL)
    AND ("withdraw_reason" IS NULL OR "withdraw_reason" IN (
        'REASSIGNED', 'UNASSIGNED', 'JOB_CANCELLED', 'RELEASED_BY_TECHNICIAN',
        'RESOURCE_INELIGIBLE', 'JOB_RESCHEDULED'
    ))
);

ALTER TABLE "task" DROP CONSTRAINT "task_end_ck";
ALTER TABLE "task" ADD CONSTRAINT "task_end_ck" CHECK (
    ("stage" IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')) = ("ended_at" IS NOT NULL)
    AND ("stage" IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')) = ("end_reason" IS NOT NULL)
    AND ("end_reason" IS NULL OR "end_reason" IN (
        'RELEASED_BY_TECHNICIAN', 'REASSIGNED', 'UNASSIGNED', 'RESOURCE_INELIGIBLE',
        'JOB_CANCELLED', 'JOB_RESCHEDULED'
    ))
    AND (("stage" = 'RELEASED') = ("release_reason" IS NOT NULL))
    AND ("release_reason" IS NULL OR char_length(btrim("release_reason")) BETWEEN 3 AND 500)
);

ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_result_type_ck";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_result_type_ck"
    CHECK ("result_type" IN ('ASSIGNMENT', 'OFFER', 'TASK', 'BOOKING_CHANGE'));

ALTER TABLE "audit_entry" DROP CONSTRAINT "audit_entry_target_type_ck";
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_target_type_ck"
    CHECK ("target_type" IN ('ASSIGNMENT', 'OFFER', 'HOLD', 'TASK', 'RESOURCE', 'BOOKING'));

CREATE TABLE "booking_change" (
    "change_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "assignment_id" UUID,
    "from_hold_id" UUID,
    "from_starts_at" TIMESTAMPTZ(3),
    "from_ends_at" TIMESTAMPTZ(3),
    "to_hold_id" UUID,
    "to_starts_at" TIMESTAMPTZ(3),
    "to_ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_change_pkey" PRIMARY KEY ("change_id"),
    CONSTRAINT "booking_change_kind_ck" CHECK ("kind" IN ('CANCELLATION', 'REBIND')),
    CONSTRAINT "booking_change_state_ck" CHECK (
        ("kind" = 'CANCELLATION' AND "state" IN ('CANCELLED', 'NOT_OPENED'))
        OR ("kind" = 'REBIND' AND "state" IN ('REBOUND', 'CONFIRMED', 'REVERTED'))
    ),
    -- A rebind that happened carries both slots; a revert-first tombstone and
    -- a cancellation carry none.
    CONSTRAINT "booking_change_slots_ck" CHECK (
        ("from_hold_id" IS NULL) = ("from_starts_at" IS NULL)
        AND ("from_hold_id" IS NULL) = ("from_ends_at" IS NULL)
        AND ("from_hold_id" IS NULL) = ("to_hold_id" IS NULL)
        AND ("to_hold_id" IS NULL) = ("to_starts_at" IS NULL)
        AND ("to_hold_id" IS NULL) = ("to_ends_at" IS NULL)
        AND ("kind" = 'REBIND' OR "from_hold_id" IS NULL)
        AND ("kind" <> 'REBIND' OR "state" = 'REVERTED' OR "from_hold_id" IS NOT NULL)
        AND ("from_ends_at" IS NULL OR "from_ends_at" > "from_starts_at")
        AND ("to_ends_at" IS NULL OR "to_ends_at" > "to_starts_at")
    ),
    CONSTRAINT "booking_change_assignment_ck" CHECK (
        "state" = 'NOT_OPENED' OR "kind" = 'REBIND' OR "assignment_id" IS NOT NULL
    )
);

ALTER TABLE "booking_change" ADD CONSTRAINT "booking_change_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "booking_change_one_cancellation_key" ON "booking_change"("booking_id")
    WHERE "kind" = 'CANCELLATION';
CREATE UNIQUE INDEX "booking_change_one_pending_rebind_key" ON "booking_change"("booking_id")
    WHERE "kind" = 'REBIND' AND "state" = 'REBOUND';
CREATE INDEX "booking_change_booking_id_idx" ON "booking_change"("booking_id");
