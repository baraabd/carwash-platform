# W01-C — Resumable checkpoint and English handoff

Task: W01-C, Lane C — freeze technician scope and operational contracts.
Phase: proposal packet prepared for a draft PR; `BASE_W01_UNPUBLISHED`, independent review pending. Parent is not DONE or WAVE_ACCEPTED.

## Refs and contracts

| Field | Observed value / resolution |
| --- | --- |
| Inspected target and proposal parent | `main@69d81a83a3409d0693272efeb19ebeb9805750f5` |
| Inspected tree | `1988caa3f882bc0c6007ae830950b7f34f53d294` |
| E accepted base | Not found/published; never substitute the inspected target automatically |
| Branch | `sprint/w01-C-operations-blueprint` |
| Delivery head/tree | Read the draft PR's immutable head commit/tree after upload; the PR body records them. A document cannot contain its own final Git hash |
| Catalog | Schema version 2; F001 exclusive ownership overrides older grouped architecture |
| Observed public packages | `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1` |
| Observed registry contracts | `identity.v1` foundation-runtime; `gateway.v1` routing-contract-only; `foundation.probe.created.v1` foundation-runtime; `booking.confirmed.v1` contract-only |
| Proposed contracts | W02 Media/Workforce/operator/location v1 proposals in CONTRACT_REQUESTS; not accepted, published or implemented |
| Migration IDs | None; no schema/migration changes |

Allowed changed paths: only `docs/parallel/C/W01/*.md` and the two declarative `tests/parallel/C/W01/*.md` specification/example files. Review final `git diff --name-only` and every diff before publishing. No other owner source is available for edits.

## Commands and actual results

Environment: isolated Linux checkout, observed Node `v24.19.0`, pnpm `11.25.0`. Required repository pins are Node `24.21.0` and pnpm `10.32.1`. No dependency install/build/container/browser/device/business database/broker/scanner/payment provider was run by this W01-C task. The lightweight read-only checks below ran on the observed runtime; do not call them pinned-runtime acceptance.

| Command / read | Actual result | Evidence limit |
| --- | --- | --- |
| `git status --short`; `git worktree list` before writes | Clean materialized source; isolated task worktree created | Worktree isolates files only; no runtime-resource lease claimed |
| `git worktree add -b sprint/w01-C-operations-blueprint ../carwash-w01-c 69d81a83a3409d0693272efeb19ebeb9805750f5` | Isolated worktree on inspected target created | Provisional proposal parent; not BASE_W01 |
| `rg -n 'BASE_W0[12]\|bootstrap lease\|W01-E\|parallel/\|owner registry\|wave registry' docs architecture .github apps services packages` | No matching wave/lease registry before task writes | Search of inspected tracked source; external E acceptance may still need publication |
| GitHub branch/main, PR #41, open PR list and W01 branch search | Source refs recorded; C014 merged; no open PR/W01 branch initially | GitHub connector read; not owner/session synchronization approval |
| GitHub Actions runs query with inspected `head_sha`, `per_page=100` | 20/20 completed success on inspected main | Remote resulting-target workflow evidence only; not new proposal head CI |
| `node --version`; `pnpm --version` | `v24.19.0`; `11.25.0` | Toolchain discrepancy reported; pins unchanged |
| `node scripts/verify-toolchain.mjs --config-only` | PASS, 39/39 declaration/propagation checks | Config proof only |
| `node scripts/verify-toolchain.mjs` | FAIL, 38/40; running Node/pnpm mismatch | Full runtime gate remains blocked locally |
| `node scripts/check-design-reference.mjs` before writes | PASS, 10 protected artifacts, no base comparison | Hash preservation, not visual parity |
| `node scripts/check-design-reference.mjs --base-ref 69d81a83a3409d0693272efeb19ebeb9805750f5` | PASS before and after lane-local edits, 10 artifacts plus protected policy/guard byte comparison | Hash/policy preservation only |
| `node scripts/f010/reference-registry.mjs --base-ref 69d81a83a3409d0693272efeb19ebeb9805750f5` | PASS before and after lane-local edits, 3 references, trusted base compared, no registration | Reference preservation; not React pixels |
| `node --test tests/design/reference-lock.test.mjs tests/f010/reference-registry.test.mjs tests/f010/reference-debt.test.mjs tests/f010/reference-server.test.mjs` | PASS, 22 tests, 0 failures/skips/cancellations | Guard/registry/debt/server tests only; loopback server test closed its own transient server |
| `node scripts/check-boundaries.mjs` | PASS, 19 owners, 142 files (limited smoke scope) | Not whole security/dependency audit |
| `node scripts/check-layers.mjs` | PASS, 56 rules, 10 services/75 layered files | Static architecture scope only |
| `git diff --check`; `git diff --cached --check` | PASS on final staged packet | Whitespace, not operational behavior |
| Final inline allowlist/Markdown link/fence/case-ID inspection | PASS, 8 Lane C Markdown files; 27 unique declarative case IDs | Static packet checks, not executed product tests |

No new product test is claimed as executed. Every case in the declarative test packet is `SPECIFIED_NOT_RUN` or dependency-blocked. Existing current-source main CI is cited separately from local scope checks. Required PR/candidate checks must run on final delivery refs; no old head run is reused as final acceptance.

## Runtime resources and unresolved work

Owned long-running processes: none. No Compose project, host port, DB role, queue/object prefix or browser profile was allocated/started. Reference-server unit tests bind loopback on an OS-allocated port and close it in test teardown. No shared infrastructure was stopped/reset/pruned; no broad process cleanup was performed.

Actual versus mock: this is source inspection and document/specification work. Reference seed/photo examples remain explicitly synthetic; no business runtime/guest/media/workforce/scheduling/dispatch/finance integration environment exists for this task. No production inputs or numeric policy defaults were fabricated.

External dependencies: C-D01–C-D10 in DEPENDENCIES, especially E base/lease/resources/guest/grants, production/English design, privacy retention, task-location policy, real Aleppo inputs, pending-payment execution conflict, custody holder/recipient authority and scanner policy. New permissions, catalog extensions, packages, routes and gate changes are requests to E, not C edits.

Next action: review this draft packet, publish E's common verified base and accepted additive W02 contracts/ownership/resources, resolve blocked owner policies, and run mandatory final-head/latest-target candidate gates with independent human review. Do not auto-merge. Do not start W02 automatically. W03/W04 child sequencing is proposed in CONTRACT_REQUESTS; provider fixtures do not close consumer real-flow acceptance.

Stop/resume boundary: keep task branch/docs; refresh target/head and E registry before resuming. Never reset/stash/overwrite another session or change frozen references to get green results. The authorized result of this turn is a reviewable draft proposal PR, not operational implementation or release readiness.
