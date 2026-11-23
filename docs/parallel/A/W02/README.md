# W02-A — Durable customer foundations: prerequisite proposal

Task: W02-A, Lane A. Status: **IMPLEMENTATION_BLOCKED / ENTRY_PACKET_SUBMITTED_FOR_REVIEW**. No production contract, wave base, policy or service implementation is accepted by this proposal.

## Resulting behavior

This narrowly scoped document/test-specification PR supplies A's missing contract packet to E. The currently merged E registry explicitly marks A's Customer/Vehicle/Geo packet `requested-not-received`; B/C/D have merged proposals pending review. The packet makes the missing guest/security, client, market and data-retention decisions reviewable so E can publish the common contract release.

No Customer/Vehicle/Geo HTTP endpoint, durable record, migration, frontend hydration, broker side effect or geographic coverage was implemented. The requested W02 data functionality remains blocked until the required accepted contracts/base/inputs exist. No root/shared/E-owned file is changed.

## Source and branch boundary

Observed current main: `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`, merged E bootstrap PR [#45](https://github.com/baraabd/carwash-platform/pull/45). Recorded `BASE_W01` is `69d81a83a3409d0693272efeb19ebeb9805750f5`. **BASE_W02 remains null.** Bootstrap merge alone does not publish it.

`proposal/w02-A-entry-contracts` is a proposal branch based on the observed latest target, not a W02 implementation branch based on an invented wave base. The supplied task permits read-only analysis and lane-local proposals while the base/contract barrier is missing; E's `docs/parallel/E/W01/CHILD_SPRINTS.md` also permits narrow packet-only PRs before contract acceptance. No dependent product writes were made and no earlier sprint was reopened.

The new prompt states that the W01 bootstrap lease has expired, but its entry requirement explicitly conditions implementation on verified BASE_W02. The merged ownership registry still says `verifiedBaseW02:null`, with lease expiry at verified BASE_W02. This inconsistency must be reconciled by E before editing leased service paths; it is not treated as evidence of accepted contracts.

## Packet index

- `ENTRY_CONTRACT_PACKET.md`: complete proposed Customer, Vehicle, Geo and Identity guest vocabulary/operations; auth, revisions, idempotency, errors/deadlines/recovery, events, minimal admin booking beneficiary lookup and later W07 management.
- `ENTRY_PREREQUISITES.md`: refreshed source inventory, exact blockers, decisions and provider/consumer child sequence.
- `W03_CONTRACT_REQUESTS.md`: ownership-safe quote/snapshot/serviceability/slot/confirmation recovery requests aligned with peer proposals.
- `CHECKPOINT.md`: English resumable handoff, immutable source/head/tree, exact commands/evidence, mocks and skipped cases.
- `source-observation.json`: immutable source/check/registry facts, with historical baseline labels separated from current source.
- `tests/parallel/A/W02/ACCEPTANCE_SPECIFICATIONS.md`: concrete unexecuted real-DB/HTTP/guest/concurrency/restart/geography/app acceptance matrix.

## Arabic status

تم تحديث الفحص بعد دمج تهيئة E. Customer وVehicle وGeo لديها قوالب تشغيل تقنية، لكن نماذج البيانات والعقود والعملاء المطلوبة لـ W02 غير معتمدة. حزمة A هنا مقدمة للمراجعة، ويظل التنفيذ الدائم وربط الواجهة متوقفًا على نشر BASE_W02 وقبول نموذج الضيف وتوفير بيانات تغطية حلب وسياسات الحفظ والخصوصية. نجاح اختبارات التهيئة لا يثبت اكتمال وظائف العميل.
