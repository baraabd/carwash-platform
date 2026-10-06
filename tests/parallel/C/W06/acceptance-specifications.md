# W06-C acceptance specifications

All 24 families BLOCKED_NOT_RUN. No executable harness, mocked business success or real integration run is claimed. Preconditions: verified BASE_W06/contracts/policies/W05 recovery, actual merged B and C providers/current Identity, approved Aleppo data/UI/privacy and E isolated run/gates.

| Case | Real exercise and assertion |
| --- | --- |
| C1-01 Last entitlement | Two distinct Booking operations race B last unit; one allowed commitment, truthful loser; unique receipts/no underflow |
| C1-02 Funds race | Two bookings compete for approved final funds; no overcommit/duplicate posting or capture |
| C1-03 Denial | Insufficient funds/wrong holder/purpose/currency/benefit; current denial, acquired resources compensated |
| C1-04 Expiry | Commit versus hold/benefit/capacity expiry at approved boundary; retry does not extend TTL/revive slot |
| C1-05 Cancel/retry | Cancel each boundary; same/conflicting/new key effect uniqueness, no double debit/redemption |
| C1-06 Crash matrix | Crash before/after each capacity/entitlement/Wallet/Billing remote commit and lose replies; durable lookup/restart/compensation or explicit review |
| C1-07 Capture unknown | Claimed Wallet and unknown Billing versus expiry/release; funds unavailable until same posting reconciled |
| C1-08 Partial commit | Consumed benefit or committed Wallet followed by failure; distinct B approved correction/refund/restoration, immutable originals |
| C1-09 Broker | Crash commit/publish/inbox/ACK; duplicate/hash-conflict/old/gap/reordered events, no regression/orphan/double effect |
| C1-10 Authority | Foreign member/guest/holder, revoked service/session/delegation, replay after revocation; denied with valid controls/no enumeration |
| C2-01 Compatibility | Approved Aleppo capability requirements; incompatible/duplicate resource/member/wrong-market denial and valid control |
| C2-02 Exclusivity | Concurrent team/member/van/equipment overlap, adjacency/multi-resource deadlock retry; DB prevents forbidden overlaps |
| C2-03 Time | Overlapping shifts/local-day/UTC boundaries and approved ambiguity/buffer/leave exception rules |
| C2-04 Maintenance | Downtime versus reservation/accept/start; current revision fence, safe reassignment/review/no leak |
| C2-05 Suspension | Document expiry/suspension after accept before start; authoritative race fence, approved active-work safety, stale event denied |
| C2-06 Lifecycle | Onboard/review/approve/renew/expire/reactivate/offboard actual authorized graph/audit; no history rewrite/stale assignment revival |
| C2-07 Admin HTTP/work | Real scoped admin Workforce review/team/van/equipment, Scheduling eligibility and Dispatch assignment for approved Aleppo job; independent operator execution plus wrong/stale grants denied |
| C2-08 Readiness | Identity/eligibility/resource/readiness/custody independent; switch grants no job or money, uncertain source fails closed |
| C2-09 Media | Current reviewer/object/purpose scan/finalize/read/derived access; foreign/revoked/quarantine/unscanned/expired denial, clean is not approved |
| C2-10 Privacy | Required scoped export/anonymize/retention/legal holds/current download and outage recovery/copies; else truthful request-only, no deletion success |
| SH-01 DB upgrade | Actual append-only C upgrade/constraints/indexes/unique effects/concurrency/role isolation/recovery; no peer table/db reset |
| SH-02 UI source | Real affected operator/A/D reload/disconnect/deep-link recovery and independent pending/unknown/denied/review/freshness; D full fleet browser separately W07 |
| SH-03 Interaction | Approved Arabic RTL/English LTR/focus/keyboard/loading/denial/reconnect/reduced motion; pinned Linux reference/candidate/diff, separate Windows/device; missing approval BLOCKED |
| SH-04 Conformance | Real provider HTTP/Identity/versioned event/client on exact combined source; mandatory CI and explicit frontend commands from manifest |

Evidence per case: exact base/head/tree/target/candidate/resulting-target, contract/policy/data refs/migrations, current principals without secrets, operation/reservation/posting/correction IDs, owner before/after revisions, injection point, broker checkpoints, commands/results/artifact links. Real versus fixture evidence distinct. Own allocated ports/DB roles/queues/objects/temp/browser namespaces and handles; clean only own resources. No live money/refund/global deletion/shared reset/deploy. Both reviewed children and all combined cases required; Day4 or docs CI never marks parent DONE.
