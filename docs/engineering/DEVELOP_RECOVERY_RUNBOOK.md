# Develop recovery runbook

Owner actions are marked **owner**. No step rewrites published history, changes branch
protection or pushes directly to `main` or `develop`.

## Order

1. **owner** — review and merge the shared fix PR (`fix/parity-settle-confirmation` → `main`).
2. Verify the merge: `git fetch origin --prune`; confirm the fix commit is reachable from
   `origin/main` and the `main` push workflows for the new SHA (all C00x parity workflows,
   F001/F006–F010, reference guard, Sprint 0.2) completed successfully.
3. Advance PR #37 without a merge commit, fast-forward only:

   ```sh
   git fetch origin --prune
   git merge-base --is-ancestor origin/sync/develop-from-main origin/main   # must succeed
   git push origin origin/main:refs/heads/sync/develop-from-main            # fast-forward
   ```

   Then confirm through GitHub that PR #37 head equals the new `main` SHA and base is `develop`.
4. Wait for every PR #37 check on that head. A missing run is missing, not green.
5. **owner** — merge PR #37.
6. Verify develop: `git rev-list --left-right --count origin/develop...origin/main` must be
   `0 0`, or `0 N` only for commits merged to `main` after step 3. Compare
   `git rev-parse origin/develop^{tree}` with the tested head's tree; a different merge SHA with
   the same tree is the same source. Check the `develop` push-event workflow runs.

## If the fix PR is not merged

PR #37 at `6013d161` is still a valid promotion of verified `main`. Merging it alone brings
`develop` to `main` with the known intermittent map pixel failure (see the analysis); promote the
fix later through the same fast-forward path. Do not add a develop-only patch.

## Rollback

- Hardening: revert the single fix commit on a branch from `main` and open a PR; the previous
  two-capture rule returns.
- Develop promotion: develop gained only commits already on `main`; to undo, open a reviewed PR
  that reverts the promotion merge with its first parent (`-m 1`) after confirming parent order.
  Reverting a merge means its commits are not re-applied by a later merge of the same commits;
  re-promotion then needs a revert of that revert.
