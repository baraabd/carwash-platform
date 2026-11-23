# Data-plane recovery drill

Run `node scripts/production/E/recovery/drill.mjs --report <file>` on a disposable
Docker host. The workflow retains the JSON report, including measured recovery
values and failures. Passing this drill is not production readiness or approval
of RPO/RTO targets.

## RabbitMQ fixture and crash boundary

The RabbitMQ scenario tests a single broker with an established durable quorum
queue. Its setup now explicitly persists the Ra name-to-UID registry **before
publishing any messages**. The command syncs only that DETS metadata table and
records the node, Ra member UID, data directory, WAL directory and registry file.
All storage paths must be within the mounted `/var/lib/rabbitmq` volume.

This precondition addresses a documented RabbitMQ lifecycle limitation:
[RabbitMQ discussion 17710](https://github.com/rabbitmq/rabbitmq-server/discussions/17710)
describes a newly declared quorum queue losing its registry mapping during an
early SIGKILL. The maintainer confirms the delayed directory sync. The
[Ra 2.17.3 source](https://github.com/rabbitmq/ra/blob/v2.17.3/src/ra_directory.erl)
opens the registry with a 500 ms auto-save interval and does not synchronously
persist a new registration. This drill does not claim to repair that upstream
behavior or prove the crash safety of newly created queues without this setup.

After setup, the drill publishes 200 persistent messages and waits for each
publisher confirmation. The
[RabbitMQ 4.2 HTTP publisher](https://github.com/rabbitmq/rabbitmq-server/blob/v4.2.0/deps/rabbitmq_management/src/rabbit_mgmt_wm_exchange_publish.erl)
uses mandatory publishing and waits for `basic.ack` before reporting successful
routing. A passive AMQP declaration must then observe all 200 ready messages
with no consumers. The drill injects SIGKILL without any message-storage sync,
graceful shutdown or sleep after publishing.

A replacement container mounts the original named volume. Recovery must retain
the same node, Ra UID and storage paths, return all 200 confirmed payloads with
their original SHA-256 hashes, and contain no missing, duplicate, non-persistent
or additional messages. Metadata inspection after the crash is read-only.

The separate total-loss scenario imports exported definitions into a fresh
broker and verifies the quorum queue and binding. Definitions do not back up
messages; recovery from owner outboxes remains a separate system requirement.

## Failure evidence

`diagnostics.rabbitmq` records the stage, topology identities and initial AMQP
depth even when the component fails. Failure capture adds bounded broker logs,
mount information and quorum status. In particular, `name_not_registered` or a
changed Ra UID identifies replacement of the original queue member. A zero
AMQP count alone is not proof of deletion: RabbitMQ can also return zero when
the queue leader is unavailable. Payload reconciliation remains mandatory.

Run the scope regressions with:

```bash
node --test tests/production/E/recovery*.test.mjs
```
