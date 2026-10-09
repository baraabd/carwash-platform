# Contract request to Lane E — Billing v1 (from P02-B1)

Status: **SUBMITTED, not accepted**. Lane B does not edit shared contracts, event
contracts, Gateway, Identity, root dependencies, lockfiles, CI or readiness
guards. Lane B consumes only E's merged, versioned result.

Provider implementation: `services/billing` at the head of
`prod/p02-b-implement-billing-obligation-and-paymentintent-core-b1`.
Every shape below is what that implementation already serves or writes. A
change requested by E becomes a Billing change in a follow-up PR; Billing does
not copy E's DTOs before they are merged.

## CR-B-01 HTTP contract `billing.v1` in `@carwash/contracts`

Money is the published `common/money` `Money` (`{ currency, amountMinor, scale }`,
non-negative here). `PrincipalRef` is the published `common/principal` type.

```ts
type PaymentMethodV1 = 'CASH_ON_COMPLETION' | 'SHAM_CASH' | 'SYRIATEL_CASH';
type ObligationStatusV1 = 'OPEN' | 'SETTLED' | 'VOIDED';
type IntentStatusV1 =
  | 'AWAITING_CASH_COLLECTION' | 'AWAITING_CUSTOMER_PAYMENT' | 'UNDER_REVIEW'
  | 'SUCCEEDED' | 'SUPERSEDED' | 'CANCELLED';
type AttemptStatusV1 = 'PENDING_REVIEW' | 'MATCHED' | 'MISMATCHED' | 'UNKNOWN';
type FinancialStatusV1 =
  | 'UNPAID' | 'AWAITING_CASH' | 'AWAITING_PAYMENT' | 'UNDER_REVIEW'
  | 'OUTCOME_UNKNOWN' | 'PAID' | 'VOIDED';

interface PaymentIntentV1 { intentId: string; method: PaymentMethodV1; status: IntentStatusV1;
  amount: Money; createdAt: UtcTimestamp; updatedAt: UtcTimestamp }
interface PaymentAttemptV1 { attemptId: string; intentId: string; method: PaymentMethodV1;
  status: AttemptStatusV1; reference: string /* "…" + last 4 chars only */; claimed: Money;
  submittedAt: UtcTimestamp; reconciledAt: UtcTimestamp | null }
interface ObligationV1 { obligationId: string; revision: number; status: ObligationStatusV1;
  financialStatus: FinancialStatusV1; quoteId: string; amount: Money; verified: Money;
  outstanding: Money; activeIntent: PaymentIntentV1 | null; attempts: PaymentAttemptV1[] /* newest first */;
  createdAt: UtcTimestamp; updatedAt: UtcTimestamp }
interface FinancialStatusViewV1 { obligationId: string; revision: number;
  financialStatus: FinancialStatusV1; amount: Money; verified: Money; outstanding: Money;
  method: PaymentMethodV1 | null }

interface CreateObligationRequestV1 { quoteId: string }                       // closed
interface InitializePaymentRequestV1 { expectedRevision: number; method: PaymentMethodV1 }
interface SubmitAttemptRequestV1 { expectedRevision: number; providerReference: string /* ^[A-Za-z0-9-]{4,64}$ */ }
interface ReconcileAttemptRequestV1 { expectedRevision: number;
  outcome: 'MATCHED' | 'MISMATCHED' | 'UNKNOWN'; observedAmount: Money | null }
interface VoidObligationRequestV1 { expectedRevision: number }
```

Routes under `/internal/v1/billing` (every mutation requires `Idempotency-Key`,
`^[A-Za-z0-9_-]{16,128}$`):

| id | method/path | access | success |
| --- | --- | --- | --- |
| createObligation | `POST /obligations` | principal + `bookings.create:self` | 201 new / 200 existing for the same owner+quote / replay |
| getObligation | `GET /obligations/:obligationId` | owner + `bookings.read:self`, or `billing.read` | 200 `ObligationV1` |
| getFinancialStatus | `GET /obligations/:obligationId/financial-status` | as above | 200 `FinancialStatusViewV1` |
| initializePayment | `POST /obligations/:obligationId/payment-intents` | owner + `bookings.create:self` | 201 `ObligationV1` |
| submitAttempt | `POST /obligations/:obligationId/payment-attempts` | owner + `bookings.create:self` | 202 `ObligationV1` |
| voidObligation | `POST /obligations/:obligationId/void` | owner + `bookings.create:self` (saga compensation; see CR-B-03) | 200 `ObligationV1` |
| reconcileAttempt | `POST /payment-attempts/:attemptId/reconciliation` | `billing.reconcile`, never the obligation owner | 200 `ObligationV1` |

