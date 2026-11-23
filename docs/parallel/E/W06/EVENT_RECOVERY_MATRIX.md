# Event consumers and bounded technical recovery

**PROPOSED / NOT_ACCEPTED.** No listed business consumer, wire version, lifetime
or recovery API is implemented by this packet. The actual event registry exports
only the nonfinancial foundation probe and contract-only booking.confirmed.v1.

## Common consumer obligations to freeze

Each owner commits Inbox/application identity, payload hash, business effect and
audit atomically before ACK. Classify a duplicate from the durable winning
receipt and exact bytes; unrelated uniqueness/constraint errors are failures.
For the same event ID with different bytes, preserve conflict evidence and deny
the new effect. Transport delivery count does not establish business uniqueness.

Publish separate business-operation and event-delivery identities. Deduplicate
both retries of one operation and duplicated delivery; define cross-key domain
constraints. Retain owner revision/status and reject stale regression. An event
gap triggers the accepted authoritative history/status reconciliation path,
not an invented balance or successful completion. Retry only accepted transient
classes with durable bounded budget; park poison/conflict/unsupported versions
as owner-private quarantine under approved access/retention. RabbitMQ may retain
the original raw body; transport does not sanitize it. Only bounded redacted
metadata enters generic audit/CI. Dead-lettering is observable, not successful work.

For every row the owner must approve replay horizon, receipt retention, event
availability, privacy suppression and correction policy. These durations are
**UNRESOLVED**, not defaults. A delayed event cannot outlive dedup evidence and
be treated as a new logical financial action. Contracts must define handling
after expiry and retained evidence, including restored backups/projections.

## Required new consumer inventory

| Producer family                                                | Consumer and owned effect                                                      | Dedup/revision/replay requirement beyond the common profile                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing verified postings/allocations/corrections              | B Wallet balance reconciliation; B Subscription activation/correction          | Link exact immutable posting/allocation and holder/beneficiary; one eligible effect per original operation. Missing/gapped/stale reference cannot create funds or entitlements.                 |
| Billing payment/refund outcomes                                | C Booking compensation; D Support status; D Reporting projection               | Separate receipt, allocation, refund and booking/resource states. UNKNOWN keeps original operation reserved/reconciling; duplicate refund never repeats restoration.                            |
| Wallet hold/capture/release outcomes                           | C Booking saga; B Billing reconciliation; D Reporting                          | Hold/child IDs and revision; terminal transitions and UNKNOWN fencing. Replay cannot spend released funds, reopen a capture or turn custody into customer balance.                              |
| Subscription reservation/consumption/correction                | C Booking saga; D Reporting; approved A/D benefit reads                        | Stable original reservation/consume and benefit revision. Enforce domain uniqueness, once-only approved restoration and current eligibility independently of payment/capacity.                  |
| Booking completion/cancellation/work correction                | D Reviews eligibility; D Support binding; D Communications intent; D Reporting | Owner-complete work/booking revision and approved historical snapshot. Out-of-order completion cannot authorize an invalid review or resend notification.                                       |
| Workforce fleet/grant changes                                  | C Scheduling/Dispatch/Booking; D permitted fleet/read projections              | Current grant/resource revision, effective phase and policy. Capacity and assignment owners decide their own release/replan; eligibility event is not automatic compensation.                   |
| A Customer consent/contact/linkage changes                     | D Communications recipient authority; approved privacy coordinator/executors   | Current subject/purpose/contact revision; recheck protected dispatch/download. Historical consent events cannot restore revoked access or resend.                                               |
| C assignment/work membership changes                           | D Communications; C Media access; A/C/D authorized task-location consumers     | Current membership/work purpose and revision; revoke pending reads/sends under accepted policy, not cached routing alone. Task-location ownership must first be resolved E+C.                   |
| Support decisions/remedy status                                | D Reporting; A/D case reads; B authorized remedy provider                      | Support decision identity/revision versus Billing operation result. Technical replay never issues a new refund/remedy or claims completion locally.                                             |
| Reviews submit/edit/moderation/publication                     | D Reporting; A/D approved public/private reads                                 | Contribution identity/revision and moderation policy; edit/hide/reinstate/correction adjusts one contribution. Projection replay cannot publish or moderate source reviews.                     |
| Communications intent/attempt/delivery                         | D Reporting; A/C/D allowed conversation/status consumers                       | Logical intent versus stable provider attempt; monotonic sequence/read revisions. Accepted, delivered, read and UNKNOWN remain distinct; no external exactly-once claim.                        |
| C Media scan/finalization/grant revocation                     | Support/Reviews/Communications/export coordinators                             | Object/purpose/task binding and current grant; quarantined/missing/revoked evidence is not usable. Replay does not upload or disclose a private object.                                         |
| Identity access/session/subject linkage changes                | Approved owner executors and Gateway/current status routes                     | Current account/session/authVersion plus accepted object grant. E auth revocation does not imply another owner's privacy task is complete.                                                      |
| Privacy tasks/results/holds/suppression                        | Each owner executor; approved coordinator; D Reporting/C Media export paths    | Stable request/task/obligation/attempt revisions; each owner result and retained reason. Suppression survives retry/DLQ/rebuild/restore; completion is aggregated from required actual results. |
| Pricing/Catalog/promotion corrections and new Booking snapshot | W07 C Booking/A customer/D admin/Reporting                                     | Exact accepted quote/policy/redemption versions and new current resources. Old snapshots and old promotions cannot become current authority during rebooking.                                   |
| All owner history/snapshot/correction streams                  | W06 D Reporting recovery/rebuild proof; W07 expanded history/export            | Separate projection/application generation, high-water and privacy mask; no producer side effects. Freeze catch-up/atomic pointer switch and completeness before READY.                         |

