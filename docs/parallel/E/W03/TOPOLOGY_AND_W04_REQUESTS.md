# Durable topology, observability and W04 packet requests

This is read-only W03 pre-work, not topology activation or an accepted contract.

## Existing real technical path

Catalog `probe/probe.service.ts` commits FoundationProbe and OutboxMessage
together. `packages/platform-messaging/src/outbox-relay.ts` leases through
Catalog's `outbox/prisma-outbox.store.ts`; `publisher.ts` sends persistent JSON,
mandatory publication and publisher confirms. The technical defaults are a
30-second lease, batch 20, maximum 5 attempts and 10-second confirm timeout.
These existing values are not adopted business retry/expiry budgets.

Communications and Reporting each commit their own Inbox and local probe effect
before ACK through `inbox-consumer.ts` and service-local PrismaInboxStore.
Fingerprinting is SHA-256 of original UTF-8 bytes. Same ID/different bytes is
an integrity conflict when the existing row is found. The broad unique-error
race path and other adoption gaps are recorded in [the defect ledger](DEFECT_LEDGER.md).

Implemented exchange: durable topic `catalog.events`. Subscriber queues:
`communications.catalog.foundation-probe` and
`reporting.catalog.foundation-probe`; durable quorum queues with delivery limit 3,
and service-local DLX/DLQ. DLQs have no explicit quorum/transfer strategy here.
`infra/rabbitmq/acceptance-bootstrap.sh` provisions those three app identities
and the infrastructure topology identity, not Booking/Billing/Scheduling
business publishers or consumer topology. Consumer reconnect delay is bounded
(200 ms–5 s), while reconnect count/overall duration continues until cancellation.

## Activation and catch-up requirements

A positive confirm proves broker acceptance; mandatory return detects zero
matching queues. Neither proves every intended subscriber is bound or that a
consumer committed. If one queue matches while another required binding is
missing, mandatory publication can still succeed.

Declare and verify every accepted durable queue/binding/ACL before producer
activation. A stopped consumer process can later catch up only when its durable
queue/binding existed before publication. Creating a queue afterward does not
recover historical events automatically. Define the accepted source-history
reconciliation mechanism where later subscription is required.

Before activation, review producer-owned exchange/routing namespace; consumer-owned
queues/DLX/DLQ; vhost; configure/write/read ACLs; payload contract/version/parser;
aggregate ordering; retries and DLQ transfer/replay authority. Test unauthorized
producer/default-exchange/foreign-queue/vhost access, missing one of several
bindings, broker restart, unroutable publication and DLQ outage/recovery.
No new topology name or credential is invented or deployed by this document.

## Isolated composition, migration and safe observables

`infra/compose.acceptance.yml` runs PostgreSQL and RabbitMQ only. Per-run context
creates isolated project/volumes, loopback ports, work/evidence paths and secrets.
It does not launch all owners, gateway, frontends or Redis. The W01 allocation
helper and heavy-work slot are available; no W03 allocation is acquired here.

Current database setup covers all 19 data owners with distinct app/migration
roles; `infra/postgres/provision.sh` revokes public access, grants only own DML,
keeps migration separate, and hardens migration-table/schema privileges.
Existing denial pairs include Booking→Billing; add real app and migration-role
checks for every newly relevant combined-owner boundary with positive own controls.
All service-local histories remain append-only.

Fresh migration apply/no-op/drift and Identity's foundation-to-auth upgrade are
existing foundation cases. They cannot prove an upgrade from missing accepted
BASE_W02 product data. Obtain actual source/schema/data provenance and owner-owned
sanitized upgrade fixtures first.

Existing observability verifies UUID/W3C context, drops baggage/tracestate,
persists probe trace linkage, redacts sensitive values, uses finite metric labels
and protected metrics. Current readiness remains false for business shells.
Proposed safe views must identify capability, authoritative owner, operation
reference, observed time and recovery status; never expose OTPs, bearer tokens,
documents, contact/location details or full payment payloads. No business
recovery/readiness view exists at this source.

