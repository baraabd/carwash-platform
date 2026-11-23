# W06-E blockers and owner decisions

All rows are OPEN. Static source findings below are not reproduced W06 runtime
failures; exact closure requires the responsible owner's real tests and reviewed
resulting target. Existing W04/W05 risks are carried forward without silently
closing them because their proposal PRs merged.

| ID      | Accountable owner                           | Finding / dependency                                                                                                                                          | Required closure                                                                                                                                                                              |
| ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E06-B01 | E + all source owners                       | No accepted BASE_W06, prior business barrier, exact next versions or reviewed contract release.                                                               | Actual predecessor provider/W04 cash/W05 money evidence, accepted registry/profile, latest-candidate/result-target checks and eligible independent review.                                    |
| E06-B02 | B/C/D/A producers; E integration            | Wallet/Subscription/fleet/Support/Reviews business producers absent; clients empty; Communications/Reporting only probes.                                     | Narrow real owner DB/migration/HTTP/Identity/constraints/contracts before coordinator and app acceptance.                                                                                     |
| E06-B03 | Product/B/C/E                               | Money/revision/holder/benefit/expiry/restoration policy unresolved; Wallet RELEASE draft requires postings; partial-cancellation restoration is not a refund. | Reviewed profile and action-specific compatible release, approved partitions/purpose/policy and real race/UNKNOWN/correction tests.                                                           |
| E06-B04 | D Inbox owners + E technical review         | Reporting/Communications catch any transaction P2002/23505 as DUPLICATE.                                                                                      | Identify the actual committed Inbox winner/bytes and constraint; synchronized same-ID/same-bytes and changed-bytes races plus unrelated effect uniqueness rollback tests on both real stores. |
| E06-B05 | B Catalog/producer outbox owner + E harness | Final lease increments attempts to max; a crash before mark can leave unpublished/nondead row unleaseable.                                                    | Explicit observable exhausted-lease reconciliation and real final-lease crash/restart proof; no silent loss/new event/key.                                                                    |
| E06-B06 | B relay owner + E publisher lifecycle       | A new ConfirmingPublisher is created per pass on a reused channel; listeners have no disposal.                                                                | Owner-reviewed reuse/disposal with bounded listeners over real repeated passes and no dropped confirms/returns/closure notifications.                                                         |
| E06-B07 | B lease owner + E fencing review            | Final writes fence only workerId; reused identity may not distinguish lease generations.                                                                      | Freeze unique instance/per-lease fencing and synchronized stale/reclaimed same-identity test. This is a source inference, not reproduced evidence.                                            |
| E06-B08 | E fault harness + B/D source owners         | Post-confirm/pre-mark actual termination, exhausted lease, race conflict and queued/unacked business broker-restart seams unproven.                           | Real scoped seams and independent owner receipts/convergence; retain original identity and awaited recovery before next heavy run.                                                            |
| E06-B09 | D Reporting + E topology/all producers      | No business revision/gap/history/rebuild/checkpoint/generation/retention/export implementation.                                                               | Accepted complete history/application generation/privacy contracts, real interrupted/competing live rebuild and secure export, no source actions on replay.                                   |
| E06-B10 | Product/E/A/B/D + every executor            | Privacy coordinator, W06-versus-W07 executor wave, subject linkage, owner obligation/results/copies/holds/export policy unaccepted.                           | Publish exact intake-only or automated workflow and each owner obligation; real current-authority/revocation/private export/partial result/retention evidence.                                |
| E06-B11 | E+C + Product                               | Task-location Booking-versus-Workforce authority, resource/employment and new production recovery/screen states unresolved.                                   | Accepted owner/revision/consent/freshness/retention and approved UI states; consumer implementation no earlier than real provider.                                                            |
| E06-B12 | D + A/C/E + channel/provider owner          | Delivery channels/provider status/consent/membership contracts and real support/review/media journeys absent.                                                 | Actual authenticated owner/providers and scoped private bytes; UNKNOWN reconciliation and replay without resend. No inferred SMS or fourth checkout method.                                   |
| E06-B13 | E + eligible reviewer/maintainer            | Preparation/source inspection is not independent approval, protected execution or target acceptance.                                                          | Read-only owner review, required independent review, exact final candidate/result gates and authorized process; no same-login self-approval.                                                  |

## Source evidence for carried messaging hazards

- services/reporting/src/inbox/prisma-inbox.store.ts and
  services/communications/src/inbox/prisma-inbox.store.ts catch uniqueness from
  the entire transaction and return DUPLICATE. The shared consumer ACKs that
  disposition. Sequential changed-byte test does not close a simultaneous race.
- services/catalog/src/outbox/prisma-outbox.store.ts increments attempts while
  leasing; selection requires attempts below maxAttempts. Only handled failure
  sets dead_at. Crash after the final lease has no observed reconciliation path.
- services/catalog/src/outbox/relay.runner.ts creates ConfirmingPublisher each
  pass. packages/platform-messaging/src/publisher.ts adds return/close listeners
  without disposal. locked_by=workerId guards finalization but not lease epoch.
- tests/integration/outbox-inbox.test.mjs manually clears published_at to simulate
  confirm-before-mark duplication; actual process crash seam is after lease.

These are permanent B/D sources and an E shared technical dependency. The expired
bootstrap lease grants no right to overwrite B/D product code. Send closures
through owner child PRs after accepted contracts; shared lifecycle work also waits
for the applicable accepted entry. This packet opens no remediation child by
stealth and introduces no production fallback.

## Decisions requiring owner input

Approve Wallet holders/purposes and custody versus spending boundaries; Subscription
beneficiary/unit/expiry/restoration; cash/electronic work-start/refund/compensation
policy; provider/Paymera scope and access; actual fleet/employment/launch geography;
privacy coordinator/execution wave/retention/holds/copies/export completeness;
task-location authority and privacy; channel protocols/current consent; missing
production/English/operator/admin states. Retain these as unaccepted inputs rather
than plausible fixture values. Continue independent E-local analysis and review.
