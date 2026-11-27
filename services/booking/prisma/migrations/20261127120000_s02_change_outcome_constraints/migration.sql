-- A refused cancellation never reaches financial settlement. Preserve that
-- absence instead of making its definitive Dispatch refusal impossible to save.
-- Staff reschedules are already authenticated and authorized by ChangeService;
-- the persisted requester must keep the real staff identity for audit/replay.
ALTER TABLE "booking_change" DROP CONSTRAINT "booking_change_settlement_ck";
ALTER TABLE "booking_change" ADD CONSTRAINT "booking_change_settlement_ck" CHECK (
  (kind = 'RESCHEDULE' AND settlement IS NULL)
  OR (kind = 'CANCELLATION' AND (
    (outcome IS NOT NULL AND outcome IN ('REFUSED', 'FAILED') AND settlement IS NULL)
    OR ((outcome IS NULL OR outcome = 'COMPLETED') AND settlement IS NOT NULL AND settlement IN (
      'PENDING', 'VOIDED', 'REFUND_PENDING', 'NOTHING_DUE', 'ENTITLEMENT_RELEASED'
    ))
  ))
);

ALTER TABLE "booking_change" DROP CONSTRAINT "booking_change_requester_ck";
ALTER TABLE "booking_change" ADD CONSTRAINT "booking_change_requester_ck"
  CHECK (requester_kind IN ('account', 'guest', 'staff'));
