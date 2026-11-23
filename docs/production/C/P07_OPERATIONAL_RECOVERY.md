# P07 — operational recovery and correlated owner receipts

Baseline: `develop@f8188f265223cd927ce8af4a41c87e416f39124d`.
This correction addresses the owner's financial/operational closure request of
2026-11-23. It preserves the original P06/P07 requirement identifiers and the
approved interfaces. It is not a production deployment or a release authorization.

## Booking change receipts

Booking previously checked the booking id in a Dispatch change response but
ignored its change id. A successful response for an older cancellation, rebind,
confirmation or compensation could therefore advance the current saga.
`DispatchChangesAdapter` now requires both identifiers for all successful and
replayed outcomes. An absent or different change id stays `UNKNOWN`; the same
idempotent request is retried. Scheduling's replace response must also identify
the requested booking in its envelope, in addition to its committed hold.

The replacement pivot now compares all four selected slot facts: hold id, zone,
start and end. An owner response for a different slot stays at
`REPLACE_COMMITMENT` with `COMMITTED_SLOT_MISMATCH`. The existing bounded backoff
and attention threshold apply. It neither writes an unselected Booking schedule
nor confirms Dispatch, and it does not compensate an owner operation whose
outcome is uncertain. Once the owner replays the exact committed target, the
durable saga finishes and emits one schedule event.

## Evidence fence worker leases

Dispatch queues revocation of a superseded technician's access to work photos.
The queue previously identified a lease only by its worker id and accepted
completion after expiry. A restarted worker could reuse the id, allowing a
stale request to complete or reschedule its replacement lease.

Both completion and retry now require the current worker id, the monotonic
`attempts` value returned by leasing, and an unexpired lease. This uses the
existing column; there is no data migration or public contract change. Every
retry still uses the same Media idempotency key. Failed revocations remain
durable and retryable, and already confirmed revocations stay final.

Dispatch now validates the Media receipt as well as its HTTP status. Inspection
must identify the requested object; a claim must identify that object, the exact
claim and the Dispatch holder; a fence must identify that object with
`ownerAccess: REVOKED`. An unrelated or still-granted 2xx response never marks
the durable privacy request complete.

## Verification

The regression tests are part of the existing mandatory `c-booking` and
`c-dispatch` acceptance families:

- Booking HTTP adapter tests reject missing/foreign change receipts for every
  recognized Dispatch success and replay outcome.
- Booking domain tests vary the committed hold, zone and both timestamps,
  assert that none advances the pivot, and verify attention and exact replay.
- Booking PostgreSQL change tests apply a Scheduling effect, return incorrect
  owner evidence, and verify the unchanged local schedule, zero premature
  events/Dispatch confirmation, durable attention, and one eventual recovery.
- Dispatch PostgreSQL task tests create a real task/evidence/reassignment,
  expire and reclaim its fence using the same worker id, and prove that stale
  completion/retry cannot alter the current lease. The current generation alone
  can record retry or complete the fence.
- Dispatch Media HTTP adapter tests reject wrong-object reads, incomplete or
  unrelated claims, and successful HTTP responses without a verified revocation.

The PostgreSQL tests use real owner databases, runtime roles, locks, triggers,
audits and outboxes. Their other owner ports remain explicitly labelled doubles
in the existing harness. They do not represent live merchant, object storage,
or production operating-window evidence. Final test outcomes belong to the
candidate's CI artifacts and release report.
