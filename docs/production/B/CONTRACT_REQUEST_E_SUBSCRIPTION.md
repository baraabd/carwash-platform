# Contract request to Lane E — Subscription (CR-B-10)

Requester: Lane B (P05-B1). Status: **SUBMITTED, not accepted**. Subscription
consumes nothing that E has not published. Until each item below is published,
the corresponding path fails closed. No shared package, lockfile, Gateway route,
CI or infra file was edited by Lane B.

## CR-B-10.1 Identity permission `subscription.manage`

Add `subscription.manage` to `IDENTITY_PERMISSIONS` (`packages/contracts/src/identity.ts`)
and grant it to the finance/operations staff roles the owner names.

- **Gates:**
  - plan revision publication;
  - plan reads;
  - activation, renewal, freeze, unfreeze and cancel by staff;
  - reversal of a consumed unit;
  - the customer subscription list for staff;
  - the entitlement ledger.
- **Until granted:** every staff call returns 403.
- **Separation of duties is enforced by Subscription itself:** staff can never activate, renew, freeze, cancel or reverse on their own subscription (`403 SELF_SERVICE_FORBIDDEN`).

Customers use the existing `bookings.create:self` grant. Guests are refused, because B-15 is open.

## CR-B-10.2 `subscription.v1` HTTP contract (owner routes as implemented)

Prefix `/internal/v1/subscription`. Money uses the published convention
`{ currency, amountMinor, scale }`. Timestamps are canonical UTC with milliseconds.

| Route | Access | Notes |
| --- | --- | --- |
| `POST /plans/:code/revisions` | `subscription.manage`, Idempotency-Key | `{ expectedRevision, effectiveFrom \| null, terms }` |
| `GET /plans`, `GET /plans/:code` | `subscription.manage` | Revisions with effective windows. |
| `GET /offers` | `bookings.create:self` | The revision in force, if available. |
| `POST /subscriptions` | `bookings.create:self` (account only), Idempotency-Key | `{ planCode }`, giving `PENDING_ACTIVATION`. |
| `GET /subscriptions`, `GET /subscriptions/:id` | owner, or `subscription.manage` | A non-owner gets 404. |
| `POST /subscriptions/:id/{activate,renew}` | `subscription.manage`, Idempotency-Key | `{ expectedVersion, paymentReference }` |
| `POST /subscriptions/:id/{freeze,unfreeze,cancel}` | `subscription.manage` (customer: cancel of their own pending request only) | Optimistic on `expectedVersion`. |
| `GET /customers/:subject/subscriptions` | `subscription.manage` | |
| `GET /subscriptions/:id/ledger` | `subscription.manage` | Reconciliation: counters against movements. |
| `POST /reservations` | service `subscription.entitlement.reserve` | `{ subscriptionId, bookingId, customerSubject, packageId, scheduledFor }` |
| `GET /reservations?bookingId=` | service `subscription.entitlement.reserve` | Saga recovery. |
| `POST /reservations/:id/commit`, `/release` | service `subscription.entitlement.settle` | `release` takes `{ reason }`. |
| `POST /reservations/:id/reverse` | `subscription.manage`, Idempotency-Key | `{ reason }` |

**Error codes** are closed. They are listed in
`services/subscription/src/application/subscription-errors.ts`.

## CR-B-10.3 Events (envelope v2, producer `subscription`, exchange `washgo.subscription.events`)

The outbox rows are written today and the relay is NOT started. The shapes are
self-validated by `services/subscription/src/application/events.ts`.

- **`subscription.subscription-changed.v1`**
  - Aggregate `subscription`.
  - Data: `{ customerSubject, planCode, planRevision, previousStatus|null, status, periodNo|null, periodEndsAt|null, unitsGranted|null }`.
- **`subscription.entitlement-reserved.v1`**
  - Aggregate `subscription-entitlement`, the reservation id.
  - Data: `{ subscriptionId, bookingId, periodNo }`.
  - This is the catalogued event name.
- **`subscription.entitlement-reservation-changed.v1`**
  - Same aggregate.
  - Data: `{ subscriptionId, bookingId, periodNo, previousStatus, status, reason|null }`.
  - **Legal transitions:** `RESERVED→COMMITTED|RELEASED` and `COMMITTED→REVERSED`.
  - **Reasons are closed:** `RELEASE_REASONS` and `REVERSE_REASONS`.
  - **This name is not in `architecture/service-catalog.json`.** Requested as an addition.

No payment reference, price paid, name or phone travels in an event.

## CR-B-10.4 Service credentials and the Booking saga

Configure `SUBSCRIPTION_SERVICE_CLIENTS` using the P04-E3 `ServiceClientAuthenticator` format:

- **Client `booking`:** scopes `subscription.entitlement.reserve` and `subscription.entitlement.settle`.
- **Client ids must be producer names**, because they are recorded as the event actor.

Booking, owned by Lane C, should:
1. reserve after the booking holds a slot;
2. commit when the work completes;
3. release on any cancellation or failure.

Reserve is idempotent on (subscription, booking), so a retry never takes a second unit.

## CR-B-10.5 Gateway aliases and readiness

These are Gateway routes for the customer and admin consoles. The admin
subscription screens are NOT designed (DESIGN_LOCK §7), so no UI is inferred.
Readiness promotion stays an E-owned gate.

## CR-B-10.6 Billing purchase linkage (B + E, owner decision B-09)

Billing has no subscription-purchase obligation today. Activation and renewal
take an opaque Billing reference that staff verified, and each reference funds
exactly one period (unique constraint).

A verified, automatic link needs two things:
- a Billing obligation type for plan purchases;
- an E-published `billing.v1` read for the subscription purchase.

It also needs the owner's B-09 decision on the price, renewal and refund of a paid plan.

## CR-B-10.7 Source inventory registration (blocks CI `static` on the P05-B1 PR)

`tests/parallel/E/status.test.mjs` derives persistence models from the Prisma schema
and compares them with the E-owned `architecture/implementation-status.json`. The
exact delta for `services[id=subscription].persistenceModels`:

```json
["ServiceMarker", "SubscriptionPlan", "SubscriptionPlanRevision", "CustomerSubscription",
 "SubscriptionPeriod", "EntitlementReservation", "EntitlementMovement",
 "SubscriptionIdempotencyReceipt", "SubscriptionAuditEvent", "OutboxMessage"]
```

Until E applies it, the `static` job fails on this PR by design (registration gap,
not a behaviour failure).
