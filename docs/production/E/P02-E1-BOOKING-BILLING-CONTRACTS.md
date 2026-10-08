# P02-E1 — Booking and Billing contracts (booking.v1, billing.v1, P02 events)

Lane E, child sprint 1 of P02-E. Base: `566d2e7435dac0803d075556fff43c435f8a29a7`
(tree `1bd162f2578878643b3e2c2cc437fece36716588`).

This is a contract publication PR, not a provider implementation. It gives Lane C
(Booking) and Lane B (Billing) a reviewed, versioned wire to implement against,
and gives the Gateway (P02-E3) and the combined acceptance (P02-E4) the metadata
they consume. Status of every addition: `published-provider-pending` /
`published-producer-pending`. Nothing here claims a booking can be created.

## Versions

| Package | Version | Change |
| --- | --- | --- |
| `@carwash/contracts` | 0.1.0 → 0.2.0 | `./booking-v1`, `./billing-v1`; shared `PAYMENT_METHODS` and `parseSyrianMobile` in `./common` |
| `@carwash/event-contracts` | 0.1.0 → 0.2.0 | `./booking-billing-v1` (three events), `BUSINESS_EVENTS` (all envelope-v2 events), registry schema version taken from the event type suffix |
| `@carwash/api-clients` | 0.1.0 → 0.2.0 | Typed booking/billing calls that parse the request before sending and validate the response |

All changes are additive. `architecture/contract-surface.lock.json` gains entries
and loses none; the compatibility gate proves it. `pnpm-lock.yaml` is unchanged.

## booking.v1 (owner: Booking, Lane C)

| Route | Access | Notes |
| --- | --- | --- |
| `POST /bookings` | principal, idempotent | Create from quote + hold + serviceability decision. Beneficiary = authenticated principal (account **or guest**); a `beneficiary` body field is refused. |
| `GET /bookings` | principal, paged | Summary list without contact/address/notes. |
| `GET /bookings/:bookingId` | principal | Full immutable booking. |
| `POST /bookings/:bookingId/cancel` | principal, idempotent | `{expectedRevision, reason: 'CUSTOMER_REQUEST'}`. |
| `GET /bookings/:bookingId/repeat-draft` | principal | Details only: no time, hold or quote (approved repeat-booking rule). |

Mapping to the seven approved screens (no screen is merged or added):

| Screen | Request field |
| --- | --- |
| 1 السيارة | `vehicle` — saved `{vehicleId, expectedRevision}` or inline one-time vehicle; plate optional |
| 2 العناية | `quoteRef` — the Pricing quote for the selected package/extras |
| 3 المكان | `address` (saved or inline, pin or manual description) + `serviceability {decisionId, expectedZoneRevision, point}` |
| 4 الموعد | `holdRef` — the Scheduling hold of the chosen slot |
| 5 بياناتك | `contact {displayName, phone}`, `notes` |
| 6 الدفع | `paymentMethod` (`CASH_AFTER_SERVICE`, `SHAM_CASH`, `SYRIATEL_CASH`) |
| 7 التأكيد | `customerConfirmed: true` — the explicit confirmation; anything else is refused |

Outcome semantics the owner must implement:

- **201 + `CONFIRMED`**: quote validated with Pricing, snapshots captured, hold committed in Scheduling.
- **202 + `PENDING`**: the hold commit outcome is unknown (timeout). Booking reconciles it, and the client polls. A timeout is never reported as `CONFIRMED`.
- **409/422 + reason**: refused (`QUOTE_EXPIRED`, `HOLD_EXPIRED`, `NOT_SERVICEABLE`, …). No capacity stays held.
- **Same Idempotency-Key + same body** replays the stored outcome. A different body gets `IDEMPOTENCY_CONFLICT`.

Wire invariants checked by the parser:
- `REJECTED` ⇔ `rejectionReason`, and `CANCELLED` ⇔ `cancellation`.
- `confirmedAt` is set exactly for `CONFIRMED`/`CANCELLED`, so only a confirmed booking is ever cancelled.
- The price copy adds up exactly in bigint minor units.
- `price.vehicleType` equals the vehicle snapshot type.
- Inline snapshots never carry saved IDs.
- The interval is positive.

