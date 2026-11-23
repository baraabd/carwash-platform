# W01-D source audit and evidence limits

Observation date: 2026-10-05 (Asia/Damascus). Repository: `baraabd/carwash-platform`.

## Refs, writers and entry conditions

- Existing checkout was clean at `a1accb7763b63c63dfdfadb1dd68bc202a8107a3`; inspected `git status --short` and `git worktree list` before creating an isolated Lane D worktree.
- `git fetch origin main` and GitHub commit/branch/PR reads agreed on current target `69d81a83a3409d0693272efeb19ebeb9805750f5`, tree `1988caa3f882bc0c6007ae830950b7f34f53d294`.
- [C014 PR #41](https://github.com/baraabd/carwash-platform/pull/41) is merged, not open: final head `04b7577097d7767e0d0cd1bf43de84ea92c02671`, merge commit is the observed target above, merged at `2026-10-05T01:49:15Z`. No C014 source was changed or duplicate PR created.
- GitHub `pulls?state=open&per_page=100` returned no open PRs at entry. The branch list contained no W01 wave branch or Lane E registry. This is an observation of visible repository state, not proof about unpublished work in other computers/sessions.
- `git ls-tree -r --name-only origin/main docs/parallel tests/parallel scripts/parallel` returned no tracked entries. `rg -n 'BASE_W0|bootstrap.lease|W01|W02' docs architecture .github --glob '!*.html'` returned no wave/lease registration at entry. No E-accepted base, contract publication, lease, resource namespace or gate manifest was found.
- Branch `sprint/w01-D-admin-contract-freeze` was created from the immutable observation SHA strictly for permitted lane-local proposals. The shared checkout and all existing refs/work remain untouched. A later E registry requires revalidation against the formally accepted base before dependent source writes.

## Required authority read

Read `AGENTS.md`, `docs/design/DESIGN_LOCK.md`, both design manifests, ADR 0004, `docs/ARCHITECTURE_AR.md`, `architecture/service-catalog.json`, F001 ownership ADR, `docs/VERIFICATION.md`, F010 provenance/implementation and approved customer/technician/admin HTML references. No nested AGENTS file exists in the tracked source. F001 is authoritative for service/data ownership when the older grouped architecture disagrees. The catalog's older runtime labels and VERIFICATION's customer-UI paragraph are not current implementation evidence.

F010 registers the admin HTML as an approved prototype. Older design/ADR prose says future full admin designs still need acceptance. Preserve the exact registered bytes; record the conflict and all missing detail/error/production/English states as decisions. Registration does not approve new screens, market policies, sample data or simulated persistence.

## Actual implementation and contracts

| Surface | Source evidence | Current conclusion |
| --- | --- | --- |
| admin-web | `apps/admin-web/src/index.ts` exports an empty module; package scripts only build/typecheck TypeScript | Skeleton; no admin frontend runtime, persistent save, screen port or business integration |
| configuration / reviews | Each `src/index.ts` exports an empty module | Skeletons; contracts and domain runtime unimplemented |
| communications | `src/app.module.ts` has `BUSINESS_READY=false`; Prisma models ServiceMarker, InboxMessage, ProbeNotification | Foundation inbox/probe capability; no product messages/provider delivery/conversation runtime |
| reporting | `src/app.module.ts` has `BUSINESS_READY=false`; Prisma models ServiceMarker, InboxMessage, ProbeProjection | Foundation event projection only; no product dashboards/export/checkpoint corrections runtime |
| support | `src/app.module.ts` has `BUSINESS_READY=false`; Prisma contains ServiceMarker | Foundation shell; no durable product case/refund/privacy intake workflow |
| Identity | Existing `application/identity-auth.service.ts`, `transport/http/auth.controller.ts`, persistent sessions/account/audit models | Reuse real authentication foundation; granular admin grants/bootstrap remain a proposed extension; OTP webhook is not SMS delivery proof |
| Gateway | Existing F007 runtime and routing OpenAPI | Stateless ingress/routing foundation; route discovery does not prove owning business endpoints exist |
| Customer / C014 | Merged confirmation state + current workflow evidence | Session demo confirmation only; no real booking, payment or capacity reservation inferred |

Accepted-source package versions: `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1`. These are source package versions, not E's absent wave acceptance. `docs/api/contract-registry.json` lists `identity.v1` foundation and `gateway.v1` routing only; all 18 business domains are unpublished. Async registry lists foundation probe runtime and `booking.confirmed.v1` contract-only. None of the proposals in this packet is a live/accepted endpoint or event. No migrations are introduced.

## Commands actually run locally

Actual runtime: Node **24.19.0**, pnpm **11.25.0**. Repository pins are Node **24.21.0** and pnpm **10.32.1**. No pin was changed and no package installation was run. Lightweight source/reference results below are diagnostic evidence under the actual runtime, not pinned-runtime acceptance.

| Exact command | Exit/result | Evidence scope |
| --- | --- | --- |
| `node scripts/check-design-reference.mjs` | 0; ten artifacts verified; no errors | Before edits; frozen bytes only |
| `node scripts/f010/reference-registry.mjs` | 0; three references verified | Before edits; registered bytes only |
| `node --test tests/design/reference-lock.test.mjs` | 0; 12 passed, 0 failed/skipped | Existing guard adversarial tests, no runtime/browser proof |
| `node --test tests/f010/reference-registry.test.mjs` | 0; 4 passed, 0 failed/skipped | Existing registry invariants |
| `node scripts/verify-toolchain.mjs --json` | **1; FAIL** | Actual Node and pnpm differ from pins; declaration/propagation pass |
| `node scripts/verify-toolchain.mjs --config-only --json` | 0 | Declared configuration agrees; runtime deliberately excluded by command, not accepted |
| `node architecture/implementation-status.mjs --self-test` | 0; four adversarial cases; `productionReady=false` | Registry validation only |

After-edit guard results and final allowlist/diff verification are recorded in HANDOFF.md. Future app builds, DB migrations, HTTP admin authorization, contracts, broker recovery, browser visuals, accessibility, Windows/device and staging/live-provider tests are **NOT_RUN**, because W01-D introduces specifications only and its runtime prerequisites are absent. No skipped case is counted as passed.

## Remote CI observation

[BASE_CI_OBSERVATION.json](BASE_CI_OBSERVATION.json) records the exact observed target's 20 completed successful push workflow runs, including C014, F001/F006/F007/F008/F009/F010, Sprint 0.2 and the reference guard. Legacy combined commit statuses were empty, so they were not used to infer green CI. GitHub Actions data is the actual evidence. Those runs do not certify a later documentation head, future merge SHA, admin product completeness, Lane E wave approval, or independent review. Final PR-head checks and candidate/target acceptance must be read separately.
