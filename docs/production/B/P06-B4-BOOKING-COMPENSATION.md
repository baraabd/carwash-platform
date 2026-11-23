# Booking / Billing creation and compensation boundary

Status: implemented candidate; canonical acceptance and deployment verification remain required. This document does not promote either service's `BUSINESS_READY` or declare checkout complete.

## Published owner protocol

| Operation | Route | Authority and result |
| --- | --- | --- |
| Create | `POST /internal/v1/billing/booking-obligations` | Workload scope `billing.obligation.write`; beneficiary, quote and booking are immutable binding inputs. Pricing supplies the amount. Returns canonical `ObligationV1`. |
| Compensate unknown create | `POST /internal/v1/billing/booking-obligations/compensations` | Same workload scope; closed `{bookingId, beneficiary, quoteId, reason: "BOOKING_FAILED"}` body and mandatory idempotency key. Returns canonical `BookingCompensationV1`. |
| Read existing obligation | `GET /internal/v1/billing/bookings/:bookingId/obligation` | Exact current principal kind and subject plus `bookings.read:self`. Foreign and absent bookings return 404. No Finance override on this customer route. |
| Browser read | `GET /api/v1/customer/bookings/:id/obligation` | Gateway forwards the caller's own identity to the Billing read above. It creates nothing and never substitutes zero money for a missing obligation. |
| Existing compatibility command | `POST /internal/v1/billing/booking-obligations/:obligationId/void` | Existing workload and revision contract remains served. |

Both workload commands refuse a human Authorization header or Cookie alongside the service credential. The beneficiary is not a user authentication mechanism; authority comes from the independently verified workload scope. The persistent link/fence records the creating/compensating client and exact beneficiary and quote binding.

Booking uses a stable `booking-obligation-<bookingId>` creation key and a separate stable `booking-void-<bookingId>` compensation key. It accepts creation only after the shared parser validates the complete response and its quote and exact Money match the captured Booking snapshot. Compensation success requires a complete, exact-bound receipt. A missing route, 404, timeout, malformed reply or unavailable Billing never proves that a financial effect did not happen.

## What a compensation receipt means

`ABSENT_FENCED` means no obligation was linked to this booking when the creation barrier committed. Its obligation id and revision are both null. Billing writes only the immutable fence and command receipt: it does not invent an invoice, money journal, payment, financial audit event or outbox event.

`VOIDED` names the actual linked obligation and its resulting revision. Billing applies the existing `planVoid` rule under its obligation lock: the obligation must be unpaid and no payment attempt may have been reported. Its existing journal, audit, outbox and link stamp commit atomically with the fence. A reported payment causes refusal and leaves compensation pending for operational resolution; the saga never fabricates a refund or labels that refusal successful.

An already completed legacy void may acquire the matching fence without repeating its financial effects. Different workload, quote or beneficiary binding cannot adopt either an existing booking obligation or its fence.

## Races and unknown responses

Creation validates Pricing before acquiring database locks. Inside its final local transaction it acquires the advisory lock `billing-booking:<canonical UUID>`, rechecks the immutable fence, and only then creates the receivable, booking link, journal, audit, outbox and idempotency receipt. Compensation acquires that same booking lock before checking the link or writing a fence. A delayed Pricing response therefore cannot insert a receivable after an absent fence commits.

Migration `20261122170000_booking_compensation_fence` adds an insert guard to `booking_obligation` using the same advisory lock. This also refuses an older writer that ignores the application-level fence; its entire transaction rolls back. The new table is append-only. Its insert guard refuses `ABSENT_FENCED` when a booking link exists, and refuses `VOIDED` unless the named obligation, beneficiary, quote, client, revision and actual void stamp match persisted facts.

An original successful create key retains its original receipt after later compensation. Replaying it returns historical evidence and performs no mutation. New create keys after a fence are refused with `BOOKING_COMPENSATED`. The Booking process manager's lease/fence check prevents a delayed worker holding that historical reply from recording a new pivot or confirming a booking already compensated by a newer worker. Compensation delivery may itself be lost; the saga remains pending and retries the same command until it recovers the durable receipt.

## Deployment order and rollback boundary

1. Apply the additive Billing migration using its migration identity; provision the normal runtime grants for the new table. Do not reset the database or rewrite previous migrations.
2. Deploy Billing with the new compensation and read routes, then deploy Booking's corrected workload adapter and the Gateway read alias. Configure the existing per-owner workload credentials and Billing's Pricing credential through normal secret configuration.
3. Confirm canonical acceptance for this exact source and that the deployed service credentials select the intended workload id/scope. Quote/Hold contract changes in the coordinated capacity slice have their own joint rollout requirement.

Deploying Booking before the new Billing route fails closed: compensation remains pending. A missing/unconfigured credential also fails closed. The old id-based void remains available for compatibility. After any fence exists, do not drop the table or remove its guards as a code rollback: that would permit late financial creation for compensated bookings. Roll back by retaining the migration and serving owner boundary, and disabling new Booking writes if recovery is necessary. Any later data retirement needs an explicit reviewed migration.

## Evidence and limits

- `services/billing/test/integration/billing.booking-saga.postgres.spec.ts` uses two real Billing HTTP replicas and least-privilege PostgreSQL roles. It checks absent fences, slow Pricing races, committed-create compensation, duplicate commands, exact bindings, payment refusal, owner reads and database guards. Identity and Pricing are explicitly HTTP doubles there.
- `tests/production/A/booking-billing.integration.test.mjs` uses the real Identity, Redis, Gateway, Booking and Billing implementations. The transport fault proxy discards or delays actual Billing replies; it never manufactures success. It checks owner isolation, revocation, lost-create recovery, a stale worker after compensation, unavailable/lost compensation, and mixed human/workload refusal. Pricing, Scheduling and saved-address resolution remain explicit HTTP doubles, so this is not complete checkout or live capacity/payment evidence.
- Shared contract parsers and real HTTP adapter regressions reject incomplete, inconsistent and foreign receipts. Existing legacy tests remain in place.
- Local PostgreSQL 17 / Redis 8.0 diagnostics are supplemental. Canonical CI uses the repository's pinned PostgreSQL 16.10 / Redis 8.2 images and must pass on the integrated commit before final acceptance.

Customer checkout integration, actual merchant capabilities and full production operation remain separately tracked. This change repairs the Booking/Billing boundary; it does not authorize design changes or mark the full P02/P04/P06 production scope complete.
