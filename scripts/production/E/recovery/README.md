# Data-plane recovery drill

Run `node scripts/production/E/recovery/drill.mjs --report <file>` on a disposable
Docker host. The workflow retains the JSON report, including measured recovery
values and failures. Passing this drill is not production readiness or approval
of RPO/RTO targets.

## Source and owner coverage

The drill starts only from a clean committed checkout, with no untracked source
files. It records the exact commit and tree and verifies both again after the
recovery scenarios, cleanup and initial report write. A changed file, newly added
source or moved commit leaves `accepted: false` and a `failures.source` entry even
if every component recovered successfully. An initial source refusal records no
successful source SHA or tree and does not acquire images or run scenarios.

Keep the report outside the checkout, in ignored `.acceptance/`, or as a generated
JSON report under `evidence/` or `release/`. A report path that overwrites tracked
source or introduces an unapproved untracked file cannot receive passing evidence.

`ownerInventory` records every owner in `architecture/service-catalog.json`, its
database identities and its committed migration names and SHA-256 checksums. A
missing or empty migration directory, missing SQL file, duplicate owner or
mismatched identity fails preparation; no owner is silently omitted. PostgreSQL
acceptance requires the exact inventory, all committed migration checksums before
and after restore, unchanged migration history and table counts, runtime DDL and
migration-history denial, and the Configuration and Reviews append-only policies.

`sourceVerification.startedClean` and
`sourceVerification.finishedCleanAndUnchanged` must both be true. The final
`accepted` flag also requires no recorded failures and all five component results.
The regression tests use temporary Git repositories and synthetic component
outcomes to prove this reporting behavior. Actual crash/restore evidence is
produced separately by the Docker recovery workflow.

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
