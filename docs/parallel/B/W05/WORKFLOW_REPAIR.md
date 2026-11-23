# W05-B security workflow repair

Repair date: 2026-10-06. This records CI remediation for draft PR #65, not
financial implementation, provider acceptance or publication of BASE_W05.

## Cause and bounded correction

F009 workflow run 37360624813, run number 187, failed its security job 111934574207. Pinned Gitleaks 8.30.1 reported one history finding. The workflow
scans every reachable branch using `git --log-opts=--all .`; the B source
snapshot itself had zero findings.

The finding was a `generic-api-key` false positive in authorization prose at
`tests/parallel/D/W05/ACCEPTANCE_SPEC.md:86`, on unmerged D proposal commit
`b06f48bc05587950899455cfe1fb1e42e34ea38a`. Slash-delimited provider capability
lists following the word access resembled a key assignment. It was not a
credential or a required provider secret. Independent read-only review confirmed
the text and the history-scanning implication.

The user's explicit CI-repair request authorizes this narrow correction. Only
that line was rephrased as equivalent sentences with ordinary comma-separated
lists. Every other source byte in D's proposal was preserved. An added fix
commit would retain the offending ancestor, so the single unmerged proposal
commit was replaced with the same parent:

| Binding            | SHA                                      |
| ------------------ | ---------------------------------------- |
| Corrected D head   | d4c7c8ed73d4a3d34903cabdaae7da64d06b3f42 |
| Corrected D tree   | 6cad88f3b5940dfaa8abc42900a4d9fa3e68922a |
| Unchanged D parent | 3ce756cd39a9b0c1013043cee0ca1bb183466da7 |

Publication used the exact old D SHA as an expected-head lease and succeeded.
No backup branch/tag retaining the offending history was introduced. Scanner
rules, allowlists, security policy, mandatory jobs, dependencies and locked
design references were not changed.

## B source and verification

The existing B proposal head `fd4e88cb57ed350835907d6e2daebfe3e252d9e9`
is preserved as a parent. B is synchronized with observed main
`70614b165d9eba0663b76fb96948b90c38f2ac48`, tree
`cbdeb2ab263525401cd13aab5b9dc3430bb35c3f`, which contains the already merged
A #61 and C #62 proposal documents. All seven original B files are unchanged;
the sole added B file is this repair record. Final exact head/tree and hosted
workflow evidence are bound in PR #65 after publication.

Actual local checks use Node 24.21.0, pnpm 10.32.1 and Gitleaks 8.30.1.
Toolchain validation passed 40/40. Reference guards passed before and after
the D correction: ten locked artifacts and three F010 references. Byte-level
comparison proved only D line 86 changed. Pinned scanner checks reproduce one
finding for the original line and zero for its replacement; the corrected D
source and its replacement-commit ancestry scan both have zero findings.

The scan flags are `--redact=100 --max-archive-depth=2 --max-decode-depth=2
--report-format=json --report-path=<isolated-report>`. History scans use
`gitleaks git --log-opts=--all .`; source scans use `gitleaks dir` on the exact
committed archive. A fresh all-ref scan is required after the D ref update,
followed by B exact-source scans and the unchanged hosted mandatory workflows.

Previous B results included a failed security job and cancelled vehicle-image
and aggregate jobs. They do not count as successful checks. This B source update
starts a complete fresh workflow cycle; F009 aggregate requires all twenty-nine
evidence records across thirty jobs to match the same SHA, tree, run ID and run attempt. Partial reruns or
mixing old artifacts cannot establish acceptance.

## Release boundary

These are source-integrity and foundation CI checks only. All existing W05/W06
financial specifications remain UNEXECUTED. Accepted BASE_W05, real predecessor
cash acceptance, frozen provider/refund contracts, policy and genuine authorized
provider facilities remain absent. No provider, payment, refund, database,
broker or browser business operation is performed by this repair. No migration,
deployment, independent approval, merge or wave acceptance is claimed.
