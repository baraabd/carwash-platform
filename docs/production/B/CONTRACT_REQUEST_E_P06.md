# P06-B — contract and platform requests to Lane E (and lane C)

Status: **SUBMITTED, not accepted.** Lane B consumes only E's merged, versioned
artifacts. Nothing here is copied into a service as a private DTO. Every item is
referenced by a blocker id in `finance-matrix.json` and is checked by
`node scripts/production/B/check-finance-matrix.mjs`.

## CR-B-P06-01 — messaging dependency for Billing and Wallet (blocker B-P06-04)

- Add `"@carwash/platform-messaging": "workspace:*"` to `services/billing/package.json`
  and `services/wallet/package.json` and regenerate `pnpm-lock.yaml`. Both the
  manifest change and the lockfile change are E-owned because they alter the
  workspace lockfile.
- Register the Billing relay publisher for exchange `washgo.billing.events` (the
  `BILLING_EVENTS_V1` specs that are already published). Also register the Wallet
  consumer queue `wallet.billing-custody.v1`, bound to
  `billing.cash-collected.v1`, `billing.cash-collection-reversed.v1` and
  `billing.custody-handover-changed.v1`, with a DLQ.
- After the merge, Lane B wires the relay and consumer adapters. The owner
  application handlers already exist: the Billing outbox, and the Wallet inbox
  handler from P06-B3. Lane B then proves redelivery, duplicate delivery and
  restart on real RabbitMQ.

## CR-B-P06-02 — Identity grants that the published contracts already require (blocker B-P06-08)

`IDENTITY_PERMISSIONS` lacks permissions that published owner contracts name:

| Contract route | Access in contract | Identity today |
| -------------- | ------------------ | -------------- |
| `pricing.v1 publishPriceBook` | `permission:pricing.prices.publish` | only `pricing.publish` exists |
| `billing.v1 recordCashCollection`, `declareHandover`, `getMyCustody` | `permission:billing.cash.collect` | missing |
| `billing.v1 reverseCashCollection` | `permission:billing.cash.correct` | missing |
| `billing.v1 receiveHandover` | `permission:billing.treasury.receive` | missing |

The request is one of two fixes. Either add the four permissions with role
assignments, or publish a pricing.v1 patch that names `pricing.publish`. Choose
one; do not keep both names. Suggested role assignments: `technician` gets
`billing.cash.collect`, and `finance` gets `billing.cash.correct` and
`billing.treasury.receive`. The final role assignment is the owner's B-07
decision. Until this lands, these routes stay unusable for real principals,
because the owners deny by default.

## CR-B-P06-03 — Gateway catalog upstream (blocker B-P06-05)

The Gateway route `customer.catalog` (`GET /customer/packages`) forwards to
`/internal/v1/catalog/packages`. The published `catalog.v1` serves
`GET /definitions`, plus `GET /definitions/:definitionId`. Repoint the upstream
to `/internal/v1/catalog/definitions`. Then add a contract test that every
Gateway upstream path matches a route of the owner contract. The same class of
drift exists for Billing (see CR-B-P06-05).

## CR-B-P06-04 — admin finance and wallet read contracts (blocker B-P06-07)

The owner endpoints are implemented in the P06-B6 and P06-B3 child PRs. Exact
field-level shapes are in those children's request documents
(`CONTRACT_REQUEST_E_BILLING_ADMIN.md`, `CONTRACT_REQUEST_E_WALLET.md`). The
requests are:

- `billing.v1 getFinanceSummary`: `GET /summary`, `permission:billing.read`. The
  existing Gateway route `admin.billing` already points at it.
- `billing.v1 listPaymentAttempts`: `GET /payment-attempts`,
  `permission:billing.read`, keyset cursor. Add a matching Gateway admin route.
- `wallet.v1`: the custody projection reads. The owner's access rules mirror
  `billing.cash.collect` (own holder) and `billing.read` (any holder).

## CR-B-P06-05 — provider-credit routes and route alignment for PR #125 (blockers B-P06-02, B-P06-03)

Lane B fixes the path divergence in its own provider. Billing serves the
published paths `provider-notifications/:provider`, `obligations/:id/refunds`
and `refunds/:id/outcome`, so the Gateway upstreams resolve. This is done on PR
#125 or in a child that follows its merge.

Lane E is asked to publish the provider-credit statement surface with the
routes below. Both use `billing.reconcile`, and the recorder and approver must
be different people.

- `POST /provider-credits`
- `POST /provider-credits/:id/decision`

E should also publish the credit-based refund execution steps, or explicitly
decide that the four published refund routes are the only refund surface. In
that case Lane B folds credit linkage into `requestRefund`.

## CR-B-P06-06 — lane C booking saga consumer (blocker B-P06-06)

Booking calls `POST /internal/v1/billing/booking-obligations` and
`POST /internal/v1/billing/booking-obligations/:id/void`. The calls carry the
service credential scoped `billing.obligation.write` (the service-kit service
clients). They use one idempotency key per saga step and treat
timeout/UNKNOWN as unknown, never as created. Billing implements these routes
in P06-B4.
