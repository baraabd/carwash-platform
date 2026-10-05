# W01-B — F009 secret-scanner diagnostic and repair

Incident: F009 workflow run number 142, run ID `37274562450`, attempt 1,
pull-request event on PR #44. Failed head:
`2b5042caa6902b911f01ae5b9d41725a1b79fcf7`; tree
`236d0e9e55ad2d3fc8b9db4d73dd5feff0dd20f8`.
Base remained `69d81a83a3409d0693272efeb19ebeb9805750f5`.

## Proven cause

The checksum-pinned Gitleaks `v8.30.1` reported exactly one
`generic-api-key` finding in the prose of decision B-11 at
`docs/parallel/B/W01/POLICY_DECISIONS.md`, line 19. This text described missing
provider documentation/test access; it was not a credential, merchant account
number or private key. A clean remote clone reproduced the finding in all-ref
history, the sole W01-B addition, and the current document source.

Failed security job: `111648782044`. Its history scan returned 1; F009 security
correctly rejected it. Aggregate job `111650241278` then correctly rejected the
failed security result. The aggregate is not a separate defect. The Node.js
action-runtime deprecation warning is unrelated to the scanner failure.

## Correction and history scope

Reword B-11 as ordinary provider-documentation requirements while retaining its
decision owner, verification/refund/test-environment requirements and OPEN status.
No business requirement, financial policy or acceptance blocker is removed.

The offending commit was reachable from only the W01-B proposal branch, with no
containing tag or other remote branch. The user requested repair of this PR; its
unchanged single commit was authored by this session. Replace that own proposal
commit from the same observed base, retaining the corrected full packet. Check
the expected old remote head immediately before replacement; do not overwrite
any new writer's commit. The previous failed commit remains identifiable from
the incident/PR history and the isolated audit checkout.

A later cleanup commit would retain the offending addition in history. F009
checks full fetched history with `--all`, so it would continue failing. The repair
therefore changes this session's one unmerged proposal commit, not main or
another lane's branch. No force update of another session's work is permitted.

No scanner rule/configuration, allowlist, ignore comment, history-scan range,
checkout depth, security threshold, required workflow or aggregate assertion is
changed. This is a source-prose repair, not a scanner bypass.

## Required repair verification

Use the same pinned scanner/redaction/archive/decode options as F009. Confirm the
old source/history fail, corrected source succeeds, and a fresh candidate mirror
with the corrected W01-B ref and all other current heads succeeds. Do not call
the untouched audit clone's old-ref failure a corrected-head result.

Run pinned formatting, candidate JSON Schema/fixture validation and all customer/
technician/admin reference-preservation guards. The PR must run its normal
mandatory CI on the actual corrected head, including security and aggregate;
old green checks are not evidence for a replacement commit. Record final head,
tree, commands and run links in the PR description after verification.

These checks validate the proposal repair only. Finance runtime acceptance,
provider access, E's wave-base/contracts and policy decisions remain separate
unresolved W01-B gates. This repair does not authorize a merge, deployment or
real-money operation.
