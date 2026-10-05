# W05-C — Compensation entry and resumable handoff

Task **W05-C**; phase **ENTRY_BLOCKED / PROPOSAL_ONLY**, implementation **NOT_STARTED**, parent **INTEGRATION_PENDING**. Expected BASE_W05 is unpublished; no observation is promoted to a wave base.

Observed target/branch parent: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`, tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`, on 2026-10-05 UTC. W04-C PR #56 externally merged at `da15a98bce848c496a0fd625a7ca0f70632cb989`; no real cash-cycle acceptance follows from proposal publication. Initial open PR: A W05 proposal #61, head `1eeafc09d6c6392201067032d76a8e4fa63de54e`; it is not consumed as accepted source. Own branch/worktree `sprint/w05-C-compensation-prework`, `/workspace/scratch/d980e1354a15/carwash-w05-c`. Exact submitted head/tree are pinned in the English draft PR body after publication.

Workspace maintenance removed earlier local checkouts; the authoritative repository was cloned again. Previous delivered packets survive in GitHub/main. Source comparison with `1ec9d8aebf4470a2815471116643fa6ebe0d5a95` shows only lane-local docs/specification deltas; mandatory AGENTS/design/reference/architecture/catalog/ADR/verification and actual product source remain unchanged from previously read authority. AGENTS was reread. No other session work was reset/stashed/overwritten.

## Entry verdict

| Required evidence | Actual inspected source | Required exit |
| --- | --- | --- |
| BASE_W05 and frozen cancel/reschedule/payment/refund contracts | Release registry still has BASE_W02 null and accepted-next-wave list empty; E W04 explicitly says BASE_W05 unpublished | Actual predecessor barriers, reviewed versions/clients/permissions and full immutable E publication |
| Integrated W04 cash cycle | Merged A–E W04 documentation only; cash drill not executed, no actual Booking/reservation/receipt/custody artifacts | Real source-bound three-app cycle plus all required gates |
| Scheduling/Booking/Dispatch/Media/Workforce | Marker-only product persistence, health shells and unconnected Booking pure transition helper; no cancel/swap/compensation workers | Real accepted owned providers and append-only migrations |
| B payment/refund and scope | B W04 W05 packet is unaccepted; proof submission, verification, allocation and refund states deliberately separate | Actual Billing-owned independent credit/verification/outcome and refund contracts/producers |
| Approved policies/provider environment | Cutoffs, started-work safety, charges, repricing, clock/deadlines/retention, real sandbox/merchant evidence and Paymera scope not supplied | Product/B/C/D/E decisions and actual authorized sandbox resources; no guessed fee/TTL/provider behavior |
| C/W05 resource/UI gates | No allocation/owned runtime; production recovery states and English approvals missing | E-provisioned isolated DB/broker/app/browser resources and approved views |

B's [W05 request](../../B/W04/W05_CONTRACT_PACKET.md) distinguishes final independently established merchant credit from matched payment allocation; proof review and a clean image do not establish paid. B owns refund allowance/reservation/approval/execution/reconciliation; C can request compensation, never report it refunded from local intent. D's [W05 request](../../D/W04/W05_CONTRACT_REQUESTS.md) requires independent operation/financial states, current participant access and source freshness. `sham`/`shamcash`, event names, Money/principal/revision vocabularies need E compatibility review. No new method or Paymera exclusion is invented.

## Delivered proposal and actual checks

- [COMPENSATION_MATRIX.md](COMPENSATION_MATRIX.md): proposed precedence, atomic capacity replacement, durable recovery matrix and provider queue; supplements [W04 W05 requests](../W04/W05_CONTRACT_REQUESTS.md).
- [W06_CONTRACT_REQUESTS.md](W06_CONTRACT_REQUESTS.md): Workforce resources and B Subscription/Wallet hold coordination request, not implementation.
- [Acceptance cases](../../../../tests/parallel/C/W05/acceptance-specifications.md): all BLOCKED_NOT_RUN.

| Exact local command / diagnostic | Actual result and limit |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7` before/after | PASS, ten preserved reference artifacts; not application pixels |
| `node --test tests/design/reference-lock.test.mjs` | 12 PASS, zero failures/skips/cancellations/TODOs; existing guard only |
| `node scripts/check-boundaries.mjs`; `node scripts/check-layers.mjs` | PASS, static boundaries/layers only |
| `node scripts/verify-toolchain.mjs --config-only` | PASS, 39/39, declared Node 24.21.0/pnpm 10.32.1 |
| `node scripts/verify-toolchain.mjs` | FAIL, 38/40, actual Node 24.19.0/pnpm 11.25.0; pins unchanged |
| `git diff --cached --check`; local Markdown-link verification | PASS, scoped text integrity |
| Base `checkChangedPaths(registry,{lane:'C',paths})` | PASS, four lane-local writer-C paths, zero findings; not independent ownership trust approval |

Scope diagnostic imports untouched `../carwash/scripts/parallel/E/check-owners.mjs` at the observed source, loads ownership JSON and obtains explicitly staged paths via `git diff --cached --name-only -z`. Final local/remote blobs/tree equality is verified at publication. Required head/candidate/resulting-main CI and independent review are pending E gates, not claimed passed. Local guards ran under actual toolchain above; no pinned build proof.

Migration IDs added **none**; no app/service/schema/history/manifest/shared/architecture/CI/infra/reference edit. No install/build/typecheck, real DB/broker/provider/scanner/browser/Windows/device/staging/money/refund/deployment ran. No sandbox credentials/protocol or fake verified-payment outcome was supplied. Business matrix/tests remain blocked. Environment allocation/process/container/browser/worker handles **none**; no shared teardown/reset or cleanup needed.

Next action: E closes actual W04/predecessor acceptance, publishes BASE_W05/contracts/policies/resources; B proves independent payment/refund providers and authorized sandbox results; C accepts Scheduling swap/release and Work/Dispatch quiescence before Booking coordinator and A/D/operator consumers. Parent stays pending through all real crash/race/recovery-view cases. No W06 work, merge/auto-merge, live provider/refund or deployment is authorized.
