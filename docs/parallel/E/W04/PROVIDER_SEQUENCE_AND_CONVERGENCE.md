# Conditional provider sequence, topology and observable convergence

All children are **proposed / BLOCKED**, not scheduled or implemented. Branches
must use an actually accepted common base, never a moving peer feature branch.
Each provider gets real owned DB/migrations/constraints/HTTP/Identity/conformance
gates before its consumer; every app consumer proves its full affected journey
before merge. Parent W04 remains INTEGRATION_PENDING after runtime starts until
all combined cases and final-target checks pass.

## Dependency sequence

| Child / writer                                 | Narrow boundary and predecessor                                                                              | Required acceptance before consumers                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| E-PREDECESSOR-BARRIER / E + independent review | Reconcile permanent ownership, actual predecessor providers/contracts and BASE_W04                           | W03 persisted booking/guest/capacity/recovery tests; frozen dispatch/work/media/cash/notification contracts and current-source required gates |
| C-WORK-AUTHORITY / C                           | Existing accepted Booking/capacity/Workforce authority; Dispatch assignment and Booking execution separately | Two-tech accept race, current grants, stale revision, transition replay, restart and one assignment/work effect                               |
| C-PRIVATE-WORK-EVIDENCE / C                    | Narrow accepted work/assignment binding → Media → work completion consumer                                   | Real object store/scanner, private reads/revocation/checksum/finalization and completion prerequisites                                        |
| B-CASH-COLLECTION / B                          | Accepted obligation plus narrow authorized work/actor facts                                                  | Durable collection/receipt/ledger constraints, same-key replay/lost response and delivered-but-unpaid                                         |
| B-CUSTODY-AUTHORITY / B                        | Accepted collection posting → Wallet pending handover authority                                              | One referenced custody effect and exact balance; no duplicate ledger                                                                          |
| B-TREASURY-SETTLEMENT / B                      | Accepted narrow custody/handover authority → Billing treasury posting                                        | Real signed authority, replay/conflict, balanced immutable separate treasury posting                                                          |
| B-CUSTODY-RECONCILIATION / B                   | Accepted treasury posting → Wallet acceptance/reconciliation                                                 | One handover acceptance, crash recovery and exact holder/treasury totals                                                                      |
| D-JOURNEY-CONSUMERS / D                        | Accepted real source events/queries                                                                          | Transactional inbox/projections, notifications audience/idempotency, gaps/rebuild and authorized admin review/finance reads                   |
| A-C-D-APP-CONSUMERS / respective owners        | Accepted providers and approved production states                                                            | Customer receipt/tracking/private comparison, operator execution/unpaid/collection, admin assignment/reconciliation on actual apps            |
| E-CASH-INTEGRATION / E                         | Latest serialized accepted producer/consumer target                                                          | All three browsers, adversarial cases, resource isolation and evidence bundle; current candidate and resulting-target gates                   |

Split the cash/custody feedback loop: Billing collection → Wallet narrow pending
handover → Billing treasury settlement → Wallet reconciliation → app consumers.
Do not demand an indivisible mutually dependent Billing+Wallet+apps PR. Similarly
accept narrow work/object bindings before evidence consumers; do not require a
finished screen as a provider's conformance fixture.

If an approved policy requires a receipt before final work closure, split narrow
durable Work facts → Billing cash provider → final Booking closure consumer.
Do not make cash collection depend on already-final closure while closure depends
on collection. Delivered-but-unpaid remains a required distinct outcome; resolve
the exact operator closure/payment policy without conflating the facts.

## Required durable topology before producer activation

Existing real broker setup is the Catalog foundation-probe exchange and two
Communications/Reporting subscriber queues, not W04 events. E must accept an
exact producer/event/subscriber matrix with owner packets before enabling them.
Proposed producers include Booking, Dispatch, Workforce, Media, Billing and
Wallet; subscribers include only individually reviewed source consumers,
Communications and Reporting. Do not broadcast every private event to every lane.