## billing.v1 (owner: Billing, Lane B)

| Route | Access | Notes |
| --- | --- | --- |
| `GET /bookings/:bookingId/payment` | principal | The payment record of the caller's booking. |
| `POST /payments/:paymentId/transfer-proofs` | principal, idempotent | `{expectedRevision, transactionReference}` → `AWAITING_REVIEW`. Never `PAID`. |
| `GET /payments/review-queue` | `permission:billing.payments.verify`, paged | Finance queue without customer contact data. |
| `POST /payments/:paymentId/review` | `permission:billing.payments.verify`, idempotent | `CONFIRM_RECEIVED` requires a `statementReference`; `REJECT` requires a closed reason. Self-review is an owner refusal (`SELF_REVIEW_FORBIDDEN`). |

Billing creates the payment record from `booking.confirmed.v2`; no client creates
one. The states follow the approved prototype vocabulary:

| Prototype state | Contract state |
| --- | --- |
| `cash_due` | `CASH_DUE` |
| `cash_collected_demo` | `CASH_COLLECTED` |
| `awaiting_transfer` | `AWAITING_TRANSFER` |
| `awaiting_review` / `proof_submitted_demo` | `AWAITING_REVIEW` |
| `paid_demo` | `PAID` |
| `needs_review` | `AWAITING_TRANSFER` with `lastRejection` |
| `cancelled_before_transfer` | `CANCELLED` |

The parser enforces:
- each method allows only its own states;
- `PAID` needs a proof and a server `paidAt`;
- cash never has transfer or proof data.

**Transfer instructions** are returned only when a real merchant account is
configured (`availability: AVAILABLE`). Until then they are
`MERCHANT_NOT_CONFIGURED` with `instructions: null`. Billing never invents a payee
or a QR payload. This keeps the approved QR card shape without fabricating a
money flow (DESIGN_LOCK §5, ADR 0004).

`billing.payments.verify` is a new permission name. Identity issues it in P02-E2
(finance role). Until that change merges, no caller can hold it, so the review
routes deny by default.

## Events (envelope v2, `docs/asyncapi/business-events-p02.yaml`)

| Event | Producer | Aggregate | Data |
| --- | --- | --- | --- |
| `booking.confirmed.v2` | booking | booking | beneficiary ref, holdId, zoneId, startsAt/endsAt, quoteId/revision, paymentMethod, currency, totalMinor |
| `booking.cancelled.v1` | booking | booking | beneficiary ref, holdId, reason, cancelledAt |
| `billing.payment-state-changed.v1` | billing | payment | bookingId, method, state, currency, amountMinor |

None carries contact, address, vehicle, plate or proof data. `booking.confirmed.v1`
(envelope v1, account-only `customerId`) is unchanged for existing consumers.
`booking.confirmed.v2` is its guest-capable successor. The event-contract
vocabularies (methods, states, currencies) are tested for equality with the HTTP
contracts.

## Consumers and next steps

- **Lane C (Booking):**
  - implement `booking.v1`;
  - commit holds through `scheduling.v1` `commitHold`;
  - validate with `pricing.v1` `validateQuote`, `geo.v1` `validateDecision` and the customer/vehicle snapshot routes;
  - local transaction + outbox for `booking.confirmed.v2` and `booking.cancelled.v1`;
  - compensation: release the hold with `BOOKING_FAILED`.
- **Lane B (Billing):**
  - implement `billing.v1`;
  - an inbox consumer of `booking.confirmed.v2` / `booking.cancelled.v1`;
  - an outbox for `billing.payment-state-changed.v1`.
- **P02-E2:** Identity workload identity (service scopes) and `billing.payments.verify`.
- **P02-E3:** Gateway routes for every `principal`/`public`/`permission:` route of the published contracts. `service:` routes are never exposed.
- **P02-E4:** combined real acceptance.

Provider conformance gaps found while auditing P01 are listed in
`docs/production/E/P02-E_PROVIDER_CONFORMANCE.md`. They block the real booking
path independently of this PR.

## Evidence

Exact commands and results are in the PR body. All contract tests run against
the **built** packages. The client tests use a real `node:http` server and real
`fetch`. No database, broker or owner provider is involved, because none is
implemented for these contracts yet.
