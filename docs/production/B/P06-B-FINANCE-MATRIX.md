# P06-B — commerce/finance functional matrix

Parent status: **INTEGRATION_PENDING**. This file covers child P06-B5. It is not
production-ready, not deployed and not integrated, and no money flow is
enabled.

The authoritative crosswalk is `finance-matrix.json`. Every pricing, cash,
electronic payment, reconciliation, refund, wallet, subscription, promotion and
admin-finance function is one row. Each row names:

- its owner service;
- the published contract routes and Gateway routes it serves;
- its implementation files, tables and tests;
- its status (`IMPLEMENTED`, `IN_REVIEW` or `BLOCKED`);
- its production gate (`OPEN` or `FAIL_CLOSED`);
- the blockers that keep it closed.

`node scripts/production/B/check-finance-matrix.mjs [--root <tree>]` checks the
JSON against the exact tree it runs on:

1. Every `catalog.v1`, `pricing.v1` and `billing.v1` route, and every Gateway
   route owned by catalog/pricing/billing/wallet/subscription, is claimed by
   exactly one row.
2. Every route served by a Lane B controller is claimed by an `IMPLEMENTED` row
   or declared legacy. This stops marker-only or unused finance paths from
   hiding.
3. An `IMPLEMENTED` row's contract routes are served at the contract path, and
   its files, tests (containing tests) and tables (created by the owner's
   migrations) exist.
4. Every blocker is classified. An external blocker is a provider, credential or
   owner decision. A lane-owned blocker names its lane and a tracking reference
   (a PR, a policy id or an existing file).

`tests/production/B/finance-matrix.test.mjs` proves the committed matrix passes
on this tree. It also proves that each class of drift above is detected when
introduced.

## Summary at base `66aa752` (status before the P06-B children merge)

| Area | IMPLEMENTED on main | IN_REVIEW | BLOCKED |
| ---- | ------------------- | --------- | ------- |
| Catalog | — (main serves a pre-contract shape; legacy) | FIN-CAT-01/02 (P06-B1) | — |
| Pricing | — (pre-contract shape; legacy) | FIN-PRC-01/02/03 (P06-B2) | FIN-PRC-05 fees/tax (B-04) |
| Promotion | — | — | FIN-PRC-04 (B-10) |
| Electronic payment | FIN-PAY-01..04 | FIN-SAGA-01 (P06-B4), FIN-PROV-01 (#125) | FIN-PAY-05 Paymera (B-02), FIN-PAY-06 payee/QR (B-11) |
| Reconciliation | FIN-REC-01, FIN-CUST-03 | FIN-REC-02 (#125) | — |
| Cash and custody | FIN-CASH-01/02, FIN-CUST-01/02/04 | — | FIN-CASH-03 cash refunds (B-06) |
| Refund | — | FIN-REF-01 (#125) | FIN-CASH-03 (B-06) |
| Ledger | FIN-LEDGER-01 | — | FIN-EVT-01 relay (B-P06-04), FIN-PRIV-01 (B-12) |
| Admin finance | — | FIN-ADM-01/02 (P06-B6) | — |
| Wallet | — | FIN-WAL-01 (P06-B3) | FIN-WAL-02 stored value (B-08) |
| Subscription | — | — | FIN-SUB-01 (B-09) |

The table counts 12 functions as IMPLEMENTED on main. "Implemented" does not
mean open in production: 8 of the 12 are `FAIL_CLOSED` until their named
blockers resolve. Only four are `OPEN`: FIN-PAY-02 to FIN-PAY-04 (method
selection, transaction reference, void) and FIN-CUST-03 (custody
reconciliation). Payment confirmation needs FIN-REC-02 (provider credits, PR
#125) and the B-11 provider material. Cash collection needs the lane C work
authority (B-P03-01) and the Identity grants (B-P06-08).

## Findings from the crosswalk (concrete, not generic)

1. **Pricing/Catalog contract drift (B-P06-01).** Main's Pricing serves `POST /prices`,
   `GET /price-versions` and a quote body without `beneficiary`, `revision`,
   `status` or Money `scale`. Billing's production quote reader consumes the
   published `pricing.v1`, so on main no obligation can be created against the
   real Pricing. Catalog likewise serves `/revisions` and `POST /definitions`
   instead of `catalog.v1`. P06-B1 and P06-B2 close this. Each old route is
   listed as legacy with the function that supersedes it.
2. **Billing booking-saga routes were published but unserved.** Neither main
   nor PR #125 served `createBookingObligation` or `voidBookingObligation`.
   P06-B4 adds them.
3. **PR #125 path divergence (B-P06-02).** The refund and provider-notification
   routes in #125 do not match `billing.v1` or the Gateway upstreams. Two
   examples: the Gateway forwards to `/provider-notifications/sham-cash` while
   #125 serves `/providers/:provider/notifications`; the Gateway forwards to
   `/refunds/:id/outcome` while #125 serves `/decision`, `/provider-execution`
   and `/manual-completion`. Integrating #125 unchanged would leave every
   Gateway refund/notification route returning 404 from the owner.
4. **Gateway admin route without an owner (`admin.billing` → `/summary`).**
   Billing did not serve it and `billing.v1` does not define it. P06-B6
   implements it and requests the contract (B-P06-07).
5. **Identity/contract permission drift (B-P06-08).** Four permissions named by
   published contracts are not grantable by Identity. The details are in
   `CONTRACT_REQUEST_E_P06.md`.
6. **Gateway catalog upstream drift (B-P06-05).** `/catalog/packages` and
   `/definitions` disagree.

## Residual external blockers (the only non-repository blockers)

| Id | Kind | What exactly is required |
| -- | ---- | ------------------------ |
| B-11 | PROVIDER | ShamCash and Syriatel Cash merchant agreements, official verification/refund/notification documentation, a usable sandbox and responsible contacts |
| B-02 | OWNER_DECISION | Paymera: required, deferred or excluded; any fourth-method UI change needs owner approval |
| B-03 | OWNER_DECISION | Currencies, exponent and maximum amount |
| B-04 | OWNER_DECISION | Real rates per vehicle category, zone/travel fees, tax and rounding |
| B-05 | OWNER_DECISION | Quote TTL, price-change honouring, revocation and replay lifetime |
| B-06 | OWNER_DECISION | Cancellation, no-show and partial-refund rules; cash refund method |
| B-07 | OWNER_DECISION | Custody holder model, treasury identity, thresholds and shortage accountability |
| B-08 | OWNER_DECISION | Whether any customer stored value or hold product exists |
| B-09 | OWNER_DECISION | Wash plan prices, entitlements, renewal, freeze, cancel and refund |
| B-10 | OWNER_DECISION | Promotion eligibility, stacking, budgets, limits and redemption timing |
| B-12 | OWNER_DECISION | Financial export fields, deletion fulfilment and retention durations |

All other blockers (B-P03-01 and B-P06-01..08) are repository work owned by a
named lane, with a tracking reference.

## Evidence for this child

- `node scripts/production/B/check-finance-matrix.mjs` → PASSED on the base tree
  (33 functions).
- `node --test tests/production/B/finance-matrix.test.mjs` → 9/9 passed.
- Dependencies: compiled `@carwash/contracts` from this tree. No database,
  broker or HTTP service is involved. This is static source evidence only.