For each accepted event record vhost, exchange name/type/routing key/schema version,
authorized publisher identity and each principal's configure/write/read ACLs,
including denied default-exchange, foreign-queue and foreign-vhost operations;
required independent durable subscriber queue/binding,
quorum/retry/delivery-limit/DLX/DLQ strategy, retention, replay authorization and
resource prefix. Keep each subscriber's queue separate. Verify all required
bindings before publication: mandatory confirm only detecting zero matches does
not prove every intended subscriber received the message. A stopped process with
an existing durable queue must catch up; a queue created after publication has no
historical delivery guarantee.

Outbox+business transaction and Inbox+effect transaction are owner responsibilities.
Require immutable event identity/hash, authorized producer checks, safe duplicate
classification, replay/gap handling and audited poison/exhausted-work recovery.
Broker/DLQ failure, confirm→mark crash and consumer commit→ACK crash must be real
fault tests. Existing W03 static Inbox/Outbox/listener risks remain open and are
not corrected by this packet.

## Convergence contract before the run

E proposes harness ceilings of **30 seconds** for steady-state projection arrival
and **120 seconds after the selected service is healthy again** for restart/replay
convergence. Also propose **60 seconds** from restart invocation to readiness and
an **outer 180-second fault-case deadline** from fault injection through recovery.
Never-healthy restart fails its readiness deadline; the earlier inner/outer limit
wins and no subprocess can outlive it. Cleanup retains a separate bounded recovery
scope. These are provisional test budgets, not operating SLAs or accepted
provider guarantees. Each provider/consumer must accept or replace them with
measured bounds in the pre-run manifest. With bounds unset/unreviewed, the case
is BLOCKED before execution; never extend a deadline after a failing run.

The oracle waits for causal facts: read the durable command result and source
revisions, then poll bounded authorized queries until each consumer's applied
revision vector covers the expected source vector and all exact amounts/references
match. A missing vector/gap/status endpoint is a provider contract blocker.
Zero arbitrary sleep assertions, no reliance on a WebSocket animation or queue
depth alone. Polling uses a declared capped interval/backoff and monotonic elapsed
deadline; record commit, availability and convergence instants plus lag.
Thread cancellation and remaining-time limits through every poll/subprocess.
Current waitForPostgresReady omits its signal and gives subprocesses a fresh
60-second budget; review that E-owned harness risk before adding W04 runtime gates.
An HTTP timeout is UNKNOWN_OUTCOME: recover by the same operation receipt/status
lookup, not a new payment or completion key.

For negative cases assert the explicit rejected receipt/status and owner-local
absence of effects, then inspect relevant consumer checkpoints after the bounded
window. Unauthorized response status alone is insufficient if a forbidden
posting/object was already created. End-of-run drain must account for all expected
events and disclose pending retry/DLQ/saga work; a timeout is a failed gate once
entry was satisfied, not a passing skip.

## Isolation and telemetry

Allocate W04/lane/run-specific Compose project, ports, separate DB/runtime/migrate
roles, broker vhost or safe prefixes, object namespaces, evidence/temp paths and
browser profiles. One heavy slot initially. Record owned process/container handles
and clean only those handles. No runtime resources are allocated by this proposal.

Use three independent browser contexts/process profiles for customer, technician
and admin; a separate adversarial second technician principal/context exercises
the race. Never share cookies, guest authority, storage or login redirects across
actors. A selected real service process is killed at a deterministic accepted
window and restarted against its persisted owned DB, not replaced by a mock.

The future manifest binds full target/head/candidate/result SHA+tree, clean source,
ordered candidate parents, tool/image digests, context allocation, role identities,
contract/policy versions, UTC instants, source revision vector, command/event
correlations, exact Money and redacted evidence digests. Preserve trace propagation
through Gateway, owners, Outbox/Inbox and projections; no IDs as unbounded metric
labels, secrets/signed URLs/addresses/images in CI logs or repository artifacts.
