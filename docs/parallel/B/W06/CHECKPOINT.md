# W06-B — resumable checkpoint

Task/phase: **W06-B / entry analysis and lane-local proposal**.
Parent NOT_STARTED; dependent product writes BLOCKED; release NO-GO.
BASE_W06: unpublished (`null`), never replaced by observed main.

## Source and ownership

- Proposal parent/observed target:
  `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`.
- Observed target tree: `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`.
- Branch: `proposal/w06-B-wallet-subscription-entry`; isolated worktree:
  `/workspace/scratch/0cf8bb000a7a/carwash-w06-b`.
- Initial all seven existing worktrees clean; no W06 local/remote branch and no
  open PR observed before creation. Prior W05 proposal/repair worktrees preserved.
- Mandatory rules/references and current source inspected. Only this packet under
  docs/parallel/B/W06 and tests/parallel/B/W06 is written. W01 lease expiry follows
  the current task; stale W01 registry is not permission for source writes.
- Migration IDs: **none**. Shared schema/package/route/grant changes: **none**.
- Observed package versions: contracts/event-contracts **0.0.2**, api-clients
  **0.0.1**. Their business release is absent, not frozen W06 interfaces.

## Actual local diagnostic evidence

Pinned launcher used in this worktree:

```sh
npm exec --yes --package=node@24.21.0 --package=pnpm@10.32.1 --package=prettier@3.9.8 -- sh -c 'set -e; node --version; pnpm --version; node scripts/verify-toolchain.mjs --json; node scripts/check-design-reference.mjs; node scripts/f010/reference-registry.mjs --allow-registration; node architecture/implementation-status.mjs --self-test'
```

Pre-edit result: Node24.21.0/pnpm10.32.1 actual; toolchain 40/40; design guard
10 artifacts; F010 3 references unchanged; implementation-status inventory valid,
9 adversarial cases passed, productionReady=false. Registration flag performs
the inherited read-only registry check; no reference/manifest was rewritten.
These diagnostics establish source preservation/inventory only.

Post-edit commands under the same pinned launcher:

```sh
node scripts/check-design-reference.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b
node scripts/f010/reference-registry.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b
node scripts/parallel/E/check-owners.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b --worktree --lane B
node scripts/check-migrations.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b
CI_TOOLS_DIR=/workspace/scratch/0cf8bb000a7a/w01b-ci-tools node --test --test-reporter=spec tests/ci/secret-scans.test.mjs
```

Results: 10 design artifacts and 3 F010 references unchanged against parent;
9/9 allowed B files, no owner findings; migration layout/append-only checks passed
for 21 inherited migrations (none executed); six actual pinned-scanner regression
cases passed, none skipped. Prettier write/check targeted only the nine packet
files. A local Python inspection verified 55 original-source SHA-256/byte counts,
tree/base bindings, relative links and every declarative case NOT_RUN/evidence
null. Final specification includes 48 cases, including conditional funding and
withdrawal gates. This inspection is packet validation, not a business test.

Read-only agent QA clarified the provider sequence to posting source → Wallet
backing/reserve/claim → Billing capture → finalization and added conditional
withdrawal cases. Agent QA is not eligible independent GitHub approval.

Fresh peer intake: C draft PR #66 at
`5f5d1064e237e17f26f85d1200c12770d7b93264` against observed target. It remains an
unaccepted proposal, not a consumed runtime/base. Its capture/UNKNOWN and owner
compensation requirements broadly align. E/C must split the narrow Booking
intent/lifecycle-fence producer from C's final B-consuming saga to avoid a cycle.
C's current funding/withdrawal exclusion wording also needs owner reconciliation
with this task's explicit conditional inventory; approval is absent today. No C
file edited, private implementation imported or early capture/TTL assumed.

A pre-commit Gitleaks directory scan initially flagged one prose line in the new
Wallet proposal. Rephrased the sentence before commit and reran unchanged scanner
rules; no allowlist, suppression or security-policy edit. Exact committed-history
and archive scan results and hosted evidence are recorded in the submission
handoff after execution. Hosted evidence must name exact head/tree, run ID and
attempt. No result from another source can close this task.

E's merged W05 CI fix now scans complete exact tested-source ancestry with
`--full-history -m <source SHA>`, plus the exact committed source archive, rejects
shallow clones and tests scanner regressions. Preserve this current recipe;
B/W05 historical --all failure notes are not current scanner behavior. No
scanner/allowlist/threshold/mandatory gate changed in this packet.

## Real versus simulated and blocked cases

No business implementation/test runner, real DB/upgrade/broker, C saga, provider
sandbox, private export, finance browser/device or live money operation executed.
Every business acceptance case in the accompanying JSON remains **NOT_RUN**.
No fixture is called a real producer. Golden hashes/foundation CI cannot prove
Wallet/Subscription/privacy execution or full UI integration.

External dependencies: E's accepted base/contracts/grants/routes/topology/role
solution/resources/commands; real W04 custody and W05 Billing/provider evidence;
approved B-03/05/06/07/08/09/12/15 and applicable provider/product/UI decisions;
C real Booking/Media bindings and handlers; D/E verified privacy intake/task
authority; actual A/C/D consumers; eligible independent reviewer. Provider access
does not follow from documentation or an approved UI payment card.

Owned resources: this branch/worktree and isolated scratch diagnostic reports.
Long-lived owned process IDs, DBs/roles, containers, ports, broker queues, storage
objects and browser profiles: **none**. No shared infrastructure cleanup performed.

Next action: E/owners review the W06/W07 requests and child scopes, resolve exact
policies and publish the real accepted predecessor/barrier release. Re-audit before
any dependent product write. Stop after the draft proposal handoff; no merge,
auto-merge, deployment, provider action or automatic next-wave work authorized.
