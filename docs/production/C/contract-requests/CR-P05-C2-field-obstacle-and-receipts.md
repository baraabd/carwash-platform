# CR-P05-C2 — technician field obstacles and cash-receipt history (requests to Lanes D, B and E)

Requester: Lane C (P05-C / C2, operator-web). Lane C does not edit Support, Billing,
`packages/contracts` or the gateway. Until these are merged and published, operator-web
keeps the existing behaviour and claims nothing more.

## 1. Field obstacle case (Lane D owner: Support; Lane E: contract)

Observed on `main@3e1ab23`: Support (#126) opens staff-desk cases only —
`PAYMENT_REVIEW | REFUND | LATE_PAYMENT | BOOKING_CANCELLATION | BOOKING_RESCHEDULE`,
subjects `billing.payment-attempt | billing.obligation | booking`, desks
`FINANCE | OPERATIONS`. There is no technician-raised case and no published Support
contract in `packages/contracts`. operator-web therefore keeps obstacles on the
Dispatch task notes (`HELP`, `PAYMENT_FOLLOW_UP`), which are visible to operations but are
not a tracked case.

Requested (Support, then published by E):

- kind `FIELD_OBSTACLE` (desk `OPERATIONS`), subject `dispatch.task` (task id), reasons
  `CUSTOMER_ABSENT | ACCESS_BLOCKED | UNSAFE_LOCATION | VEHICLE_MISMATCH |
  EQUIPMENT_FAILURE | WEATHER | OTHER`, optional evidence `media.object` references
  (WORK_EVIDENCE purpose, owner-checked by Media), free text <= 500 chars (never logged);
- opener: the assigned technician (`work.execute:assigned`), object check: Support asks
  Dispatch that the caller holds the task (published `dispatch.v1` read, service scope);
- `Idempotency-Key` on open; one open obstacle case per task; read of own cases;
- gateway routes `POST /api/operator/tasks/:taskId/obstacles`, `GET /api/operator/obstacles`.

## 2. Cash-receipt history for the technician (Lane B owner: Billing; Lane E: contract)

`billing.v1` publishes `getMyCustody` (balances) and `getCashReceipt` by id, but no list of
the technician's own receipts. operator-web shows the custody balance (PN-04) and keeps the
per-job list from Dispatch collection declarations, labelled as declarations, not receipts.

Requested: `GET /cash-receipts?collector=me&cursor&limit` (access
`permission:billing.cash.collect`, own receipts only, keyset page, closed
`CashReceiptV1` items), and the gateway route `GET /api/operator/cash-receipts`.

## 3. Resumable evidence upload (Media owner: Lane C; contract: Lane E)

Not requested now: the S3 adapter performs single presigned PUTs (photos are <= 850 kB
after local processing), so re-PUT on the same reservation is the resume unit. A multipart
protocol would need a `media.v1` change and is out of P05-C scope.
