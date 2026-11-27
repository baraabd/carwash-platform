# S07 — Billing obligation events into Reporting cash KPIs

## Scope and authority

The Admin payments screen already reads Reporting's cash KPIs. The two source
contracts requested in CR-D-P03-01 are now published in
`packages/event-contracts/src/billing-v1.ts`, but the existing Billing relay
selected only Wallet custody facts and Reporting had no obligation subscription.
This implementation closes that specific producer-to-projection path.

Billing remains the financial authority. Reporting copies the published status,
outstanding amount, currency, scale and source revision into its own projection.
It does not verify payments, infer settlement, allocate credits, calculate refunds
or change another owner's data. `CASH_COLLECTED` is a Billing cash receipt; treasury
custody and settlement remain separate Billing/Wallet facts. The Admin paid card
continues to count `PAID`, with a separate labelled row for `CASH_COLLECTED`.

## Implemented path

- Billing validates new obligation outbox payloads against the published parser
  inside the same transaction as the financial change.
- `start:obligation-relay` runs `node dist/outbox/relay.runner.js --family obligations`.
  Its fixed allowlist contains only `billing.obligation-created.v1` and
  `billing.obligation-status-changed.v1` on `washgo.billing.events`.
- The default `start:cash-relay` still leases only the three Wallet custody types.
  Each role uses the existing leased PostgreSQL outbox, publisher confirms,
  mandatory routing, lease fencing and bounded retries. A broker confirmation
  with an unroutable return cannot mark a row published.
- The existing Reporting operations worker binds the two exact routing keys,
  parses the shared contracts, and folds them through its owner-local
  `OpsObligation` writer. One transaction commits inbox identity, projection and
  freshness. A newer revision wins; a contradictory equal revision rolls back.
- Reporting migration `20261127160000_s07_billing_cash_projection` extends its
  closed state constraint with `CASH_COLLECTED` and requires zero outstanding for
  that state. It retains the same requirement for `PAID` and `VOIDED`.
- Admin's cash adapter now calls the shared `parseCashKpisV1` and uses Billing's
  published status vocabulary. Both language labels keep collection distinct
  from treasury delivery; the existing layout and cards are preserved.

## Runtime configuration and permissions

`infra/runtime-processes.json` declares the additional Billing process as
**desired-not-deployed**. Its owner image runs in `/app` with only Billing's
runtime `DATABASE_URL` and `BROKER_URL`. It exposes no ingress and must disable
the owner image's inherited HTTP health probe. Process supervision and outbox
age/retry monitoring are required separately from API health.

The fresh installation profile `infra/rabbitmq/billing-reporting-bootstrap.sh`
creates distinct Billing and Reporting identities. Billing can configure/publish
only its exchange and cannot read Reporting's queue. Reporting owns only its
operations queue/dead-letter resources and cannot publish a Billing fact. Topic
permissions restrict its Billing bindings to the two obligation keys; `#`,
custody and legacy provider-credit bindings are refused. Other native operations
bindings remain explicitly scoped because the same Reporting worker consumes
Booking, Dispatch, Scheduling and Workforce contracts.

Infrastructure provisioning must declare those producer exchanges. Application
credentials never declare another owner's exchange. Provisioning also enables
at-least-once transfer to the Reporting durable dead-letter queue. The acceptance
runner deletes its disposable bootstrap login before launching owner processes.

Deployment order is: apply the Reporting migration; install the scoped topology
and grants; start the Reporting operations consumer and observe its bindings;
start Billing's obligation relay; then observe outbox convergence, inbox progress
and the authenticated Reporting cash read. These are required deployment steps,
not a statement that they have occurred in the hosted environment.

## Acceptance and remaining proof

Required business suite: `b-reporting-broker`. It is a separate CI matrix entry.
It reuses the finance PostgreSQL/RabbitMQ runner with `--reporting`, owner-local
runtime/migration roles and the production worker executables.

`tests/production/B/reporting-broker.test.mjs` covers:

- Actual Billing HTTP obligation, cash intent and authorized cash-receipt writes;
  their committed outbox events drive the projection without directly seeding it.
- Unroutable delivery remaining pending, a Reporting crash after commit before
  ACK, redelivery deduplication, and crashed Billing lease recovery.
- An actual Billing cash reversal reaching the newest Reporting revision; older
  and repeated deliveries cannot regress or duplicate the financial effect.
- Contradictory revisions and malformed payloads reaching the durable DLQ without
  an accepted inbox row or financial effect.
- Reporting HTTP permission checks and parsing by the same published cash KPI
  contract used by Admin; collection never silently becomes `PAID`.
- Broker topic/resource denials, default-exchange denial and runtime identities
  unable to connect to the other owner's database.

Identity, Pricing and Dispatch upstreams in this suite are explicit fixtures.
Synthetic envelopes are used only for transport/integrity fault injection. It is
not a browser journey, live merchant verification or hosted deployment approval.

`tests/production/B/reporting-cash.pg.test.mjs` is a separate Reporting-only
PostgreSQL regression using declared event fixtures. It checks exact large minor
units, revision convergence and SQL constraints; all valid fixture changes roll
back. Local execution is diagnostic evidence only. The final source-bound CI
report and actual deployed worker observations remain required; no previous SHA's
passes certify this implementation.

## Compatibility and rollback

Existing obligation rows keep their event IDs and source revisions. Historical
rows are validated before publication; an incompatible row must be investigated
from the owner outbox rather than rewritten or broadcast as a different contract.
Rolling back an API does not justify deleting accepted financial facts. Once a
`CASH_COLLECTED` projection exists, retain a reader that understands the published
state. Stop the obligation relay before reverting consumer code; retain the
additive migration and durable pending events for forward recovery.

This is not a publish-all relay. Canonical refund-status events have a published
producer but no new subscriber is invented here. Older Billing provider-credit
and refund proposals, Subscription proposal events, and legacy Pricing redemption
events remain excluded. Some of those differ from the canonical exchange,
aggregate or payload despite similar names; they require their own contract and
legitimate consumer reconciliation. Pricing audit rows remain local audit data.
