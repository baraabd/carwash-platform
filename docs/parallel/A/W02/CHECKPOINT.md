# W02-A — Resumable technical handoff

Task/owner: W02-A / Lane A. Phase: **PROPOSAL_READY / IMPLEMENTATION_BLOCKED**. Parent functionality is not DONE or WAVE_ACCEPTED. This packet supplies a missing owner proposal; contract receipt, proposal merge, contract acceptance and wave publication are separate facts.

## Immutable source and review boundary

- Observed latest target and proposal parent: `main@3db1afdd04c6ec65a38ca83f3993c964a1bf7587`; tree `5b51ed5f1779a2cbefc359fdbdc4720779989b4b`.
- Recorded BASE_W01: `69d81a83a3409d0693272efeb19ebeb9805750f5`. **BASE_W02 null; no accepted W02 implementation base.** Do not reset to historical observations or promote current main by assumption.
- Own worktree: `/workspace/scratch/6a9547568741/carwash-w02-source`; branch `proposal/w02-A-entry-contracts`. The previous worktree and unpublished W01 artifacts were preserved.
- Proposal head/tree are recorded in the draft PR body after creating the commit. A file inside that commit cannot contain its own final SHA. Resume with `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`; verify against PR metadata before interpreting any check.
- Observed PR45 merged E technical bootstrap; PR42–44 merged peer proposals. None publishes BASE_W02. Source registry still lists A unreceived, B/C/D review pending, guest unaccepted. This proposal changes no E acceptance record.

