# Lane B — Commerce & Finance production work

## P02-B — Billing obligation and PaymentIntent core

Parent status: **INTEGRATION_PENDING**. Not production-ready, not deployed, not
integrated, no money flow enabled. Started from main
`566d2e7435dac0803d075556fff43c435f8a29a7` (tree
`1bd162f2578878643b3e2c2cc437fece36716588`), refreshed on 2026-10-08; the audited
`f875d31` was no longer current.

| Child | Branch | Scope | Status |
| ----- | ------ | ----- | ------ |
| B1 | `prod/p02-b-implement-billing-obligation-and-paymentintent-core-b1` | Obligation, PaymentIntent, attempts, reconciliation/UNKNOWN, append-only ledger, idempotency, audit, transactional outbox, owner API, real PG | PR open — review required |
| E-req | (Lane E) | `billing.v1`, billing events, `billing.reconcile`, saga workload scope, dependencies — `CONTRACT_REQUEST_E_BILLING.md` | SUBMITTED, not accepted |
| B2 | (after E) | Outbox relay on real RabbitMQ, saga-scoped create/void | NOT STARTED — blocked on E |

Details, evidence and blockers B-P02-01..08: `P02-B1-BILLING.md`.

# P01-B — Catalog and Pricing production providers

Parent status: **INTEGRATION_PENDING**. No part of this task is production-ready,
deployed or fully integrated.

Audited starting main: `f875d31bf62b153b6d36ac7a607949f8c4e29389`
(tree `6177cc0112519b6b2c718e65c3b117f42a210bf5`), confirmed current on
2026-10-07 before work started.

## Child sprints (one branch = one PR, each based on main, none stacked)

| Child | Branch                                  | Scope                                                                              | Status                       |
| ----- | --------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| B1    | `prod/p01-b-implement-catalog-and-pricing-production-providers-b1-catalog` | Catalog definitions, immutable revisions, effective windows, owner API, real PG    | PR open — review required    |
| B2    | `prod/p01-b-implement-catalog-and-pricing-production-providers-b2-pricing`  | Price versions, exact Money, immutable expiring quotes, owner API, real PG         | PR open — review required    |
| E-req | (Lane E)                                | Contracts, grants, dependencies, readiness promotion — see contract request files | SUBMITTED, not accepted      |

B1 and B2 are independent: Pricing never imports Catalog code, never reads the
Catalog database and does not consume an unpublished Catalog contract. The only
link between them is the catalog revision number Pricing receives through its
own port, whose production adapter waits for E's published contract.

## What blocks the parent from DONE

1. Lane E: publish `catalog.v1` / `pricing.v1` HTTP contracts, the
   `catalog.publish`, `pricing.publish` grants in Identity, the Gateway aliases,
   and the dependency additions (lockfile is E-owned). See
   `CONTRACT_REQUEST_E_CATALOG.md` (B1) and `CONTRACT_REQUEST_E_PRICING.md` (added by B2).
2. Lane E: event contracts `catalog.definition-published.v1`,
   `pricing.price-published.v1`, `pricing.quote-issued.v1` (no event is emitted
   until a validated contract exists; nothing is written to the outbox).
3. Owner decisions recorded as OPEN in `docs/parallel/B/W01/POLICY_DECISIONS.md`:
   B-03 currency/exponent policy, B-04 real rates, B-05 quote TTL/replay lifetime,
   B-10 promotions. The code fails closed (503 `POLICY_UNAVAILABLE`) until they
   are configured; no default is invented.
4. Real Identity-to-owner and Pricing-to-Catalog acceptance, Gateway journey and
   customer UI consumers (A/C/D lanes) after E publication.

## Evidence policy

`evidence/*.json` files are produced by
`node scripts/production/B/postgres-acceptance.mjs --service <svc> --record` and
name the exact source commit/tree they ran on. They are local disposable-database
evidence only: PostgreSQL is real, Identity is a local HTTP stub, RabbitMQ is not
used. They are not production, deployment or integrated-journey evidence. Billing runs
additionally use a local HTTP stub of Pricing's published `pricing.v1` quote read.
