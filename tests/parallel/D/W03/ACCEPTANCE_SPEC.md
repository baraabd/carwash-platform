# W03-D — Required real-source acceptance specification

Status: **DECLARATIVE / ALL CASES BLOCKED_NOT_RUN**. No executable business test,
fixture, result or acceptance is created here. Existing guard tests are reported
separately in the handoff. Resolve BASE_W03/contracts/design/resource prerequisites
first, then implement these tests with real merged owners at exact source SHAs.

| ID | Concrete case / required assertion | Required evidence |
| --- | --- | --- |
| REV-01 | Other case/market/operator, guessed object and direct detail URL: deny access without metadata/document/existence disclosure | Real Workforce/Media/Identity HTTP + browser |
| REV-02 | Expired/forwarded private link or revoked object/actor grant: enforce the accepted access boundary; replay never extends grant expiry | Actual chosen Media storage/proxy + browser |
| REV-03 | Quarantined/unscanned/rejected document: no trusted preview or automatic approval; missing required document remains incomplete | Real Media scan/status and Workforce rules |
| REV-04 | Reviewer revoked during preview or before decision commit: next protected action denied, no stale-authorization commit | Real Identity/Workforce transaction + browser |
| REV-05 | Repeated submission and new revision/document replacement while old dossier is open: unique submission, immutable history, stale decision conflicts | Real Workforce DB/HTTP |
| REV-06 | Correction request → permitted resubmission → re-review: reason and required-field/document list persisted; no client-only success | Real private owner journey + browser |
| REV-07 | Simultaneous approve/reject/correction against one revision: one authoritative transition, conflict loser and no double work grant | Synchronized real DB transactions + HTTP |
| REV-08 | Lost decision response: same actor/scope/key/fingerprint replays original receipt; changed fingerprint conflicts; no repeat activation | Real HTTP fault injection + DB |
| REV-09 | Approval/rejection, document completeness, work grant and account suspension combinations: facts remain independent | Real Workforce/Identity; policy truth table |
| REV-10 | Approved activation appears in C operator application; later eligibility revocation invalidates authority there | Actual admin → Workforce → operator journey |
| REV-11 | Document/URL handling: no sensitive analytics/log/error/cache/storage capture; clearing selected case releases preview; expired grants never silently reused | Browser/network/log/storage inspection |
| BKG-01 | Paging boundaries and filter changes: actor/market/query/generation-bound cursor, no duplicate/missing/foreign rows | Real Booking HTTP + browser |
| BKG-02 | Status/customer/technician/date filters, malformed values and market timezone boundary: bounded owner-validated query | Real Booking/A display contract conformance |
| BKG-03 | Empty Booking list, unavailable/failed Booking/finance, older response after new query: distinct truthful states, no fixtures/zero totals/stale overwrite | Real downstream fault injection + browser |
| BKG-04 | List/detail revision, changed/deleted saved vehicle/address, optional plate and reassignment: immutable booking snapshot separate from current facts | Real owner reads; authorized minimal display |
| BKG-05 | Completed-but-unpaid Work, pending verification, paid cancelled booking, refund/custody/settlement pending: independent owner status with source revision/as-of | Real Booking/Billing/Wallet reads/events |
| BKG-06 | Unauthorized cursor, direct detail, revoked grant and cross-market ID: object/scope checks apply to every page and read | Real scoped HTTP + browser |
| PRJ-01 | Same event identity/bytes, sequential and concurrent: one effect; inbox/application/checkpoint commit atomically before ACK | Real Reporting DB + RabbitMQ |
| PRJ-02 | Same event ID/different hash race, both initial reads absent: one apply, one integrity conflict; no changed effect/checkpoint; conflict DLQ | Barrier-synchronized real DB/broker; INT-D-01 |
| PRJ-03 | Effect-table unique violation for a new event: rollback inbox/effect/checkpoint; error/recovery policy, never duplicate-success ACK | Real DB constraint fault + broker; INT-D-01 |
| PRJ-04 | Older/future/out-of-order revision, missing revision and late correction: no regression; gap visible until authorized repair; correction once | Actual owner event/snapshot/replay providers |
| PRJ-05 | Crash before commit, after commit before ACK, broker outage/reconnect and process/DB restart: no partial state/double count | Real allocated DB/broker/process recovery |
| PRJ-06 | Producer window absent or ingestion stops: explicit source/version/coverage/as-of/quality; no fabricated freshness or zero totals | Real delayed source/recovery + query/UI |
| PRJ-07 | Rebuild generations and concurrent queries: source-byte integrity retained, application uniqueness per generation, atomic read switch; no side effects | Real replay/checkpoint DB and owner APIs |
| PRJ-08 | Correction/reversal/currency-policy change: contribution replaced once per causal source; separate currency/policy totals; no historical rewrite | Real Billing/Wallet/Booking events |
| PRJ-09 | Delayed projection before a command: current authoritative owner read/revision/grant required; read projection cannot approve action | Real owner HTTP refusal + admin UI |
| PRJ-10 | Scoped query/audit grants and fieldsets: no cross-market PII, private documents/URLs or broadened access after rebuild | Real Reporting HTTP + privacy assertions |
| UI-01 | Approved review/correction/approval/activation and Booking states at 320/390/430/768/1024/1440 widths | Pinned Linux reference/candidate/diff; no new golden |
| UI-02 | Keyboard focus, modal open/close/return, RTL/LTR decisions, reduced motion and mobile gestures | Browser accessibility/interaction evidence |
| UI-03 | Separate Windows/device interaction proof for the affected real journeys | Actual Windows/device run, not Linux inference |

## Reporting test isolation and result classification

For PRJ-02, use two allocated real DB transactions synchronized after absent inbox
reads; verify the losing inbox-identity unique collision against the committed
winner's hash. Retain same-ID/same-hash as PRJ-01's positive control. For PRJ-03,
fail a different unique constraint inside the projection effect and prove the
entire transaction rolls back. Do not catch all unique violations as duplicates.
Existing sequential changed-payload coverage does not close either case.

E must accept the inbox namespace, event identity/aggregate revision/repair policy,
producer ACLs and D-owned DB/queue/run resources. Record migration IDs and tested
schema/source versions; checkpoint offsets cannot be broker delivery tags or wall
clock timestamps. Rebuild must not trigger notifications, bookings or cash writes.

Accept the owner providers independently first. Reporting then proves owned DB/
HTTP/broker invariants; admin proves the complete affected journey against real
merged providers. C operator visibility is mandatory before the combined W03
parent is accepted. All inherited mandatory CI remains required; no skip or fixture
can replace these scope cases. This specification does not authorize real money,
production deployment, destructive exercises or peer-source modifications.
