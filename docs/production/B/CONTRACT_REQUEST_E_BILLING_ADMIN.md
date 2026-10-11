# Contract request to Lane E — Billing admin finance reads (from P06-B6)

Status: **SUBMITTED, not accepted.** The owner routes are **implemented in Billing**
(branch `prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b6-billing-admin-finance`).
The contract is **not yet published**. Lane B does not edit `@carwash/contracts`, the Gateway route
table, Identity, root dependencies, lockfiles or CI. Billing consumes only E's merged result. If E
changes a shape below, Billing follows in a separate PR.

## Why

The published Gateway table (`packages/contracts/src/gateway.ts`) already routes
`admin.billing` (`GET /admin/billing`) to `GET /internal/v1/billing/summary` with
`permission: 'billing.read'`. That route existed in neither `billing.v1` nor Billing, so the
admin route could only fail. In addition, admin-web (`apps/admin-web/src/api/finance.ts`) can
reconcile an attempt only when it already knows the `obligationId`, because there is no
finance work queue. P06-B6 implements both owner reads. This request publishes them.

## CR-B-10.1 Routes to add to `BILLING_V1.routes`

```ts
getFinanceSummary: { method: 'GET', path: '/summary', access: 'permission:billing.read' },
listPaymentAttempts: {
  method: 'GET',
  path: '/payment-attempts',
  access: 'permission:billing.read',
},
```

Access rules (enforced by the owner and covered by tests):

- Only a staff **account** that holds `billing.read` may call them.
- Guest sessions are refused, even when they hold the permission.
- Anonymous or unknown credentials → 401 `AUTH_REQUIRED`.
- Every other principal → 403 `AUTH_FORBIDDEN`.
- Identity outage → 503 `AUTH_UNAVAILABLE`.
- Authentication runs before query validation.
- Neither response carries a customer subject, a staff subject, a full provider reference, a
  merchant account or a treasury reference.

No new reasons. The routes use the existing codes `REQUEST_INVALID` (400), `AUTH_REQUIRED`,
`AUTH_FORBIDDEN` and `AUTH_UNAVAILABLE`.

## CR-B-10.2 `getFinanceSummary` response

`Money` is `common/money` (`{ currency, amountMinor, scale }`). Every amount here is
non-negative. The status unions below are Billing's **internal** sets. They differ from v1's
4-value `RefundStatus`, so E must either publish these sets or ask Billing to map them (see
the open question below).

```ts
type AttemptStatus = 'PENDING_REVIEW' | 'MATCHED' | 'MISMATCHED' | 'UNKNOWN';
type ObligationStatus = 'OPEN' | 'SETTLED' | 'VOIDED';
type FinancialStatus = // the published FINANCIAL_STATUSES_V1 set
  | 'VOIDED' | 'PAID' | 'CASH_COLLECTED' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
  | 'UNPAID' | 'AWAITING_CASH' | 'AWAITING_PAYMENT' | 'UNDER_REVIEW' | 'OUTCOME_UNKNOWN';
type CustodyStatus = 'HELD' | 'IN_HANDOVER' | 'DEPOSITED' | 'SETTLED' | 'REVERSED';
type HandoverStatus = 'PENDING' | 'RECEIVED' | 'RECONCILED' | 'CANCELLED';
type CreditStatus = 'PENDING_APPROVAL' | 'REJECTED' | 'UNALLOCATED' | 'ALLOCATED';
type RefundStatusInternal =
  | 'REQUESTED' | 'REJECTED' | 'APPROVED' | 'SUBMITTED' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED';

interface FinanceSummaryV1 {
  asOf: UtcTimestamp;          // the owner's clock at read time
  ledgerConsistent: boolean;   // true iff every ledger check holds in every currency
  currencies: CurrencyFinanceSummaryV1[]; // sorted by currency; only currencies with facts
}

interface CurrencyFinanceSummaryV1 {
  currency: Currency;
  obligations: {
    count: number;
    byStatus: Record<ObligationStatus, number>;          // every key present, 0 allowed
    byFinancialStatus: Record<FinancialStatus, number>;  // every key present
    billed: Money;       // non-voided obligations
    verified: Money;     // money applied (cash receipts + allocated credits)
    outstanding: Money;  // billed − verified
  };
  attempts: {
    byStatus: Record<AttemptStatus, number>;
    awaitingReview: number; // PENDING_REVIEW + UNKNOWN
  };
  cashCustody: {
    inCustody: Money; // receipts HELD or IN_HANDOVER
    receiptsByStatus: Record<CustodyStatus, number>;
    handoversByStatus: Record<HandoverStatus, number>;
  };
  providerCredits: {
    byStatus: Record<CreditStatus, number>;
    confirmed: Money; // gross UNALLOCATED + ALLOCATED, before refunds
  };
  refunds: {
    byStatus: Record<RefundStatusInternal, number>;
    succeeded: Money;
    inFlight: Money; // REQUESTED + APPROVED + SUBMITTED + UNKNOWN
  };
  ledger: {          // the ledger against the projections, per currency
    receivable: boolean; // CUSTOMER_RECEIVABLE (obligation journals) = outstanding
    cleared: boolean;    // cleared accounts (obligation journals) = verified
    custody: boolean;    // CASH_IN_CUSTODY = inCustody
    refunds: boolean;    // REFUND_PAID clearing credits = refunds.succeeded
  };
}
```

