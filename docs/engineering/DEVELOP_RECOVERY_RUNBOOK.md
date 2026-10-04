# Develop recovery runbook

Owner actions are marked **owner**. No step rewrites published history, changes branch
protection or pushes directly to `main` or `develop`.

## Order

1. **owner** — review and merge PR #39 (`fix/parity-settle-confirmation` → `main`).
2. Verify the merge. `git fetch origin --prune`, then:
   - note the merge method; a squash or rebase merge does not keep `eacccde…`/the final #39 head as
     an ancestor, so compare content instead of relying on one ancestry test:
     `git diff <final #39 head> origin/main -- scripts/c004/stable-capture.mjs scripts/stability`
     must be empty (and `docs/engineering` must match);
   - confirm the `main` push workflows for the new SHA (C004–C011 parity, F001/F006–F010,
     reference guard, Sprint 0.2) completed successfully. A missing run is missing, not green.
3. Advance PR #37 without a merge commit, fast-forward only, to that verified SHA:

   ```sh
   git fetch origin --prune
   NEW_MAIN=<verified main SHA>
   git merge-base --is-ancestor origin/sync/develop-from-main "$NEW_MAIN"   # must succeed
   git log --oneline origin/sync/develop-from-main.."$NEW_MAIN"           # only intended commits
   git push origin "$NEW_MAIN":refs/heads/sync/develop-from-main           # fast-forward
   ```

   If the ancestry check fails, stop: the sync branch has unique work to inventory first.
   Then confirm through GitHub that PR #37's head equals `NEW_MAIN` and its base is `develop`.
4. Wait for every PR #37 check on that head. PR #39's results are not PR #37's results.
5. **owner** — merge PR #37.
6. Verify develop:
   - `git rev-parse origin/develop^{tree}` equals `git rev-parse NEW_MAIN^{tree}` when `develop`
     had no other work; otherwise inspect the merge result for retained develop-only work;
   - `git merge-base --is-ancestor NEW_MAIN origin/develop` succeeds;
   - ahead/behind is not required to be `0 0`: a merge commit leaves `develop` one commit ahead
     with the same tree;
   - the `develop` push-event workflow runs completed successfully.

## If PR #39 is not merged

PR #37 at `6013d161` is still a valid promotion of `main`. Merging it alone brings `develop` to
`main` including the intermittent map pixel failure documented in the analysis; promote the
hardening later through the same fast-forward path. Do not add a develop-only patch or cherry-pick
the helper change onto `develop`.

## Rollback

- Hardening: revert the PR #39 commits on a branch from `main` and open a PR; the previous
  two-capture rule returns.
- Develop promotion: open a reviewed PR that reverts the promotion merge with its first parent
  (`-m 1`) after confirming parent order. A reverted merge's commits are not re-applied by a later
  merge of the same commits; re-promotion then needs a revert of that revert.
