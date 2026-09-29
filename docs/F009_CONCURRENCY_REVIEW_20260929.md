# F009 concurrency incident and regression verification

## Observed incident

The report concerns PR #16 at source commit
`fee6340062b7145004d12abfcba223b45f32b57e`.

Run `36352651120` (workflow number 7, push) was cancelled. Its aggregate failed
because plan and the other required jobs were cancelled.
Run `36352654293` (workflow number 8, pull_request) completed successfully:
all 18 jobs, including the aggregate and all 11 image jobs, succeeded.

Both runs used the same source SHA. The push was created at 21:41:31 UTC
and the pull request run at 21:41:34 UTC on 2026-09-27.
The earlier key used the source repository and branch name for both events.
With `cancel-in-progress: true`, those events competed for the same group.
The aggregate's `if: always()` then correctly refused the cancelled dependencies.
No application build failure can be inferred from that cancelled run alone.

## Correction and invariants

Namespace concurrency by event name, source repository, and PR number or full Git ref.
A push, a pull request synchronization and a manual run no longer share a group.
Updates within one event and PR/ref still supersede older work.
Independent PRs from one branch no longer share a group either.

Keep all existing triggers and acceptance jobs. This deliberately retains both
push and pull-request verification, at the cost of duplicate work when both fire.
Trigger deduplication is a separate policy change, not part of this correction.

Do not change `assertJobResults`, aggregate conditions, scanner thresholds,
required dependencies, source/run/attempt matching or artifact requirements.
Do not convert cancellation, missing evidence or skipped tests into success.
Historical run 7 remains cancelled; it must not be relabeled as passing.

## Verification

Run with the repository-pinned Node and pnpm versions:

```sh
node --test --test-reporter=tap tests/unit/f009-concurrency-regression.test.mjs
node --test --test-reporter=tap tests/ci/gates.test.mjs
pnpm test:unit
pnpm check:design-reference
pnpm format:check
```

The new regression file is included by the existing unit-test glob, including
the F009 static acceptance stage. It checks the exact workflow key, cross-event
isolation, same-PR supersession, independent PR/ref/repository scopes, and actual
policy rejection of every required dependency when cancelled, failed or skipped.
These are policy tests, not a substitute for executing GitHub Actions.

Final acceptance requires both push and pull-request F009 runs to complete on
the corrected source without cross-cancellation, with all required jobs and
current-source evidence passing. All inherited PR workflows must pass as well.
Record final commit, run IDs and results in the PR after they actually complete;
do not reuse run 8 as acceptance evidence for the corrected source.

No frontend, immutable design authority, business service, schema, dependency
lockfile or production environment is changed. No automatic merge or deployment.