## Complete W04 request categories

| Authoritative owner              | Required next-wave slice                                                                                       | Review and acceptance boundary                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| C Dispatch                       | Assignment attempts, current eligible team/van, offer/accept/reject/timeout/reassign and release               | Distinct from capacity and Work; revisions/fencing and cancellation recovery                             |
| C Booking / Work                 | Persisted assigned Work, arrive/start/checklist/pause/finish/unpaid follow-up and cancellation                 | Current assignment/Identity/eligibility; explicit payment prerequisite policy                            |
| C Media                          | Work evidence reservation/classification/upload/scan/finalize/read/delete and consent                          | Real Work-purpose authority before activation; private object grants and revocation                      |
| B Billing                        | Authorized cash collection, receipt, corrections/reversal, expected-versus-received facts and reconciliation   | Independent of wash completion, proof image, custody and external payment verification                   |
| B Wallet with Billing references | Approved staff/team custody holders, handover/accept/reject/reconcile and settlement visibility                | Actual product actors/purposes; no customer stored-value funding, fourth checkout method or payroll      |
| D Communications                 | Booking/assignment/Work/finance notifications, participant grants, durable delivery attempts and safe catch-up | Required owner events; provider connectivity separate from fake transport; recipients/retention reviewed |
| D Reporting                      | Safe booking/capacity/execution/obligation/collection/custody projections and defect/recovery views            | Event-derived copy only; never authority to mutate source or declare money received                      |
| A/C/D consumers with E           | Customer/operator/admin exact view/action/error/recovery contract mapping and public clients                   | Preserve each approved surface; explicitly approve missing production states                             |
| E and every producer/subscriber  | Shared auth/errors/parsers, topology/ACL and source-bound integrated evidence                                  | Publish only at reviewed serialized W03 barrier                                                          |

New C draft #51, head `6a382fe4021aa61f3850f1d8cb0c082e3c488fcc`, supplies
`docs/parallel/C/W03/W04_CONTRACT_REQUESTS.md` as a received proposal. It identifies
an unresolved technician-location allocation: proposed Workforce ownership
versus older unaccepted Booking-owned active-Work location. Obtain an explicit
ownership/product record before dependent W04 writes; do not create competing
histories. Review current Work/assignment/consent grants, precision, freshness,
revocation and retention. Precise location must not be broadcast in generic
events; no public fleet or always-on tracking is approved here.

For **each** command/event and subscription, owners must provide:

1. Authoritative owner/consumer, exact contract ID/version/schema/export and reviewed
   immutable source; required/nullable/unknown-field and compatibility policy.
2. Actor, beneficiary/guest/service audience, object scope, delegation, current
   revocation and audit references; no guessed ID/contact authorization.
3. IDs, aggregate/entity/policy revisions, immutable snapshots, correlation and
   causation; UTC/server expiry and local-time display semantics.
4. Exact lossless money/currency/scale/rounding and financial fact represented;
   no invented price, recipient account, interval or expiry.
5. Allowed transitions and prerequisite guards; idempotency scope/canonical
   fingerprint/replay outcome/retention/tombstone/business uniqueness.
6. Errors, deadlines, bounded retry classification, unknown-outcome query,
   compensation owner/key/fence/outcome and durable exhausted-work recovery.
7. Producer transaction/outbox and consumer Inbox/effect/ACK atomic boundaries;
   raw-payload dedup semantics, old/gapped revision reconciliation and replay audit.
8. Exact exchange/type/routing key/vhost, durable queue/bindings/DLX/DLQ, publisher/
   subscriber/configuration identity permissions and deployment/catch-up order.
9. Real DB/HTTP/Identity/broker/provider/consumer fault cases; migration/rollback,
   safe observability/readiness, packages/configuration and unresolved decisions.

Existing planned service-catalog event names and strict booking.confirmed.v1
are not newly accepted W04 events. This proposal publishes no schemas, versions,
queues or BASE_W04.
