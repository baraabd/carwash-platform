# P02-E1 — Booking and Billing contracts and P02 contract requests

Lane E, child sprint 1 of P02-E. Base: `566d2e7435dac0803d075556fff43c435f8a29a7`
(tree `1bd162f2578878643b3e2c2cc437fece36716588`).

This PR publishes contracts. It does not implement a provider. It gives:
- Lane C (Booking) and Lane B (Billing) a reviewed, versioned wire to build against;
- the Gateway (P02-E3) and the combined acceptance (P02-E4) the metadata they consume.

Every addition has status `published-provider-pending` or `published-producer-pending`.
Nothing here claims that a booking can be created.

## Contract requests reconciled

| Request | Decision in this PR |
| --- | --- |
| **CR-B-01** billing.v1 (Lane B, PR #106) | Published as **Lane B's implemented shape**: obligation, payment intent, attempt and Finance reconciliation, with the same routes and names. Lane E adds the shared error envelope, owner `reasons` and parser invariants. Lane B's codes `IDEMPOTENCY_KEY_INVALID` and `AUTH_UNAVAILABLE` are not shared codes; map them to `REQUEST_INVALID` (400) and `DEPENDENCY_UNAVAILABLE` (503). |
| **CR-B-02** billing events | `billing.obligation-created.v1` and `billing.obligation-status-changed.v1`, exactly as Lane B's outbox writes them. |
| **CR-B-03.2** booking-saga scope | `service:billing.obligation.write` routes `createBookingObligation` and `voidBookingObligation`. They are published here; Lane B implements them. The Identity grant to `booking` follows after this merges, because P02-E2 can grant only scopes that a merged contract declares. |
| **CR-B-03.1** `billing.reconcile` | Declared here as the access of `reconcileAttempt`. Identity issues it in P02-E2. |
| **CR-P02-C1 §3** commitment cancellation | `scheduling.v1` `cancelCommitment` (`POST /holds/:holdId/cancel`, `service:scheduling.hold.commit`, idempotent). This is additive. |
| **CR-P02-C1 §5** | `HOLD_LIMIT_REACHED` added to the `scheduling.v1` reasons. |
| **CR-B-04/05, CR-P02-C1 §1, CR-P02-C3 §2** | Dependency and lockfile changes, owner by owner. Not in this PR: each one lands with the owner change that uses it. |
| **CR-P02-C3** dispatch.v1 and `dispatch.assignment-changed.v1` | Not in this PR. Dispatch is outside the P02 booking-creation path; it gets its own Lane E contract PR. |

The payment-method names follow the Billing provider: `CASH_ON_COMPLETION`, `SHAM_CASH`, `SYRIATEL_CASH`.

## Versions

| Package | Version | Change |
| --- | --- | --- |
| `@carwash/contracts` | 0.1.0 → 0.2.0 | Adds `./booking-v1` and `./billing-v1`. Adds shared `PAYMENT_METHODS` and `parseSyrianMobile` in `./common`. Additive `scheduling.v1` route and reason. |
| `@carwash/event-contracts` | 0.1.0 → 0.2.0 | Adds `./booking-billing-v1` (four events) and `BUSINESS_EVENTS` (every envelope-v2 event). The registry schema version is taken from the event-type suffix. |
| `@carwash/api-clients` | 0.1.0 → 0.2.0 | Typed booking and billing calls. They parse the request before sending and validate the response. |

All changes are additive. The surface lock gains entries and loses none, which the
compatibility gate proves. `pnpm-lock.yaml` is unchanged.

## booking.v1 (owner: Booking, Lane C)

| Route | Access | Notes |
| --- | --- | --- |
| `POST /bookings` | principal, idempotent | Creates the booking from a quote, a hold and a serviceability decision. The beneficiary is the authenticated principal (account **or guest**); a `beneficiary` body field is refused. |
| `GET /bookings` | principal, paged | Summary list without contact, address or notes. |
| `GET /bookings/:bookingId` | principal | The full, immutable booking. |
| `POST /bookings/:bookingId/cancel` | principal, idempotent | Body: `{expectedRevision, reason: 'CUSTOMER_REQUEST'}`. |
| `GET /bookings/:bookingId/repeat-draft` | principal | Details only. There is no time, hold or quote (approved repeat-booking rule). |

Mapping to the seven approved screens. No screen is merged or added.

| Screen | Request field |
| --- | --- |
| 1 السيارة | `vehicle`: a saved `{vehicleId, expectedRevision}` or an inline one-time vehicle. The plate is optional. |
| 2 العناية | `quoteRef`: the Pricing quote for the selected package and extras. |
| 3 المكان | `address` (saved or inline; pin or manual description) plus `serviceability {decisionId, expectedZoneRevision, point}`. |
| 4 الموعد | `holdRef`: the Scheduling hold of the chosen slot. |
| 5 بياناتك | `contact {displayName, phone}`, `notes`. |
| 6 الدفع | `paymentMethod` (`CASH_ON_COMPLETION`, `SHAM_CASH`, `SYRIATEL_CASH`). |
| 7 التأكيد | `customerConfirmed: true`, the explicit confirmation. Anything else is refused. |

**Saga (owner: Booking).** Steps run in this order:
1. Validate the quote.
2. Capture the snapshots.
3. Re-validate serviceability.
4. Create the Billing obligation.
5. Commit the hold, **last**.

Compensation:
- A failure before the commit releases the hold and voids the obligation.
- An unknown commit outcome leaves the booking `PENDING`; Booking reconciles it.
- After a commit, `cancelCommitment` returns the unit.

Outcome semantics the owner must implement:
- **201 + `CONFIRMED`**: the commit succeeded.
- **202 + `PENDING`**: the outcome is unknown. A timeout is never reported as `CONFIRMED`.
- **409/422 + reason**: the request was refused.
- **Same key and body**: the original outcome is replayed.

Parser invariants:
- `REJECTED` ⇔ `rejectionReason`.
- `CANCELLED` ⇔ `cancellation`.
- `confirmedAt` is set exactly for `CONFIRMED` and `CANCELLED`.
- `obligationId` is required for `CONFIRMED` and `CANCELLED`.
- The price copy adds up exactly.
- `price.vehicleType` equals the vehicle snapshot type.
- Inline snapshots carry no saved IDs.
- Every interval is positive.

## billing.v1 (owner: Billing, Lane B; from CR-B-01..03)

| Route | Access |
| --- | --- |
| `POST /obligations` | principal, idempotent (one per owner and quote; a repeat returns 200 with the existing obligation) |
| `GET /obligations/:obligationId` | principal (owner; the owner also allows `billing.read`) |
| `GET /obligations/:obligationId/financial-status` | principal |
| `POST /obligations/:obligationId/payment-intents` | principal, idempotent (choose a method) |
| `POST /obligations/:obligationId/payment-attempts` | principal, idempotent (report the wallet reference; result is `UNDER_REVIEW`) |
| `POST /obligations/:obligationId/void` | principal, idempotent |
| `POST /payment-attempts/:attemptId/reconciliation` | `permission:billing.reconcile`, idempotent; never the obligation's own owner |
| `POST /booking-obligations` | `service:billing.obligation.write`, idempotent (booking saga) |
| `POST /booking-obligations/:obligationId/void` | `service:billing.obligation.write`, idempotent (saga compensation) |

The parser re-checks Billing's derivation instead of trusting the field:
- `financialStatus` is derived from the obligation status, the active intent and any `UNKNOWN` attempt. A mismatch is `INCONSISTENT_FINANCIAL_STATUS`.
- `verified + outstanding = amount`, and outstanding is 0 once the obligation is voided.
- `PAID` holds only for a settled obligation with nothing outstanding.
- Each method accepts only its own intent states. Cash never has an attempt.
- Echoed references are masked (`…` plus the last 4 characters).
- Attempts are newest first, at most 5.
- `reconciledAt` is set exactly when Finance recorded an outcome.
- `MATCHED`/`MISMATCHED` require `observedAmount`; `UNKNOWN` forbids it.

**A customer action, receipt or reported reference never makes an obligation `PAID`.**

Transfer instructions (payee, QR) are not part of v1. No merchant account is
configured, and Billing never invents a payee or a QR payload (DESIGN_LOCK §5,
ADR 0004). The QR card stays a design element with no live data until a merchant
decision exists.

Prototype → contract (financial status):

| Prototype | `financialStatus` |
| --- | --- |
| `cash_due` | `AWAITING_CASH` |
| `awaiting_transfer` | `AWAITING_PAYMENT` |
| `awaiting_review` / `proof_submitted_demo` | `UNDER_REVIEW` |
| `needs_review` | `AWAITING_PAYMENT` after a `MISMATCHED` attempt, or `OUTCOME_UNKNOWN` |
| `paid_demo` | `PAID` (Finance-matched only) |
| `cancelled_before_transfer` | `VOIDED` |
| `cash_collected_demo` | Not a Billing state in v1. Field cash collection belongs to Dispatch/operator work (P03). |

## Events (envelope v2, `docs/asyncapi/business-events-p02.yaml`)

| Event | Producer | Aggregate | Data |
| --- | --- | --- | --- |
| `booking.confirmed.v2` | booking | booking | Beneficiary ref, obligationId, holdId, zoneId, startsAt/endsAt, quoteId/revision, paymentMethod, currency, totalMinor. |
| `booking.cancelled.v1` | booking | booking | Beneficiary ref, holdId, reason, cancelledAt. |
| `billing.obligation-created.v1` | billing | billing-obligation | quoteId, amount (Money), financialStatus. |
| `billing.obligation-status-changed.v1` | billing | billing-obligation | Previous and current financialStatus (they must differ), verified, outstanding. `PAID` ⇔ nothing outstanding. |

**Data never carries contact, address, vehicle, plate or provider-reference data.**
`booking.confirmed.v1` (envelope v1, account-only) is unchanged; `booking.confirmed.v2`
is its guest-capable successor. The tests check that the event vocabularies (methods,
financial statuses, currency scales) equal the HTTP contracts'.

## Consumers and next steps

- **Lane C (Booking):** implement `booking.v1` with the saga above, a local transaction and an outbox.
- **Lane C (Scheduling):** implement `cancelCommitment` and emit `HOLD_LIMIT_REACHED`.
- **Lane B (Billing):** implement `createBookingObligation` and `voidBookingObligation`, and map the two non-shared error codes.
- **Lane E:**
  - P02-E2: Identity workload identity, `billing.reconcile`, then the `booking → billing.obligation.write` grant.
  - P02-E3: Gateway routes derived from these contracts.
  - P02-E4: combined real acceptance.

The provider conformance gaps found on `main` are listed in
`docs/production/E/P02-E_PROVIDER_CONFORMANCE.md`.

## Evidence

The exact commands and results are in the PR body. The contract tests run against the
**built** packages. The client tests use a real `node:http` server and real `fetch`.
No database, broker or owner provider is involved: no provider for these contracts is
merged yet.
