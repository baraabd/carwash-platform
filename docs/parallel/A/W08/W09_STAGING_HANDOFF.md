# W08-A proposed W09 staging and support handoff

Packet **w08-a-w09-customer-hardening/0.1.0 — PROPOSED / UNACCEPTED**.
This records requests one wave ahead. No shared schema/client/event is
published; no W09 implementation, staging deployment or operational exercise
starts here. E owns publication and resource/environment access; D owns its
support/admin consumers; A owns Customer/Vehicle/Geo data and customer views.

Carry forward [W07 W08 requests](../W07/W08_CONTRACT_REQUESTS.md), especially
W08-A-C01..08 and its proposed validation/source-bundle/load/screen metadata.
They are not accepted merely because their documents were merged. Freeze
exact owner schemas/clients/revisions/Money/time/errors and backward
compatibility before a common base and before this metadata is consumed.

## Closed metadata review requests

Requested metadata major V1 is an E-reviewed proposal, not a business endpoint
or event topic. Reject unknown fields/versions when a schema is accepted.
IDs, operation references and grants use the actual owner contract, not new
locally coerced strings. ISO instants are explicit UTC; display dates/times
use accepted Asia/Damascus facts and reviewed locale. Numeric measurements
carry metric/unit/window/profile; money always carries the accepted exact
minor string/currency/exponent/policy, never a floating point guess.

| Request / authoritative writer | Proposed request/response fields and version decisions | Provider/consumer gate |
| --- | --- | --- |
| W09-A-R01 SOURCE — A emits, E validates/releases | sourceSha/tree, cleanSource, package+lock+config SHA256, exact command/tool versions, per-asset path/bytes/gzipBytes/brBytes/SHA256, build/served manifests, approved contract versions; absent served evidence=null and NOT_RUN | Rebuild and verify actual same served bytes; no client grant/secret/private fixture inside assets, no map/config/traversal exposure. D receives minimal public release binding. |
| W09-A-R02 CASE — each owner emits, E gates | caseId/version, actor class, sanitized input reference, owner/preconditions, source/environment/profile binding, observed start/end UTC, result PASS/FAIL/BLOCKED/NOT_RUN, evidence hashes, required cases and explicit blocker list | PASS only after actual assertions against required real environment; no skipped/mock count conversion. Repeated report identity fingerprints all bound inputs; changed inputs create a new report. |
| W09-A-R03 PROFILE — product/E approve | profileId/version, workload/journey mix, device/browser/AT/network/CPU/memory, dataset/body/media bounds, warmup/duration/concurrency/rate; target metric/unit/comparator/value/percentile/window and approval reference; pending values=null | Reject unapproved/ambiguous target. A measures real complete build; D/support gets safe units and scope, not guessed SLA. |
| W09-A-R04 RECOVERY — actual command owner defines | original operation/key scope+canonical fingerprint, current actor authorization, immutable target/revision, durable status/outcome/lookup, safe retryAfter/deadline and partial effects; no duplicate issue on timeout | Real lost-reply/crash/expiry tests before A/D consumer; separate client cancellation from owner commit and explicit financial compensation. |
| W09-A-R05 SUPPORT — A/owners minimize, D consumes | public diagnostic code, affected operation type, approved correlation/receipt reference, source/profile binding and safe pending/retry instructions; contact/plate/precise location/private bytes/tokens excluded | Current object/purpose support grant and audit for any sensitive lookup; no blanket admin role, foreign existence leak or client-supplied role/header. |
| W09-A-R06 LOCALE — product/design approve, A implements | approved language/direction/state/copy/reference hashes, explicit number/currency/date formatter policy, required state list, device/AT evidence refs; missing approval=BLOCKED | Complete ar/rtl and required en/ltr errors/recovery/forms with real focus/AT and no locale/principal cache leak; untranslated fragments never PASS. |
| W09-A-R07 BACKUP — A data owners emit, E operates | service/migration/schema/contract versions, synthetic dataset and protected authority snapshot refs, approved RPO/RTO profile, scoped backup/restore result, invariant evidence hashes, access/audit/cleanup; sensitive records never embedded | Owned disposable restore, application role isolation, upgrade/constraints and preserved ownership/revisions/consent/history/idempotency. Marker restore is foundation only; real product dataset required. |
| W09-A-R08 DEFECT — actual source owner fixes | defectId/version, severity proposal and approved disposition, reproducer/source/evidence binding, reachability/environment limits, accountable owner, fix head/tree and failed-before/passed-after gates | Keep D01..03 and reference contrast debt open until real closure; static hypotheses distinct from reproduced failures; waived/blocked scope cannot become full acceptance. |

Metadata authorization, persistence/retention, strict schema size/page/query
limits, idempotency/replay lifetime, audit visibility and signed/verified
evidence reference policy are E/product review inputs. No request here
authorizes a new service, wire route, shared dependency or peer database access.
Existing closed V1 readers remain strict; breaking fields require an accepted
major/adapter and new common base before affected writers resume.

## Concrete staging scenario bundle for E/D

- Two actual customer accounts and separate guests on a shared device: logout,
  expiry, switch, background tab and late read/write/upload completion. Verify
  no stale private view or wrong-actor retry; safe support lookup remains scoped.
- Quote/promotion/last slot/hold expiry and explicit confirmation: two actors,
  lost success reply, reload/back/forward, duplicate same-key request and
  changed-meaning conflict. Inspect real receipts and independent Booking,
  capacity, payment and entitlement authority.
- Optional saved vehicle/address concurrent edit/archive/delete: no stale edit
  recreation, partial save reported independently, current serviceability and
  immutable historical snapshot. Include optional plate and manual location.
- Private proof upload replacement/reload/process quarantine/permission loss:
  revoke old access, reject stale generation, obey retained financial proof
  policy, genuine B verification and C Media grant; no local-file success.
- Slow/offline/reconnect under approved device/network profile: bounded reads,
  retained minimal safe input, same original operation lookup, truthful pending
  or conflict, no duplicate Booking/payment or automatic refund/rebooking.
- Arabic and approved English full affected flows, every error/empty/recovery
  state, sheets/focus/announcements, keyboard/AT/touch/OS+user motion. Canonical
  Linux pixels and separate Windows/real-device evidence remain distinct.
- Customer/Vehicle/Geo restore and populated upgrade in E-owned disposable
  namespaces, then unauthorized-role/foreign-object checks and replay guards.
  Original ownership, optional plate, address/consent/published geometry and
  permitted historical versions survive as accepted policy requires.

Use an approved synthetic dataset representing two principals/guests, optional
plate, archived records, conflicting revisions, expiry instants and independent
operation outcomes. At current source only ServiceMarker can be restored;
no accepted product backup dataset or complete recovery target exists.
Protected backup references never expose real PII or coordinates in this packet.

E provides existing staging identity/access/topology/configuration, owned
projects/ports/DB roles/vhosts/queues/object prefixes/browser profiles and
approved fault permissions. Start with one heavy slot and measure headroom.
Restore infrastructure and owned workers before the next case; report cleanup
failure and retain evidence. No shared down/prune/reset or broad kill.

Required independent review, latest target+head candidate, all mandatory and
affected integrated checks and actual resulting target verification precede
BASE_W09 publication. Live provider/money/refund/production destructive actions
require their applicable explicit authorization. This packet leaves them
pending without claiming staging or release readiness.
