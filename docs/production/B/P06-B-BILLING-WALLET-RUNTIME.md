# P06-B — Billing custody outbox and Wallet runtime delivery

This change supplies an executable producer/consumer slice for the existing
cash-custody facts. It does not promote either service's readiness, configure a
merchant provider, establish a production deployment or approve customer stored
value. Wallet remains the technician-custody read projection of Billing's facts.

## Runtime and ownership

Billing's image can run `node dist/outbox/relay.runner.js`; Wallet's image can run
`node dist/transport/messaging/custody-consumer.runner.js`. The matching workspace
scripts are `start:cash-relay` and `start:custody-consumer`. These are separate
processes from the HTTP APIs. Each needs only its own runtime `DATABASE_URL`
and its own scoped `BROKER_URL`. No migration or peer database credential is
passed to a worker. An HTTP replica does not silently start another worker.

Provision the dedicated vhost and scoped identities with
`infra/rabbitmq/billing-wallet-bootstrap.sh`, supplying `CW_FINANCE_VHOST`,
`BILLING_BROKER_PASSWORD` and `WALLET_BROKER_PASSWORD` to the provisioning process.
The script is intended for a new vhost/identities; existing installations need a
reviewed topology migration rather than deletion of live queues. Billing can
declare/publish only `washgo.billing.events` and cannot read a queue. Wallet owns
only `wallet.billing-custody.*`, can read Billing's exchange to bind, and cannot
declare or publish that exchange. No application receives an administrator tag.

| Runtime part | Durable state and behavior |
| --- | --- |
| Billing cash relay | Claims the owner outbox with `FOR UPDATE SKIP LOCKED`; leases and every final write are fenced. The shared published parser checks the envelope and its routing metadata before publication. A persistent mandatory publish must be confirmed before `published_at` is written. |
| Relay allowlist | Only `billing.cash-collected.v1`, `billing.cash-collection-reversed.v1` and `billing.custody-handover-changed.v1`. Obligation events have no deployed subscriber in this slice; legacy provider-credit/refund events have no registered matching contract. All remain untouched and pending. |
| Wallet consumer | Reads the durable quorum queue `wallet.billing-custody.v1`. The existing projector commits its inbox, source, movement and balance in one Wallet transaction. ACK follows that commit. |
| Deferred delivery | A prerequisite may arrive later or be published by another relay replica. The consumer publishes the unchanged envelope to its own retry exchange, with a durable bounded retry count, waits for confirm, then ACKs the original. Tail retry permits the prerequisite to progress. An uncertain retry publication leaves the original unacknowledged/requeued. |
| Poison and exhausted retry | Invalid transport/envelope data and exhausted retries go to the durable quorum DLQ `wallet.billing-custody.dlq`. The bootstrap applies at-least-once dead lettering with `reject-publish`; no timeout invents a financial effect. |

The relay defaults to a 120-second lease, batches of 20, ten attempts and bounded
retry backoff. A process that dies on its final lease is parked after expiry with
`LEASE_EXHAUSTED`, so it remains visible to recovery tooling. Consumers reconnect
after channel/broker loss and retain retry state in the broker. Crash injection
exists only in acceptance-owned entrypoints, not in the shipped workers.

RabbitMQ's [4.2 quorum-queue documentation](https://www.rabbitmq.com/docs/4.2/quorum-queues#activating-at-least-once-dead-lettering)
specifies both `dead-letter-strategy=at-least-once` and `overflow=reject-publish`
to retain dead letters until their target confirms. This does not make a
single-node disposable broker highly available; production cluster, storage,
monitoring and recovery evidence remain separate release requirements.

## Verification and limits

`scripts/production/B/wallet-broker-acceptance.mjs` builds both owners from the
candidate source and uses pinned PostgreSQL 16.10 and RabbitMQ 4.2 containers.
It provisions separate owner databases and migration/runtime roles, removes the
disposable broker bootstrap login, and executes the production relay and Wallet
consumer. The test uses real Billing HTTP cash/handovers/treasury/reversal
commands. Identity/Pricing are explicit HTTP doubles and Dispatch WorkAuthority
is a port double; these tests do not certify those upstream services.

The harness checks unroutable publication, a crash after leasing, consumer death
after the local commit and before ACK, duplicate delivery, handover ordering,
poison, bounded durable retries and actual broker ACL denials. Synthetic
envelopes appear only in deliberate ordering/poison/retry fault cases. Redacted
worker output and strict nonempty/no-skip Node test summaries are retained with
the source-bound report; a missing dependency or a failed phase cannot pass.

Local diagnostic evidence uses PostgreSQL 17.12, not the canonical CI image:
Billing's command/provider suite passed 92 tests, finance passed 3 and relay
storage passed 3. The relay storage suite runs separately because the cash
command suite asserts an entirely unpublished outbox. Wallet's local adapter,
domain and HTTP suites passed 18 tests; shared messaging passed 30 tests.
These counts describe the local candidate, not final-commit CI acceptance.
Real RabbitMQ execution must still be recorded on the final source commit.

Operational recovery must inspect `dead_at`/`last_error`, pending-outbox age,
the Wallet DLQ and projection freshness. Replay preserves the original event ID
and bytes after correcting the cause; it must not create a new financial fact.
No automated DLQ deletion or balance adjustment is introduced. The changes are
additive and require no database migration; stopping the workers preserves
pending outbox rows and durable queue contents for forward recovery.