## Existing foundation evidence and missing seams

Source tests, **not executed as W06 business acceptance here**:

- tests/integration/outbox-inbox.test.mjs commits/rolls back producer effects,
  crashes an actual consumer after probe effect/Inbox commit before ACK, tests
  competing distinct relays, stale distinct-worker leases and bounded failure.
- Its confirm-to-mark duplicate case manually clears published_at; it does not
  kill a relay after real broker confirm and before owner mark. The available
  relay crash seam is after lease, including a nonfinal recoverable lease.
- Broker outage queues a committed probe. Reconnect test restarts the broker and
  then publishes a new probe; queued/unacked business/poison recovery remains
  unproven. Poison JSON DLQ and restart-surviving transient budget are foundation
  tests, not proof of financial/refund/review/delivery policies.
- Reporting stores InboxMessage and ProbeProjection. There is no actual rebuild
  generation/checkpoint/history/export capability. Clearing a projection while
  preserving Inbox can suppress reapplication; clearing Inbox can repeat effects.
- E's two-stack harness proves PostgreSQL isolation only. Allocated broker/object/
  browser namespace strings do not provision or prove those resources.

Before business consumption, close the owner defects listed in
BLOCKERS_AND_DECISIONS.md with synchronized real DB/broker tests. Source analysis
alone is not a reproduced crash, a passing business case or exploit evidence.

## Proposed technical recovery operation

Accept the operation schema and owner authorization before implementing a tool.
Recovery uses scoped service identity/current operator purpose and an owner-local
receipt, never another service's SQL connection. A reviewable selection binds
service/environment, queue/application, supported contract versions, immutable
event IDs/hashes, failure category, cursor/high-water, approved limit and expiry.

Recheck current service/object/purpose authority at every protected item and
after restart, including revocation between selected items. A saved selection
grant is historical evidence, not continuing permission.

Persist operation identity/fingerprint/selection and current authority before
execution. Bounded batches record per-item owner disposition and progress;
competition/restart resumes that same operation. Replayed bytes/IDs remain the
original ones. A stale selection, changed bytes, revoked grant, wrong market/
service or exhausted replay horizon is rejected or left reconciling according
to the accepted owner policy. Audit metadata is bounded/redacted; receipt/event
payloads, credentials, customer media and provider data do not enter generic CI.

Keep poison/unsupported/conflicting rows quarantined until the appropriate
schema/producer fix and owner-approved recovery decision. Do not reset Inbox,
erase audit, regenerate an event/key, bypass grants or equate ACK with semantic
completion. Recovery replays technical delivery; Billing/Wallet/Subscription/
Booking/Support alone authorize their semantic correction/compensation.

Reporting rebuild must use a separately accepted side-effect-free application
identity/generation with owner-complete history, current privacy masks and live
catch-up fencing. Keep the live generation available until the replacement is
complete and an atomic pointer switch succeeds. Historical replay must not send
notifications, charge/refund money, restore entitlements or reopen work.

## Isolated execution and evidence

E allocates an explicit lane/wave/run environment and one measured heavy slot.
Prove owned DB/roles, broker/vhost/queues/DLQs, containers/volumes, object prefixes,
ports and browser profiles before faults; exclude production accounts/traffic.
Record actual process/container handles and release only owned resources with
awaited recovery before releasing the slot. Record each kill/restart boundary,
owner durable before/after receipts, actual broker redelivery and independent
convergence/read results on the exact source/run. No handles exist for this
proposal because no runtime stack or destructive exercise is started.