Rules a consumer must not break:

- The summary is a **report**. It never confirms money. `PAID` and `CASH_COLLECTED` counts are
  derived from the same function as the obligation view.
- If `ledgerConsistent: false`, the console must show a reconciliation alarm. It must never hide
  the problem or recompute totals.
- All figures come from one read-only REPEATABLE READ snapshot, so they are mutually
  consistent.

Open question for E: should `refunds.byStatus` publish the internal 7-value set, or should
Billing project it onto v1's `REFUND_STATUSES` (`REQUESTED`, `SUCCEEDED`, `FAILED`,
`OUTCOME_UNKNOWN`)? The owner currently serves the internal set.

## CR-B-10.3 `listPaymentAttempts` (reconciliation work queue)

Query (closed; unknown or repeated parameters → 400):

| Param    | Type                     | Rule                                                        |
| -------- | ------------------------ | ----------------------------------------------------------- |
| `status` | `AttemptStatus`          | required                                                    |
| `limit`  | decimal string `1..100`  | optional, default 50                                        |
| `cursor` | opaque string (≤128, URL-safe base64) | optional; only a value returned as `nextCursor` |

```ts
interface PaymentAttemptQueueV1 {
  asOf: UtcTimestamp;
  status: AttemptStatus;
  items: PaymentAttemptQueueItemV1[]; // oldest first: (submittedAt, attemptId) ascending
  nextCursor: string | null;
}
interface PaymentAttemptQueueItemV1 {
  attemptId: string;
  obligationId: string;
  obligationRevision: number; // current; the expectedRevision of reconcileAttempt
  intentId: string;
  method: PaymentMethod;
  status: AttemptStatus;
  reference: string;          // masked "…" + last 4 characters, as in PaymentAttemptV1
  claimed: Money;
  submittedAt: UtcTimestamp;
  reconciledAt: UtcTimestamp | null;
}
```

Pagination is keyset-based, not offset-based:

- A page never repeats an item.
- Every claim that already existed when paging started is listed exactly once, as long as its
  status still matches.
- A claim whose status changes while you page can leave the filtered queue. That is expected,
  because the queue is a work list, not a ledger.

## CR-B-10.4 Gateway admin routes

`admin.billing` already exists and needs no change. Please add:

```ts
{
  id: 'admin.billing.attempts',
  method: 'GET',
  path: '/admin/billing/payment-attempts',
  owner: 'billing',
  upstream: '/internal/v1/billing/payment-attempts',
  permission: 'billing.read',
},
```

The query string must be forwarded unchanged, and no identity header may be added.

## Note to Lane D (admin-web consumer)

Once E publishes this contract, the finance console can:

- Show `GET /admin/billing` as the finance overview, with a visible alarm when
  `ledgerConsistent` is false.
- List claims from `GET /admin/billing/payment-attempts?status=PENDING_REVIEW|UNKNOWN`.
- Call the existing reconciliation route with `expectedRevision = obligationRevision`.

No admin screen design is implied. Admin finance screens remain pending design acceptance
(`docs/design/DESIGN_LOCK.md` §7).
