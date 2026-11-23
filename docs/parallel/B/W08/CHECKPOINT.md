# W08-B resumable checkpoint and English handoff

## Task and source

Task: W08-B, finance integrity/current authorization/crash recovery.
Phase: ENTRY_PROPOSAL; parent NOT_STARTED; product implementation BLOCKED;
full launch NO_GO. No critical defect closure or DONE is claimed.

Observed target/sole parent:
`f0b76221c1a1991ba78327c019f0b4a0a7c53dff`.
Target tree: `1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d`.
Accepted BASE_W08: **null / UNPUBLISHED**. Current registry remains W01 with
BASE_W02 null and no accepted next-wave contracts. Final head/tree and hosted
run/artifact receipts belong in the draft PR metadata after creation to avoid
a source commit naming its own hash. A green head is not the resulting target.

Own branch: `proposal/w08-B-finance-recovery-entry`.
Own worktree: `carwash-w08-b`. Ten preexisting worktrees were clean before
creation and preserved. Fresh remote W08-B matching refs and local W08 branches
were absent; the observed peer draft #76 is C-owned and was not consumed.
The task expires the W01 bootstrap lease; E's stale owner registry still needs
reconciliation. No leased/product/shared source was edited under this proposal.

Contracts/event-contracts/api-clients at source: **0.0.2 / 0.0.2 / 0.0.1**.
No new accepted contracts, schemas, business clients, runtime models, policy or
commands are published. New migration IDs: **none**. Existing 21 migrations
are only checked for append-only layout/ownership locally, not applied here.

## Changed paths

Eight B-owned proposal/specification files:

- `docs/parallel/B/W08/README.md`
- `docs/parallel/B/W08/DEFECTS_AND_REPAIR_REQUESTS.md`
- `docs/parallel/B/W08/THREATS_AND_ACCEPTANCE.md`
- `docs/parallel/B/W08/RECOVERY_AND_OPERATIONS.md`
- `docs/parallel/B/W08/W09_RESTORE_HANDOFF.md`
- `docs/parallel/B/W08/source-observation.json`
- `docs/parallel/B/W08/CHECKPOINT.md`
- `tests/parallel/B/W08/acceptance-specifications.json`

93 immutable source fingerprints bind the actual entry audit. Three concrete
foundation source hazards and one future journal-privilege risk remain open.
Repaired source refs and real reproduction artifacts are null. All **31** real
scope cases are NOT_RUN. Genuine financial restore datasets/expected amounts,
approved workload/performance/RPO/RTO budgets and actual measurements are null /
NOT_AVAILABLE. The W09 handoff defines collection/procedure requirements and
does not execute or start W09.

## Actual local commands and evidence

Use the pinned cached invocation; host defaults are not the toolchain evidence:

```sh
npm exec --yes --package=node@24.21.0 --package=pnpm@10.32.1 --package=prettier@3.9.8 -- sh -c '<command>'
```

Actual `node --version` / `pnpm --version`: **v24.21.0 / 10.32.1**.
Executed pre-edit gates:

```sh
node scripts/verify-toolchain.mjs
node scripts/check-design-reference.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff
node scripts/f010/reference-registry.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff
```

Results: **PASS**, respectively 40/40 toolchain checks, ten frozen artifacts
and three registered references. These guards prove preservation, not visual
parity of a new application. Post-edit guards and exact changed-path/format/link/
fingerprint/specification checks must pass before publication; their actual
final results are recorded in the PR receipt.

Executed source-inventory, migration-layout and scanner regression checks:

```sh
node architecture/implementation-status.mjs --self-test
node scripts/check-migrations.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff
CI_TOOLS_DIR=<pinned-tools-directory> node --test --test-reporter=spec tests/ci/secret-scans.test.mjs
```

Results: **PASS**; inventory19 runtimes/18 foundation shells/one Identity
capability, productionReady false, nine overclaim regressions; 21 existing
migration layout/append-only checks; six actual scanner regressions, zero
failed/cancelled/skipped. Scanner fixtures are generated nonfunctional bait in
temporary independent repositories, not financial provider/DB tests. Pinned
Gitleaks is 8.30.1 with SHA256
`88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509`.

Pre-publication exact-source scan protocol:

```sh
gitleaks git --log-opts='--full-history -m <exact-submitted-head>' . --redact=100 --max-archive-depth=2 --max-decode-depth=2 --report-format=json --report-path=<owned-history-report>
gitleaks dir <exact-submitted-head-archive> --redact=100 --max-archive-depth=2 --max-decode-depth=2 --report-format=json --report-path=<owned-source-report>
```

Both scans must return zero findings before publishing the branch. The complete
tested ancestry, including merge-parent diffs, is retained; unrelated refs do
not contaminate this source verdict. No scanner suppression or history rewrite
is used. Final exact-head mandatory CI, security/aggregate source/tree/run/attempt
binding and retained artifact checks are recorded in PR metadata. Old W07 green
runs never transfer to this head.

## Real versus modeled execution and resources

Source reads/hash comparisons and pinned diagnostic guards/regressions ran.
No financial state model/fake-Prisma probe, DB contention, financial migration,
broker crash, HTTP business authorization, private download, provider operation,
browser/device/visual product flow, restore, performance or staging run occurred
locally. No local install/product build/typecheck is claimed; mandatory hosted
foundation gates remain separate from the 31 absent business cases.

No B runtime ports, databases/roles, Compose projects, containers, queue/object
namespaces, browser profiles or persistent worker/process handles were allocated.
No heavy slot was consumed. Temporary command processes completed; no shared
resource cleanup, broad process kill, reset, stash, clean or force push occurred.
An initial read-only Git fetch approval review timed out; its permitted narrow
retry successfully imported the exact observed target. This was a timeout,
not a safety rejection or approval to modify another worktree.

## Dependencies, gate and next action

E must publish the accepted W08 base/contracts/public clients/current-authority/
fencing profiles, actual full W07 provider/consumer evidence, isolated allocation
and exact gate manifest. Product/accounting/privacy/provider owners approve real
money/policy/retention inputs, genuine merchant protocols and datasets/budgets.
C provides authoritative current lifecycle/capacity/work/Media; D provides bounded
operations/projection consumers. Required electronic provider acceptance remains
open and Paymera scope remains explicit. No fixture closes those gates.

Review and agree the queued narrow children described in the packet before
coding. Reproduce Catalog foundation defects on allocated actual DB/broker,
then return each source defect to its owner. Accept narrow real providers first,
then test dependent real consumers/full journeys before their merge; parent is
INTEGRATION_PENDING only once actual implementation starts. Same-login agents
cannot satisfy independent approval.

E reconstructs the latest-target/head candidate, preserves all mandatory gates,
gets eligible independent review, verifies refs unchanged and uses only the
authorized merge process; verify the actual resulting target afterward. Later
source/config/evidence commits require their applicable checks again. No merge,
auto-merge, live money/refund/provider action, production fault, deployment or
automatic next-wave work is performed by W08-B. Stop at this reviewed handoff.
