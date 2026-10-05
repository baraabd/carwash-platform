# W03-A — Seven-screen booking integration entry proposal

Task: W03-A / Lane A. Phase: **ENTRY_BLOCKED / PROPOSAL_ONLY**. Production implementation is **NOT_STARTED**, and the parent is not DONE or WAVE_ACCEPTED. This proposal supplies W03-specific screen/recovery decisions, acceptance specifications and the requested W04 contracts while dependent writes wait for the missing accepted base/providers.

## Current truth and predecessor delta

Observed target: `main@82e7402ed9ab6cc4f565f423441cd0655f2d627a`, tree `050b4b8a03be2bc671cbaa00151ea7105891e2d4`. PRs #46–50 merged the five W02 proposal packets. The delta from the earlier bootstrap target `3db1afdd04c6ec65a38ca83f3993c964a1bf7587` is exactly **31 new lane-local document/specification files**; product source, shared packages, schemas, migrations and workflows did not change.

A's entry packet now exists in merged [PR #46](https://github.com/baraabd/carwash-platform/pull/46). The registry still labels A `requested-not-received`; that field is stale intake metadata, not present-day evidence that the packet is missing. Proposal receipt/merge has not accepted its semantics. E owns registry reconciliation.

The current [contract release](https://github.com/baraabd/carwash-platform/blob/82e7402ed9ab6cc4f565f423441cd0655f2d627a/architecture/parallel-contract-release.json) still records `BASE_W02:null`, no `BASE_W03` key, no accepted next-wave contracts and no generated clients. `@carwash/api-clients@0.0.1` exports `export {}`; contracts/event-contracts remain `0.0.2`. Guest capability is unaccepted. W02 Customer/Vehicle/Geo durability and actual Catalog/Pricing/Scheduling/Booking/Billing producers remain unimplemented. A cannot connect real clients to these missing authorities by copying private DTOs or relabeling fixtures.

The current instruction ends E's W01 bootstrap permission; permanent A ownership applies to Customer/Vehicle/Geo product source. The old conditional lease record needs E publication reconciliation and does not restore E's expired write permission. Separately, the required accepted `BASE_W03`/contracts/providers are absent. No observed target or historical green head is substituted for that base.

## Concrete entry dependencies

| Requirement                  | Current evidence and required owner output                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common base and versions     | E completes the predecessor contract/barrier, real W02 provider/consumer acceptance and W03 contract publication; publishes full verified BASE_W03 plus exact compiled exports, validators, routes, errors and resource/gate manifest. Current main is observation only.                  |
| W02 customer foundations     | A's Customer/Vehicle/Geo providers and real guest/owner hydration must be implemented and accepted from their legitimate base. One-time booking inputs, optional plate and reusable-save opt-out remain possible. No peer database reads.                                                 |
| Catalog/Pricing              | B accepts real definitions/compatibility/duration and immutable quote/line/quantity/money/currency-policy/expiry contracts plus real providers. Reconcile the beneficiary-context extension and opaque versus numeric revisions; browser illustrativeCost cannot issue a quote.           |
| Scheduling/Booking/Billing   | C/B accept availability/hold/reservation/confirmation/recovery/obligation contracts and real producer children. Quotes, holds and Booking bind the same verified beneficiary; self and admin create-on-behalf stay separate. No browser-owned capacity or payment success.                |
| Identity and ingress         | E accepts real guest/member/delegated transport, current authorization/CSRF, explicit auth modes, allowlisted owners and query/precondition/response headers. Current Gateway cannot carry the proposed semantics merely by naming routes.                                                |
| Real operational inputs      | Approved Aleppo geography/hours/precision/provider/boundary policy, catalog/prices, payment/cancellation/recovery/consent and retention policies are required. C's mandatory proposed consentRef needs reconciliation with approved purposes; no fictional blanket consent is introduced. |
| Production visible states    | Product/A approves exact Arabic loading/unavailable/price-change/hold-expiry/unknown-outcome/optional-save failure and disabled electronic execution copy and placement. Existing demo disclosures remain honest; no unapproved screen or English UI is inferred.                         |
| Resources, checks and review | E issues lane/wave/run resources and actual commands; use pinned Node 24.21.0/pnpm 10.32.1, canonical Linux parity and separate device evidence. Independent review, unchanged candidate refs and actual resulting-target checks remain required.                                         |

Existing merged A [W03 request packet](../W02/W03_CONTRACT_REQUESTS.md) already specifies snapshot/serviceability/quote/hold/confirmation proposals. This child references it rather than republishing a competing wire definition. New B/C/D/E W02 packets remain proposals; the new read/recovery/beneficiary/quantity details require affected-owner reconciliation before acceptance.

## Proposed producer and consumer sequence

Names are review boundaries to agree with E, not implementation sprints started by this proposal.

1. **Predecessor acceptance**: E contracts/barrier publishes BASE_W02; accepted Identity/guest/Gateway, A Customer/Vehicle/Geo, B Catalog/Pricing and required policy/workforce providers plus their real W02 consumers precede publication of BASE_W03. The accepted W03 release includes reviewed Booking/Scheduling/Billing contracts and clients.
2. **W03-B-OBLIGATION-PROVIDER** and **W03-C-SCHEDULING-PROVIDER**: real owned DB/auth/constraint/replay/expiry/unknown-outcome evidence; accept each narrow producer without requiring the future A frontend.
3. **W03-C-BOOKING-COORDINATOR**: consume merged real quote/snapshot/Geo/capacity/financial providers; prove durable intent uniqueness, saga/compensation and independent capacity/payment facts before app consumers.
4. **W03-A-BOOKING-CONSUMER**: consume published clients against already accepted producer checkpoints from E; integrate all seven screens, six review edits and recovery/handoff with full affected browser/authorization/parity tests before its merge. D owns the corresponding admin consumer; no moving peer branches or local fixtures close this gate.
5. **W03-E-BARRIER**: exact combined-source and all-three-app scenarios, independent review, mandatory gates and resulting-target verification; only then publish BASE_W04 and advance parent acceptance.

Same A-owned source has one writer at a time. A missing/breaking dependency pauses only its dependent writes until reviewed contracts and a new common base exist. No automatic W04 runtime work, merge, production deployment or live-money operation follows from this packet.

## Packet index

- [SCREEN_FACTS_AND_RECOVERY.md](SCREEN_FACTS_AND_RECOVERY.md): seven actual screens, six edit loops, invalidation/stale-response/unknown-outcome proposal and session-demo limits.
- [W04_CONTRACT_REQUESTS.md](W04_CONTRACT_REQUESTS.md): owner-versioned order/tracking/payment/cash/media/cancellation read proposals and all-three-app scenarios.
- [ACCEPTANCE_SPECIFICATIONS.md](../../../../tests/parallel/A/W03/ACCEPTANCE_SPECIFICATIONS.md): task-listed real-provider and browser cases, explicitly unexecuted.
- [CHECKPOINT.md](CHECKPOINT.md): English source-bound handoff, actual commands/results, blocked cases, resources and resume condition.
- [source-observation.json](source-observation.json): compact immutable target/registry/delta/check facts.

## Arabic status

دُمجت حزمة A السابقة مع بقية مقترحات W02، لكن لا توجد قاعدة W03 أو عقود وعملاء ومزوّدون فعليون معتمدون. هذه الحزمة تحدد ربط الخطوات السبع والاسترجاع وطلبات W04 وتوثق اختبارات القبول المطلوبة؛ تنفيذ الحجز الحقيقي ما زال متوقفًا على المتطلبات المسماة أعلاه. نجاح اختبارات نموذج الجلسة لا يثبت إنشاء حجز دائم أو دفع أو حجز سعة فعلي.
