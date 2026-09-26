# ADR 0002 — Durable event delivery

Status: Accepted for the F005 RabbitMQ + transactional Outbox/Inbox foundation.

## Decision

WashGo business integration uses RabbitMQ for asynchronous events, HTTP for bounded synchronous needs and Socket.IO only for non-authoritative UI updates.

The delivery contract is **at-least-once**. The platform does not claim end-to-end exactly-once delivery.

## Ownership and naming

- A producer owns its event exchange. The F005 acceptance producer owns `catalog.events`.
- Routing keys are versioned event names, for example `foundation.probe.created.v1`.
- Every subscribing service owns a separate queue. Communications and Reporting therefore receive independent copies.
- Replicas of the same service compete on that service queue; queues are never named per replica.
- Dead-letter resources live inside the consuming service namespace, for example `reporting.dlx` and `reporting.dlq`.
- Broker identities and RabbitMQ ACLs establish authority. The JSON `producer` field is descriptive metadata, not authentication.
- Application identities cannot use the default exchange to bypass exchange ownership.

## Transactional Outbox

The producing service writes the local state change and Outbox row in the same PostgreSQL transaction.

Relay workers claim rows using `FOR UPDATE SKIP LOCKED` plus a time-bounded lease. Every final write is guarded by `locked_by`, so a stale worker cannot overwrite a worker that reclaimed an expired lease.

The relay publishes a persistent message with `mandatory=true` on a confirm channel. It marks an Outbox row published only after a positive publisher confirm and after proving the message was not returned as unroutable. NACK, timeout, channel loss and unroutable publication leave the row unpublished and observable for retry. Permanently failing Outbox rows stop after a configured maximum and are parked with `dead_at`.

A crash after broker acceptance but before the database update can publish the same event again. This is expected at-least-once behaviour and is handled by Inbox deduplication.

## Transactional Inbox and ACK ordering

The consuming service writes its Inbox record and local effect in one PostgreSQL transaction. The event ID is unique and the Inbox stores a payload fingerprint.

- same event ID + same payload: duplicate, local effect is not repeated;
- same event ID + different payload: integrity conflict, never applied;
- ACK is sent only after the Inbox + local effect transaction commits;
- a crash after commit but before ACK causes safe redelivery.

## Bounded transient retries and DLQ

Subscriber queues are durable RabbitMQ quorum queues with a broker-owned `x-delivery-limit`.

Transient consumer failures use NACK with requeue. RabbitMQ, not process memory, owns the redelivery counter, so restarting a consumer cannot reset the retry budget. Once the delivery limit is exceeded RabbitMQ dead-letters the message to the consuming service DLQ.

Malformed, unsupported or conflicting messages are permanent failures and use NACK without requeue, going directly to the same DLQ.

This foundation intentionally does not introduce an infinite retry loop or a process-local retry counter.

## Reconnection

Relay and Inbox workers recreate their RabbitMQ connection/channel session after broker or channel loss with bounded exponential reconnect delay. Durable broker state remains authoritative across worker and broker restarts.

## Acceptance event

`foundation.probe.created.v1` is a non-business, non-financial event used only to prove the foundation. Catalog produces it transactionally. Communications and Reporting consume it independently into their own databases.

The contract is documented in `docs/asyncapi/foundation-probe.yaml` and implemented by `@carwash/event-contracts`.

## Security

F005 acceptance provisions separate RabbitMQ identities for the participating producer/consumers and a topology identity. Application identities have no administrator tag. ACL tests prove unauthorized exchange creation, queue access, cross-subscriber access, default-exchange publishing, wrong credentials and access to another vhost are refused by the real broker.

## Consequences and limits

The F005 tests prove the failure modes explicitly covered by the acceptance suite against real PostgreSQL and a real single-node RabbitMQ broker. They do not prove RabbitMQ cluster high availability, disaster recovery, production capacity, browser behaviour, payments or end-to-end exactly-once delivery.
