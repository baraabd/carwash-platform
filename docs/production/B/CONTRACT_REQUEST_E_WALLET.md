# Contract request to Lane E — Wallet technician custody (CR-B-12)

Requester: Lane B, task P05-B child B3. Status: **SUBMITTED, not accepted.**
Wallet consumes only E's merged contracts: it parses the registered
`billing.cash-collected.v1`, `billing.cash-collection-reversed.v1` and
`billing.custody-handover-changed.v1` with the `@carwash/event-contracts` parsers.
Nothing below has been copied into a shared package by Lane B.

Owner decision B-08 limits Wallet to **internal technician custody**. Customer
stored value, funding, transfer and withdrawal are NOT approved; Wallet exposes
no such route or event and none is requested here.

## CR-B-12.1 Identity permission `wallet.read` (optional, additive)

Finance custody reads currently require the existing grant `billing.read`
(custody is a view of Billing postings). If the owner wants Wallet reads separable
from Billing reads, add `wallet.read` to `IDENTITY_PERMISSIONS` and grant it to
`finance` (and `super-admin`). Until then nothing else grants staff access.
Technicians read only their own custody with the existing `work.read:assigned`.

## CR-B-12.2 Explicit holder on `billing.cash-collected` (v2, additive)

`billing.cash-collected.v1` carries no holder/collector field. Wallet attributes
the custody holder from the envelope actor (`actor.kind = 'account'`, `actor.id`),
which equals the collector because Billing writes `collector = acting account`.
Any other actor kind is recorded as `REJECTED / HOLDER_UNATTRIBUTABLE`, never
guessed. Request: a v2 (or an additive v1 revision agreed with Billing) with
`holder: uuid` in `data`, so attribution does not depend on envelope metadata.
Also useful: `receiptIds` (or a per-receipt event) on handover changes so
per-receipt custody status can be projected (today only `receiptCount`).

## CR-B-12.3 Runtime broker dependency and topology

Wallet has no broker dependency. Adding `@carwash/platform-messaging` to
`services/wallet/package.json` changes the E-owned lockfile, so Lane B did not.
Requested:

- dependency `@carwash/platform-messaging` (workspace) for `@carwash/wallet`;
- queue `wallet.billing-custody.v1` (durable, quorum if the platform standard),
  bound to the topic exchange `washgo.billing.events` with routing keys
  `billing.cash-collected.v1`, `billing.cash-collection-reversed.v1`,
  `billing.custody-handover-changed.v1`;
- dead-letter exchange/queue for the wallet queue and a bounded redelivery policy
  (the handler returns retryable `503 PROJECTION_DEFERRED` while an earlier event
  is missing; those must requeue and eventually dead-letter, never drop);
- broker identity for Wallet: read on its queue only, no configure on Billing's
  exchange;
- relay of Billing's outbox for these events (Billing's relay is not started).

The application handler (`BillingCustodyEventHandler`,
`services/wallet/src/transport/messaging/consumer.ts`) and the proposed queue
and bindings (`WALLET_CUSTODY_QUEUE`, `WALLET_CUSTODY_BINDINGS`) already exist.
The real-RabbitMQ acceptance (`scripts/production/B/wallet-broker-acceptance.mjs`)
proves the delivery semantics with a test-owned consumer loop.

## CR-B-12.4 Gateway routes (later)

Read-only aliases for the admin finance console and the technician app, once
their screens are designed (none is approved yet):
`GET /internal/v1/wallet/custody/holders/:holder`,
`GET /internal/v1/wallet/custody/holders/:holder/movements`,
`GET /internal/v1/wallet/custody/me`, `GET /internal/v1/wallet/custody/me/movements`.

## CR-B-12.5 Wallet events (none requested now)

`wallet.balance-updated.v1` / `wallet.hold-released.v1` in the service catalog
have no approved consumer and would duplicate Billing facts. Wallet emits no
event; the catalog entries should stay `planned-not-implemented`.

## CR-B-12.6 Source inventory registration (blocks CI `static` on the P05-B3 PR)

`tests/parallel/E/status.test.mjs` compares the Prisma models with the E-owned
`architecture/implementation-status.json`. Exact delta for
`services[id=wallet].persistenceModels`:

```json
["ServiceMarker", "WalletInbox", "CustodySource", "CustodyAccount", "CustodyMovement"]
```

Until E applies it, the `static` job fails on this PR by design (registration gap,
not a behaviour failure).