Error codes Billing emits (mapping to the shared envelope is E's call):
`REQUEST_INVALID` 400, `IDEMPOTENCY_KEY_INVALID` 400, `AUTH_REQUIRED` 401,
`AUTH_FORBIDDEN` 403, `NOT_FOUND` 404 (also for wrong owner: non-enumerating),
`IDEMPOTENCY_CONFLICT` 409, `QUOTE_NOT_USABLE` 409, `PROVIDER_REFERENCE_TAKEN` 409,
`OBLIGATION_ALREADY_EXISTS` 409, `REVISION_CONFLICT` 412, `AMOUNT_INVALID` 422,
`CURRENCY_UNSUPPORTED` 422, `AUTH_UNAVAILABLE` 503, `UPSTREAM_UNAVAILABLE` 503.
Rule rejections from the current financial state: 409 `OBLIGATION_SETTLED`,
`OBLIGATION_VOIDED`, `VOID_NOT_ALLOWED`, `METHOD_UNCHANGED`, `PAYMENT_IN_REVIEW`,
`NO_ACTIVE_INTENT`, `INTENT_NOT_ACCEPTING_ATTEMPTS`, `ATTEMPT_NOT_OPEN`,
`ALREADY_UNKNOWN`; 422 `ATTEMPT_LIMIT_REACHED`, `AMOUNT_NOT_EQUAL_OUTSTANDING`,
`OBSERVED_AMOUNT_REQUIRED`, `OBSERVED_AMOUNT_NOT_ALLOWED`. The Gateway allowlist
should forward these as `reason` under `CONFLICT` / `BUSINESS_RULE_VIOLATION`.

Note: `service-kit`'s `AppExceptionFilter` does not put `details` in the
response body, so the contract must not rely on error details. A client learns
the current revision by re-reading the obligation after `REVISION_CONFLICT`.

## CR-B-02 Event contracts (envelope v2, producer `billing`)

Billing already writes these to its local outbox in the same transaction as
the fact, validated through the published `parseEnvelopeV2`. The relay is not
started until E registers them. Proposed exchange `washgo.billing.events`,
routing key = event type, aggregate type `billing-obligation`, aggregate
version = the obligation revision the event describes.

```ts
// billing.obligation-created.v1
data: { quoteId: string; amount: Money; financialStatus: FinancialStatusV1 }   // closed
// billing.obligation-status-changed.v1 (emitted only when financialStatus changes)
data: { previousFinancialStatus: FinancialStatusV1; financialStatus: FinancialStatusV1;
        verified: Money; outstanding: Money }                                  // closed, previous !== current
```

Actor: `{ kind: 'account' | 'guest', id: <Identity subject> }`. Data never contains
a provider transaction reference, phone, name or receipt. Requested: the
registry entries, AsyncAPI documents, broker topology and producer ACL for
`billing`, and (CR-B-05) the relay dependency.

## CR-B-03 Identity permissions and service scopes

1. `billing.reconcile`, proposed for `finance` and `super-admin` and kept
   separate from `billing.read`. Until it is granted, every reconciliation
   returns 403. Billing also refuses reconciliation by the obligation's own
   owner (separation of duties).
2. A workload-identity scope for the booking saga, e.g. `service:billing.obligation.write`.
   Booking would create obligations for its beneficiary and void them as
   compensation, instead of the customer doing it directly. Billing will accept
   `{ beneficiary: PrincipalRef, quoteId, bookingId }` from that scope once the
   P02-E workload-identity work is merged. Until then creation and void are
   customer-initiated and owner-checked.
3. The guest permission set already contains `bookings.create:self` and
   `bookings.read:self`. Billing relies on these for guest checkout.

## CR-B-04 `@carwash/contracts` dependency for Billing

Billing mirrors two published shapes locally because it cannot import
`@carwash/contracts` without a lockfile change:
- `CURRENCIES` (SYP 2, USD 2), mirrored in `domain/money.ts` and in the
  migration's CHECK constraints;
- the `pricing.v1` `QuoteV1` fields it reads (`quoteId`, `status`, `currency`,
  `total`), mirrored in `infrastructure/pricing/pricing-quote.reader.ts`.

Request: add `"@carwash/contracts": "workspace:*"` to
`services/billing/package.json` and update the lockfile. Billing will then
replace both mirrors with `parseMoney` / `parseQuoteV1`.

## CR-B-05 Outbox relay and broker

Add `@carwash/platform-messaging` to Billing (lockfile change), the
`washgo.billing.events` topology, and broker credentials for `billing`. The
`app.outbox_message` table already uses the relay's column layout. B2 will
start the relay and prove publish, redelivery and restart against real RabbitMQ
once these exist.

## CR-B-06 Gateway aliases

Customer BFF routes for the booking journey's payment step and confirmation
screen (create obligation for the pinned quote, choose method, submit
transaction number, poll financial status), plus the admin Finance review
queue/reconcile route. The existing `admin.billing` route points at an
unimplemented `/internal/v1/billing/summary`; E should retire or re-point it.

## CR-B-07 Readiness promotion

Billing keeps `BUSINESS_READY = false` (readiness 503). Promotion is E's gate
after CR-B-01..06, real cross-service acceptance and merchant setup.