-- Billing's published CASH_COLLECTED means the receivable is settled by an
-- authorized receipt. It says nothing about treasury custody or settlement.
ALTER TABLE "ops_obligation" DROP CONSTRAINT "ops_obligation_state_known";
ALTER TABLE "ops_obligation"
  ADD CONSTRAINT "ops_obligation_state_known" CHECK ("cash_state" IN (
    'UNPAID', 'AWAITING_CASH', 'AWAITING_PAYMENT', 'UNDER_REVIEW',
    'OUTCOME_UNKNOWN', 'PAID', 'CASH_COLLECTED', 'VOIDED'));

ALTER TABLE "ops_obligation" DROP CONSTRAINT "ops_obligation_closed_settled";
ALTER TABLE "ops_obligation"
  ADD CONSTRAINT "ops_obligation_closed_settled" CHECK (
    "cash_state" NOT IN ('PAID', 'CASH_COLLECTED', 'VOIDED') OR "outstanding_minor" = 0);
