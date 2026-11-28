# S10 hosted RabbitMQ definitions

Status: desired configuration and a reviewable provisioning mechanism. This document
does not record a hosted apply, deployed workers or accepted financial delivery.

## Fixed scope

The versioned hosted-topology.v1.json maps the 13 required processes in
infra/runtime-processes.json. Ten process roles use a broker identity; Billing's
two relays share one identity, giving nine owners. Communications delivery,
Media purge and Subscription funding recovery do not receive broker credentials.

The manifest defines 12 exchanges, 11 queues and 30 bindings. Its six main queues
retain native quorum types, delivery limits and dead-letter arguments. Wallet's
dead-letter queue remains quorum; the other native dead-letter queues remain
classic. One exact-name policy enables at-least-once dead-letter transfer and
reject-publish overflow for the six main queues only.

Runtime users have no tags. Resource grants use exact names. Topic permissions
explicitly deny unspecified writes and binding keys on all topic exchanges.
Subscribers configure their own queues/dead-letter resources, read their declared
producer exchanges and write their own queues when binding. No subscriber can
configure a foreign producer exchange or publish its facts. Wallet's direct retry
exchange is its own resource. Runtime users cannot read another owner's queues
or use the default exchange. DLQ reads are deliberately left to trusted operations;
the native workers consume their main queues.

The native Booking publisher does not publish the historical booking.confirmed.v1
key, although existing Communications/Reporting subscriptions recognize it.
Canonical Billing refund events are outside the two required relay allowlists.
Catalog keeps its real publisher and no default subscriber: unroutable publication
must remain pending. Neither legacy Catalog consumer is enabled by this profile.

## Protected inputs

Use Linux/POSIX owner-private directories (mode 0700) and regular files (mode 0600).
The CLI refuses relative paths, symlinks, another owner's files, public permissions
and output replacement. Files must be below a real, non-symlink private directory.
Correct permission failures through legitimate provisioning; do not relax the guard.

The credentials JSON has exactly these fields:

| Field          | Required value                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schemaVersion  | 1                                                                                                                                                                         |
| vhost          | Explicit dedicated vhost, 3–49 lowercase letters/digits/underscore/hyphen, starting with a letter                                                                         |
| usernamePrefix | Stable environment prefix ending in underscore, for example cw_staging_                                                                                                   |
| passwords      | Exactly billing, booking, catalog, communications, dispatch, reporting, scheduling, wallet, workforce; distinct independently provisioned passwords of 32–256 UTF-8 bytes |

The username is the prefix, owner name and _app. Keep the prefix stable for the
environment; do not change it to bypass a user conflict. Set each runtime's
protected BROKER_URL from that owner's same credential and exact vhost using the
approved secret mechanism. Applications never receive the broker-local Erlang
cookie or bootstrap authority.

New users receive salted SHA-256 hashes in the import file. Existing intended users
are accepted only when their exported SHA-256/SHA-512 hash matches the protected
credential and their tags/limits match this profile. Their rows are omitted from
the import. Unknown existing users are not reset. An intended runtime identity
with permissions in another vhost is refused.

Definitions exports contain password hashes and must be handled like credentials.
Never attach credentials, raw exports, import definitions, inspection files or
CLI child output to CI artifacts, a PR, chat or application logs.

## Capture, prepare, import and verify

Use broker-local rabbitmqctl as the trusted broker OS identity with its existing
private Erlang cookie. These commands require no management plugin or listener.
The Node tool operates on transferred private files; Node is not required inside
the plain RabbitMQ image.

Coordinate a topology maintenance window. Definitions import and the surrounding
reads are not one atomic transaction. Concurrent changes to users, grants, policies
or topology can invalidate observations. Capture fresh files before preparation
and again after import; refuse drift and investigate.

1. Export the complete cluster definition set to a private broker-local file:

```sh
umask 077
rabbitmqctl export_definitions /private/broker/definitions-before.json \
  > /private/broker/export-before.log 2>&1
```

2. For the exact credentials vhost, record these protected JSON inspections:

```sh
umask 077
rabbitmqctl -q list_exchanges -p VHOST name type internal --formatter=json \
  > /private/broker/exchanges-before.json 2> /private/broker/exchanges-before.log
rabbitmqctl -q list_queues -p VHOST name type exclusive --formatter=json \
  > /private/broker/queues-before.json 2> /private/broker/queues-before.log
rabbitmqctl -q list_operator_policies -p VHOST --formatter=json \
  > /private/broker/operator-policies-before.json 2> /private/broker/operator-policies-before.log
```

