# W04-E resumable English checkpoint

Task **W04-E**; runtime **ENTRY_BLOCKED**, parent **NOT_STARTED**.
Documentation child **W04-E-CASH-ACCEPTANCE-PROPOSAL / DRAFT_REVIEW_PENDING**.
All 32 cash acceptance cases remain BLOCKED/NOT_RUN.

| Field                                                           | Actual value / boundary                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| BASE_W01                                                        | 69d81a83a3409d0693272efeb19ebeb9805750f5                                                       |
| BASE_W02                                                        | null                                                                                           |
| Expected BASE_W04                                               | Unpublished; no invented SHA                                                                   |
| Observed target / sole proposal parent                          | 1ec9d8aebf4470a2815471116643fa6ebe0d5a95                                                       |
| Target tree                                                     | 9f04d674056041bbc810a62e4cc7f275c32581b8                                                       |
| Branch                                                          | sprint/w04-E-cash-acceptance                                                                   |
| Proposal head/tree/candidate                                    | Bound after commit in live draft PR and enclosing Git objects, avoiding a self-referential SHA |
| Contract package versions                                       | contracts0.0.2; event-contracts0.0.2; api-clients0.0.1 empty export                            |
| Scope                                                           | Seven new docs/parallel/E/W04 files plus tests/parallel/E/W04/CASH_ACCEPTANCE_SPEC.md          |
| New migrations / published contracts                            | None                                                                                           |
| Runtime/process/container/port/DB/broker/object/browser handles | None allocated; no cleanup required                                                            |

Files under docs/parallel/E/W04: README.md, SOURCE_OBSERVATION.json,
JOURNEY_AND_RECONCILIATION.md, PROVIDER_SEQUENCE_AND_CONVERGENCE.md,
W05_CONTRACT_REQUESTS.md, DEFECT_AND_DECISION_LEDGER.md and CHECKPOINT.md.
References, product sources, reserved/shared configs, schemas and historical files
are unchanged. This worktree is isolated; no moving peer branch was imported.

## Commands and actual results

Pinned local Linux Node24.21.0/pnpm10.32.1 verified with
`node scripts/verify-toolchain.mjs`: **40/40 PASS**.
Pre-edit `node scripts/check-design-reference.mjs`: **10 artifacts PASS**.
All3complete HTML authorities read; exact F010 byte/hash values matched.

The following final checks are run on this explicit eight-file scope and their
results/head/tree bindings recorded in the live PR:

```sh
node scripts/check-design-reference.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95
node ../toolchain/prettier/bin/prettier.cjs --ignore-path /dev/null --check docs/parallel/E/W04/*.md docs/parallel/E/W04/SOURCE_OBSERVATION.json tests/parallel/E/W04/CASH_ACCEPTANCE_SPEC.md
git diff --cached --check
git status --short
git show --no-patch --format='%H %T %P' HEAD
```

JSON parse plus unchanged trusted `changedPaths/checkChangedPaths` exports check
the exact E-local diff: diagnostic path validation, not independent approval or
activation of stale leases. No dummy tests for prose are added.

No local repository install/build, Docker, product HTTP/DB/broker/object scanner,
product browser or provider/staging/Windows/device acceptance is run for this
documentation child. Docker is unavailable. Hosted checks prove their actual
foundation scopes only; fresh source/run/tree/artifact links are in the live PR.
Do not reuse PR54's old green head as evidence for this new source.

## Evidence and remaining gate

The future cash bundle must contain actual source/candidate/result SHA+tree,
isolated environment/contract/policy manifest, three actor profiles, both real
journeys, source revision vector, redacted correlations/references/exact amounts,
all 32 case outcomes, reference/candidate/diff and fault artifacts, defects,
independent review and owned-handle cleanup. That bundle is not fabricated here.
BASE_W05 is not published. Day 3 is not reached; Day 7 is not supported by evidence; replacement
calendar date awaits owner estimates and real predecessor/provider acceptance.

At resume refresh main/open PRs/head/checks/registry, verify accepted predecessor
bases, then sequence narrow real work/media/cash/custody/projection providers and
consumer PRs from the accepted base. Freeze measured convergence bounds before
run; execute all 32 cases on combined source. E returns source-owned defects to their
owners. Build current latest-target candidate, preserve all mandatory/affected
gates, obtain eligible independent review, recheck refs, use only the authorized
merge process and verify actual resulting target before publishing BASE_W05.

Stop at this bounded reviewable handoff. No automatic merge, self-approval,
deployment, live provider/money/refund or automatic W05 work is authorized.
