-- P04-C1: a committed booking may be cancelled or moved to another hold.
-- Applied by the migration identity (cw_scheduling_migrate) as a separate job.
--
-- Before: capacity_hold_booking_id_key made booking_id unique over CONFIRMED
-- AND CANCELLED rows, so a booking whose commitment was given back could never
-- commit another hold, and a reschedule was impossible.
--
-- After: one CONFIRMED hold per booking (the live commitment). Any number of
-- CANCELLED rows may keep the booking_id as history.
--
-- Compatibility:
--   * the new index is created FIRST, so the invariant is enforced throughout;
--     every row that satisfied the old index satisfies the new one;
--   * code before P04-C1 only ever commits one hold per booking and maps a
--     unique violation to BOOKING_ALREADY_COMMITTED; it behaves the same under
--     the new index;
--   * the release-reason CHECK already allows BOOKING_CANCELLED and
--     RESCHEDULED (P02-C1); no CHECK changes.
-- Rollback: recreating the old index fails once a booking has a CANCELLED and
-- a CONFIRMED row; restore the old binary only (this index stays). No data is
-- rewritten or dropped.

CREATE UNIQUE INDEX "capacity_hold_booking_confirmed_key" ON "capacity_hold"("booking_id")
    WHERE "booking_id" IS NOT NULL AND "status" = 'CONFIRMED';

DROP INDEX "capacity_hold_booking_id_key";

-- Lookup of a booking's commitment history.
CREATE INDEX "capacity_hold_booking_id_idx" ON "capacity_hold"("booking_id")
    WHERE "booking_id" IS NOT NULL;
