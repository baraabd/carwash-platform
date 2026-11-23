# Reviewed historical public-event finding

Assessment date: 2026-11-22. This classifies one independently reviewed scanner
false positive; it does not classify a credential as safe or remove a secret
from history.

## Finding and evidence

| Binding | Assessed value |
| --- | --- |
| Historical commit | `8c956a61c4a93a5772e6cb94967f4ac1cedee7a8` |
| File and line | `tests/unit/messaging.test.mjs`, line 136 |
| Scanner rule | `generic-api-key` |
| Public event name | `billing.cash-collected.v1` |
| Matching test context | The same value is the event type at line 139. |
| Published contract proof | `packages/event-contracts/src/billing-v1.ts`, exported `BILLING_CASH_COLLECTED_V1` at lines 147–148 in that same commit. |
| Package publication proof | `packages/event-contracts/src/index.ts`, line 7 re-exports the Billing events. |

The value identifies a public Billing event on the message broker. It has no
authentication or authorization role. The property name used by the publisher
triggered a generic credential heuristic. A separate reviewer confirmed the
literal and published contract before this narrowly scoped treatment was
implemented.

The machine-readable assessment in `gitleaks-public-event-assessment.json`
records the complete historical fingerprint, SHA-256 of the literal, all three
raw Git blobs and the exact LF-terminated source/context/proof lines. Before
passing any exception to the scanner, `scripts/ci/reviewed-secret-finding.mjs`:

1. Loads the assessment from the exact source commit being scanned.
2. Requires the single hardcoded reviewed fingerprint and a closed schema.
3. Verifies that the historical commit is an ancestor of the scanned commit.
4. Reads regular immutable Git blobs and checks every recorded byte digest.
5. Proves that the detected literal equals the adjacent event type, the exported
   Billing event and its package export.
6. Creates one private history-ignore file with that complete fingerprint, and
   a separate empty source-ignore file, only after all checks pass.

Changing the SHA, path, line, rule, literal digest, context, export or any proof
digest fails validation. A missing assessment or Git proof also fails. There is
no rule, path or value allowlist. The same literal in another commit or source
file is not exempted. The current messaging test uses the published event export
instead of duplicating that routing string.

## Preserved gates

The history scan still covers every ancestor and merge-parent diff of the exact
source SHA. Current source is scanned from a byte-preserving Git archive mirror;
real archives and encoded content retain their existing depth-two scans. Source
scanning gets an explicitly empty ignore file, so this historical review cannot
mask a current-source or archive finding. Inline scanner-allow comments are not
honored. No scanner exit code, finding, warning, skipped input or read error is
converted into success by the assessment.

Security evidence reports the reviewed historical fingerprint and assessment
digest separately from the zero-unreviewed-finding counts. Raw scanner findings
remain in disposable temporary files and are not uploaded. Dependency advisory
thresholds and image/CodeQL gates are unchanged.

## Regressions

`tests/ci/secret-scans.test.mjs` exercises the pinned Gitleaks binary, including
the exact historical finding before/after the verified exception, changed
assessment fields, committed-versus-worktree proof, wrong ancestry, the same
event in another commit, unrelated generated scanner bait, inline allow
comments, deleted secrets, both merge-parent cases, real compressed archives,
source replacement races and scanner read failures. These are scanner and
assessment checks; final CI on the integrated source SHA remains required.
