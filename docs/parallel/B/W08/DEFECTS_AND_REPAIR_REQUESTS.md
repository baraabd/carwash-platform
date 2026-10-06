# Source defects and bounded repair requests

Observed source is `f0b76221c1a1991ba78327c019f0b4a0a7c53dff`.
**STATIC_SOURCE_ANALYSIS; runtime reproduction NOT_RUN; source repair BLOCKED.**
E's W07 hardening packet already retains these hazards. This fresh audit checks
the actual source and separates them from missing financial implementation.
The absent accepted W08 base permits analysis and B-local proposals; it does
not authorize changes to shared contracts, E infrastructure or a speculative
financial system. No defect is marked resolved by this packet.

## B08-D01 — final lease can strand an unpublished outbox row

Owner: **B, Catalog storage/runner; E, shared relay contract and integration**.
Source: `services/catalog/src/outbox/prisma-outbox.store.ts`.
SHA256 `433228770c17708dbdeaca27d29546675c4744def5c106e6546300b238354ee3`.

`leaseBatch` increments attempts on lease (line48), while its selection requires
`attempts < maxAttempts` (line55). Only `markFailed` sets deadAt (line109).
The runner's existing acceptance-only `--crash-after-lease` exits before
publication or marking failure. No expired-final-lease sweeper exists here.

For any positive configured maximum M, the source transition is:

| Step | attempts | publishedAt / deadAt | Lease and consequence |
| --- | --- | --- | --- |
| Before final lease | M−1 | null / null | Expired/free row qualifies |
| Lease commits | M | null / null | Worker owns live lease; attempt was consumed |
| Worker exits before publish/failure mark | M | null / null | No terminal update occurs |
| Lease expires; another worker polls | M | null / null | M < M is false; row cannot be leased |

The gap is concrete in the source predicate and transition, not a measured
PostgreSQL/broker outage or proof of lost financial postings. Current events
are foundation probes. Missing product models are a separate acceptance gap.

**Proposed narrow repair:** E/B first agree attempt accounting, lease-generation
fencing and exhausted-row semantics. Add a bounded owner-transaction recovery
path for expired unpublished final leases with a compare-and-set on the actual
lease generation and pending state. Preserve event ID/payload/history and
classify exhausted delivery as audited review/dead-letter, never paid or
consumer-acknowledged. Any authorized replay retains the original event/business
identity, requires current authority/reason and its own repair receipt. Broker
confirm/consumer uncertainty must remain explicit. No blanket attempt reset,
row deletion, automatic credit or unlimited retry is an acceptable repair.

**Required real gate:** seed an actual owned Catalog row at M−1, launch its real
relay in E's allocated DB/broker namespace, synchronize on committed lease,
crash before publish, observe expiry using the accepted clock mechanism,
restart and assert bounded recoverable/terminal classification with retained
identity. Also cut after broker confirm/before marking and prove replay yields
one consumer effect. Contend a live worker against the recovery transaction;
the recovery must not steal a current lease. Use M=1 and a larger accepted M as
test parameters, not production retry policy. Case W08-B-REC-06.

## B08-D02 — worker ID alone does not fence reused identities

Store terminal updates guard `locked_by=workerId` (lines88/110); they carry no
lease generation/token. Runner `parseArgs` accepts `--worker-id` (line54).
Its comment promises a stalled worker loses later write ownership, which needs
an enforced identity/lease rule stronger than merely accepting the same string.
If an expired lease is reacquired using the same ID, the old actor can satisfy
the new lease's ID guard. This is a static inferred interleaving; no stale-worker
write has been reproduced on a DB in this task.

**Proposed repair:** enforce unique process instances and a monotonically
changing owner-row lease token; shared interfaces must convey the token on
lease and every terminal update. B storage uses a transactional CAS; E owns
OutboxStore/relay type changes and accepted compatibility. Validate expired
lease, newer generation, reused label and stalled-worker resumption against
real PostgreSQL. A zero-row CAS is a lost lease, never successful publication.
Changing worker names alone does not prove per-lease fencing. Case W08-B-REC-06.

## B08-D03 — publishers accumulate channel listeners per pass

`services/catalog/src/outbox/relay.runner.ts` lines149–152 constructs a new
ConfirmingPublisher on the retained connection each pass. Shared
`packages/platform-messaging/src/publisher.ts` lines47/55 installs `return` and
`close` listeners and provides no disposal. SHA256s respectively
`e9faae9ff3184f9295e46a487046c290e0ed646a1977822a8921ba674f9382df` and
`6e0d578d026855688527d3ba65aaae97e35661b446e8ca3f5051fcaf8ad46151`.
This implies unbounded listeners/state on a long-lived channel; no runtime
warning, memory growth or money loss has been measured in this task.

**Proposed repair:** B reuse a publisher with the channel's lifecycle; E defines
and tests disposal/close/reconnect behavior, including pending confirms and
returned-message state. Reconnection must replace the publisher exactly once
for its channel and dispose owned listeners. Gate long-lived real passes,
unroutable returns, channel close, pending-confirm timeout and reconnect under
approved load; record actual listener/memory counts and no swallowed failure.
Case W08-B-REC-08. No shared package edits are included here.

## B08-R01 — future journal immutability must survive provisioning

E-owned `infra/postgres/provision.sh` grants default UPDATE/DELETE and regrants
them on all owner tables (lines98–99,106). Billing has no journal tables now;
this is a design/enforcement risk, **not an existing posted-journal exploit**.
Future accepted owner migrations and E privilege provisioning must agree on
immutable posted records. Real runtime-role SQL must fail to mutate/delete
posted journals both before and after reprovisioning; linked append-only
corrections use an audited authorized path. A TypeScript validator or a balanced
replacement total does not enforce this invariant. Case W08-B-SQL-06.

## Repair receipt and closure

All proposed fixes need actual accepted base/contracts, append-only migration
IDs where required, owned runtime handles, exact repaired head/tree/source
references and meaningful tests at the correct layer. Repaired source refs,
real DB/broker traces, measurements and independently reviewed closure are
currently **null / NOT_AVAILABLE**. Runtime identity/fencing and shared publisher
changes return to E; B never patches peer/global code. Current proposal-only
foundation CI can pass while these open hardening requirements keep full launch
NO_GO.