Capture stdout directly into owner-private files without displaying it, and keep
command diagnostics private. On a fresh installation where the complete export
proves the vhost absent, the three inspection arrays are empty. Do not substitute
empty observations when an existing-vhost command fails.

3. Transfer those files through the authorized private channel. Prepare the bundle
   and additive import in the local checkout:

```sh
node infra/rabbitmq/hosted-definitions.mjs bundle \
  --credentials /private/broker/credentials.json \
  --definitions /private/broker/definitions-before.json \
  --exchanges /private/broker/exchanges-before.json \
  --queues /private/broker/queues-before.json \
  --operator-policies /private/broker/operator-policies-before.json \
  --output /private/broker/snapshot-before.json

node infra/rabbitmq/hosted-definitions.mjs prepare \
  --credentials /private/broker/credentials.json \
  --snapshot /private/broker/snapshot-before.json \
  --output /private/broker/additions.json
```

4. Review non-secret counts and the intended manifest version. Transfer the import
   into a protected broker-local file, then apply:

```sh
rabbitmqctl import_definitions /private/broker/additions.json \
  > /private/broker/import.log 2>&1
```

Redirect import diagnostics into a protected file. Do not display raw definitions.

5. Export/inspect again into new after.json files and bundle them with the same
   credential/vhost binding. Verify:

```sh
node infra/rabbitmq/hosted-definitions.mjs verify \
  --credentials /private/broker/credentials.json \
  --snapshot /private/broker/snapshot-after.json
```

VERIFIED requires every intended definition/grant and zero missing additions.
It describes configuration observations only. Application connections, native
worker progress, queues/leases, provider outcomes and hosted journey acceptance
remain separate checks. Record exact source SHA, approved manifest, safe counts/
status and actual worker observations in release evidence.

The supported broker family is RabbitMQ 4.2. Its export omits internal exchanges
and exclusive queues; separate inspections detect them. Inspection field sets
must be exact. In 4.2 a quorum queue reports the unsupported exclusive info value
as an empty string; only that quorum-specific representation is accepted alongside
false. A classic exclusive queue is refused. Any target-vhost operator policy or
runtime parameter is refused; no override is silently ignored.

Existing desired-vhost grants, queues, exchanges, bindings and policies must match.
Unexpected state fails preparation. The tool never deletes, recreates or rewrites
existing definitions/messages. Unrelated vhosts/users remain untouched. A conflict
requires an explicit owner-reviewed migration; do not delete queues, reset unknown
users or broaden runtime grants to make preparation succeed.

## Source-bound verification

The pure tests in tests/production/E/hosted-broker-definitions.test.mjs check selection
against the runtime inventory, all owner resource/topic grants, additive replay,
conflicting/hidden-state rejection and protected-file/error handling.

The transport fixture in tests/production/B/hosted-broker-definitions.test.mjs uses
an existing disposable RabbitMQ CI container. Its runner provides the owned
container name, ownership label and loopback AMQP port through
CW_HOSTED_BROKER_CONTAINER, CW_HOSTED_BROKER_RUN and CW_HOSTED_BROKER_PORT.
A unique vhost and username prefix avoid collisions with existing acceptance users.

The fixture uses actual export/import commands and private files, authenticates
all nine identities, repeats their native declarations/bindings, exercises exact
publications and proves Catalog's unroutable return. It rejects Wallet's attempts
to forge Billing, read foreign queues, bind unauthorized topics, declare foreign
resources or use the default exchange. Replayed preparation/import must retain
user hashes and queued messages. Only opaque synthetic transport bytes enter this
isolated namespace; no financial event or projection is fabricated. Cleanup is
scoped to newly created resources and failures fail the fixture. Private files
are removed and never uploaded.

Integration must invoke this fixture from the existing b-reporting-broker family
after broker provisioning and before owner delivery assertions. Source tests and
a proposed fixture do not establish a pass: record actual final-candidate CI before
treating the mechanism as accepted.

## Primary references

- RabbitMQ 4.2 definitions: https://www.rabbitmq.com/docs/4.2/definitions
- Password hashes: https://www.rabbitmq.com/docs/4.2/passwords
- Resource/topic grants: https://www.rabbitmq.com/docs/4.2/access-control
- Quorum dead-lettering: https://www.rabbitmq.com/docs/4.2/quorum-queues#at-least-once-dead-lettering
- Export filters: https://github.com/rabbitmq/rabbitmq-server/blob/v4.2.0/deps/rabbit/src/rabbit_definitions.erl
