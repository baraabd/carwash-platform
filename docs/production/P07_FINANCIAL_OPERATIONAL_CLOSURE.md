# P07 — financial and operational recovery closure

## Scope and source

This delivery follows the owner's 2026-11-23 instruction to implement P07
financial/operational closure before P08 launch gates. Its base is `develop`
`f8188f265223cd927ce8af4a41c87e416f39124d` (merged PR #147).

The historical traceability registry groups financial closure under P06 and
carries the P07-B1 finance-recovery and P07-C1 operational-recovery work into
that group. This delivery preserves those requirement identifiers. It repairs
demonstrable concurrency and owner-response defects in the existing services;
it does not replace the registry or claim completion of unrelated product screens.

## Closed failure modes

| Boundary | Failure before this change | Enforced behavior |
| --- | --- | --- |
| All seven transactional outbox stores | A stale worker could finalize a later acquisition when its worker ID was reused; most stores also accepted expired leases. | Success and failure require the worker ID, the exact acquired attempt number, a live lease, and an unpublished/non-dead row. |
| Catalog, Booking, Scheduling, Dispatch, Workforce, Configuration outboxes | A process dying on its final attempt left an invisible pending row that no worker could lease. | An expired exhausted row is parked with `LEASE_EXHAUSTED`, preserving its attempt number for diagnostics and fencing. Billing retains its registered-event filter. |
| Wallet custody projection | First delivery of distinct envelopes for the same absent receipt could plan concurrently; a newer collection envelope could resurrect/recount an existing receipt. | Owner-local transaction advisory locking serializes first delivery. A receipt can originate one collection; duplicates/stale versions remain non-effects and a new collection for an existing source is rejected. |
| Booking change replies | Dispatch responses from another change, or Scheduling responses for another booking, could advance the current saga. | The caller validates both booking and change identity before accepting the owner outcome. |
| Rescheduling pivot | A response could confirm a committed hold with a different zone or time range. | The exact requested hold, zone, start and end must match. Ambiguous committed state stays in the existing retry/attention path until authoritative replay reconciles it. |
| Dispatch private-media fences | A stale same-ID worker could complete or release a newer revocation lease. | Completion and retry require the lease attempt and unexpired lease. Media receipts must prove the requested object and actual revoked access. |

The shared messaging change is a technical storage-port change. Public API and
event schemas, database ownership, financial policy, approved UI references,
dependency pins and existing migrations remain intact. Each owner still owns
its outbox table and transaction.

## Acceptance

The added regressions exercise observable outcomes, including stale success
and stale failure, expiry before takeover, same-ID takeover, genuine owner
finalization, last-attempt crashes, duplicate receipt envelopes, reversed-receipt
recollection, wrong change/booking receipts, and mismatched committed slots.

The shared storage regression runs against actual PostgreSQL through the
compiled Catalog, Booking, Scheduling, Dispatch, Workforce and Configuration
adapters. Billing has its own registered-event PostgreSQL regression. Wallet
contention and Booking/Dispatch recovery cases extend their owner database
suites. These are wired into the existing mandatory foundation and business
acceptance CI families; mocked unit tests are additional evidence only.

Merge requires the exact PR head's build, typecheck, lint, formatting, design
and architecture guards, security checks, browser regressions, database/broker
acceptance and complete business aggregate to succeed. GitHub run artifacts
record exact-source results. Local diagnostic PostgreSQL runs are labelled by
their actual version and do not replace the canonical CI infrastructure.

## Operation and release boundary

Attempts are monotonic acquisition generations. An operator replay must never
reset attempts on an existing row; it must preserve the generation or create a
new explicitly audited row. Deploy each owner's relay and storage adapter from
one artifact, and drain superseded worker processes before reusing an explicitly
configured worker ID. Parked events require investigation and an audited replay;
parking is never a fabricated delivery confirmation.

No live money, deployment or production-readiness claim follows from merging
this delivery. P08 evaluates launch evidence separately. Official merchant
facilities, launch policy and deployment/operating authorization remain external
inputs to that evaluation.