Pinned authority: [contract release](https://github.com/baraabd/carwash-platform/blob/3db1afdd04c6ec65a38ca83f3993c964a1bf7587/architecture/parallel-contract-release.json), [ownership](https://github.com/baraabd/carwash-platform/blob/3db1afdd04c6ec65a38ca83f3993c964a1bf7587/architecture/parallel-ownership.json), [producer/consumer sequence](https://github.com/baraabd/carwash-platform/blob/3db1afdd04c6ec65a38ca83f3993c964a1bf7587/docs/parallel/E/W01/CHILD_SPRINTS.md), [input register](https://github.com/baraabd/carwash-platform/blob/3db1afdd04c6ec65a38ca83f3993c964a1bf7587/docs/parallel/E/W01/INPUTS_AND_CONTRACTS.md). The prompt authorizes this proposal during missing entry conditions; its lease-expiry assertion does not provide contract/base bytes. E must reconcile lease handoff before dependent service writes.

## Changed scope, contracts and migrations

Only seven new lane-local files: six in `docs/parallel/A/W02/` (README, entry packet, prerequisites, W03 requests, this checkpoint and source observation) and `tests/parallel/A/W02/ACCEPTANCE_SPECIFICATIONS.md`. No app/service/model/migration/shared package/manifest/architecture/workflow/design-reference source changed. Existing migrations were inspected, not applied or rewritten; introduced migration IDs: **none**.

Existing package versions: `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1`. Identity/Gateway foundation contracts remain unchanged. `customer.v1`, `vehicle.v1`, `geo.v1`, `identity.guest.v1` and `W02-A-W03-DEPENDENCIES/0.1.0` are proposed semantic names/packet identifiers, not published package versions or accepted APIs. B/C/D actor/revision/money/TTL/deadline differences are explicitly queued for E review.

## Checks actually run and their limits

Run from the own proposal worktree unless noted. Available interpreter is Node **24.19.0**; default pnpm **11.25.0**. Repository pins are Node **24.21.0**, pnpm **10.32.1**. Static passes below are supplementary. No pin or assertion was loosened.

| Exact command / observation                                                                                        | Actual result                                                                                                                         | Evidence limit                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/verify-toolchain.mjs --json`                                                                         | **FAIL**, exit 1: running Node 24.19.0 and default pnpm 11.25.0 differ from pins; declaration/propagation/install-policy checks pass. | Local pinned-runtime acceptance remains blocked. Prior W01 checksum-verified official Node 24.21.0 attempt crashed on JavaScript execution; that historical attempt is not a W02 pass. |
| `node scripts/check-design-reference.mjs --base-ref 3db1afdd04c6ec65a38ca83f3993c964a1bf7587`                      | **PASS**, exit 0; 10 byte-locked artifacts, base compared. Run before edits and again during packet preparation.                      | Reference integrity, not canonical pixel parity or product acceptance.                                                                                                                 |
| `node architecture/implementation-status.mjs --self-test`                                                          | **PASS**, exit 0; source inventory valid, 9 adversarial cases; `productionReady:false`, current candidate unverified.                 | Existing metadata guard; no product durability evidence.                                                                                                                               |
| `node scripts/parallel/E/check-owners.mjs --inventory`                                                             | **PASS**, exit 0; initial tracked inventory 832, leased paths 165, C014 paths 33.                                                     | Its `sourceSha` is the historical registry inventory base, not checkout HEAD. Proposal inventory is not accepted policy.                                                               |
| `node scripts/parallel/E/check-owners.mjs --base-ref 3db1afdd04c6ec65a38ca83f3993c964a1bf7587 --worktree --lane A` | **PASS**, exit 0 for interim packet; all inspected paths A-owned. Repeat on the final staged packet before submission.                | Protected-base path rules only; not independent GitHub approval or CI writer-plan acceptance.                                                                                          |

Final scoped formatting, diff whitespace, seven-file allowlist and repeat reference/ownership results are attached in the draft PR body. Formatting is limited to these new A files; repository Markdown/doc ignores are overridden only for those explicit paths. No whole-repository formatter or generator runs. Builds/DB/browser/broker acceptance are not claimed for this documentation-only scope.

GitHub target observation: 20 returned push workflows at the observed target, 18 success and C011/C012 in progress at capture. `source-observation.json` includes exact IDs/URLs/statuses/time. These are historical target observations, not checks on this future proposal head, latest-target integration candidate, resulting main or accepted wave. Required review/policy and E barrier remain pending; three collaborating agents are not independent human approval.

## Required cases still blocked or unexecuted

All **30** matrix cases are **UNEXECUTED**, with **zero** business acceptance cases passed. No PostgreSQL or migrations, Identity/guest business HTTP, broker replay, browser/visual/accessibility, Windows/device, geocoder/routing or production providers ran for this packet. Existing Nest tests use placeholder DSNs/mocks and technical listener/health behavior; they cannot establish business durability. Local fixtures proposed for future tests are never production fallbacks.

Critical blockers: verified BASE_W02 and owner/lease handoff; accepted Customer/Vehicle/Geo/guest contracts and generated clients; member/guest/delegation/recovery/claim and minimal admin purpose/object grants; approved Aleppo geography/hours/precision/provider/boundary policy; privacy/consent/retention/normalization/dedup/limits/replay policy and approved production copy; E-owned model/lifecycle metadata, runtime resources/pinned commands/heavy slot; independent review and combined-source acceptance.

Owned application/process PIDs, listeners, containers, databases, queues, objects and browser profiles: **none**. Tools used only short-lived inspection/check processes; no stack needed cleanup. No shared stack resets, source generator, external provider request, deployment, live financial operation or merge occurred.

## Resume and next action

1. E receives/reviews A's entry packet and W03 requests alongside merged B/C/D proposals. E updates its own receipt/acceptance records; A does not self-publish policy.
2. E resolves accepted schemas, guest and operational inputs; completes contracts/barrier review and actual resulting-target gates; publishes full verified BASE_W02 plus package/client/ownership/resource/gate handoff. `finalize-acceptance.mjs` is ordinary cleanup/report finalization, not a wave publisher.
3. A verifies the new immutable source and exact prerequisites, then starts separately bounded Customer, Vehicle and Geo provider children from accepted bases; real owned DB/auth/constraints evidence comes before app consumers. D owns its narrow admin consumer.
4. A accepts garage/address/profile hydration against merged real providers, including all negative/reload/GPS/manual/guest/admin cases and frozen UI evidence; E serializes real-peer combined acceptance before parent status advances.
5. W03 remains contract-request-only. Stop at this reviewed proposal handoff; no W03 implementation, auto-merge or deployment is authorized.
