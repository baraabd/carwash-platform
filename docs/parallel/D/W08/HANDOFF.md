# W08-D resumable handoff

Task: W08-D — Harden admin authorization, privacy, exports and accessibility.
Phase: **PROPOSAL_ONLY / INTEGRATION_PENDING / FULL_SCOPE_NO_GO**.
This bounded packet is reviewable; required product fixes and tests are blocked,
not DONE. No W09 work, merge, deployment, live money or real message execution.

## Source and publication envelope

| Field | Exact observation |
| --- | --- |
| Expected accepted base | BASE_W08 is not published; do not substitute main. |
| Read-only analysis base / target at intake | `f0b76221c1a1991ba78327c019f0b4a0a7c53dff` |
| Analysis tree | `1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d` |
| Existing published base | BASE_W01=`69d81a83a3409d0693272efeb19ebeb9805750f5`; BASE_W02=null; W08 absent. |
| Own branch / checkout | `proposal/w08-D-admin-hardening-entry`; `/workspace/scratch/c990830ae7db/carwash-w08-d` |
| Proposal head / tree / PR | The final full SHA/tree and exact target/head check snapshot are bound in the draft PR body. This file belongs to that commit; embedding its own future SHA would create a hash cycle. Resolve the immutable linked handoff with that publication envelope, not a moving branch. |
| Current contract versions | contracts/event-contracts 0.0.2; api-clients 0.0.1 with empty exports. Identity V1 is a real security foundation; gateway V1 routing and foundation probe do not imply business endpoint/client acceptance. booking.confirmed.v1 is contract-only. |
| Previous D publication | PR72 head `6a903fbe2e931b178fdc9bfa9e8ed50d79584218`, merge `be954a9a3ce4d206bd4a6cfd46990dece359edd2`, 2026-10-06T19:37:42Z. Proposal publication, not W07 business acceptance. C014 PR41 already merged at BASE_W01; no duplicate branch/PR. |
| Actual W07 source delta | f01e87…→analysis base: 34 added lane docs/specs plus two modified E test files; 36 paths, 7,273 additions/28 deletions. Case A cleanup/cancellation harness repair; zero runtime/app/service/schema/package/CI source changes. |

Changed paths are exactly five documents in `docs/parallel/D/W08/`:
`ADMIN_SECURITY_ACCESSIBILITY_MATRIX.md`, `SECURITY_PRIVACY_EXPORT_RECOVERY_PLAN.md`,
`W09_OPERATIONS_CONTRACT_REQUESTS.md`, `SOURCE_OBSERVATION.json`, `HANDOFF.md`;
and `tests/parallel/D/W08/ACCEPTANCE_SPEC.md`. Migration IDs added/changed: **none**.
No dependencies, schemas, producer/runtime sources, shared policies or golden
references changed. The user expires the old bootstrap lease; historical
conditional registry entries/tests cannot revive source authority or wave entry.

## Diagnostics actually run

Commands ran in the own checkout on actual Node24.19.0/pnpm11.25.0/Linux,
without installing dependencies or overriding the required pins. Results are
diagnostic evidence, not pinned-toolchain candidate acceptance.

| Command | Actual result and limit |
| --- | --- |
| `node scripts/check-design-reference.mjs`; after edits with `--base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff` | PASS before/after,10 artifacts; exact base comparison after, hash preservation only. |
| `node scripts/f010/reference-registry.mjs`; after edits with `--base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff` | PASS before/after,3 approved references; exact base comparison after; no app visual comparison. |
| `node --test --test-reporter=spec tests/parallel/E/ownership.test.mjs tests/design/reference-lock.test.mjs tests/f010/reference-registry.test.mjs` | PASS35; zero failed/skipped/cancelled/todo. Historical lease model tests are not W08 source permission. |
| `node --test --test-reporter=spec tests/unit/f008-recovery-scope.test.mjs` | PASS11; fault-injected lifecycle fixtures, no real DB/broker recovery run. |
| `node architecture/implementation-status.mjs --self-test` | PASS;19 runtimes/18 foundation shells/1 capability runtime;9 adversarial controls; productionReady=false. |
| `node scripts/check-migrations.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff --json` | PASS3 static checks;21 migrations/428 files; zero edits/findings. No real database migration executed. |
| `node scripts/verify-toolchain.mjs --json --config-only` | PASS39 declarations/configuration checks. |
| `node scripts/verify-toolchain.mjs --json` | **FAIL**,exit1,2 of40 checks: Node24.19.0≠24.21.0 and pnpm11.25.0≠10.32.1. Pins unchanged; full required acceptance remains blocked. |
| `CI_TOOLS_DIR=<owned temporary verified binary directory> node --test --test-reporter=spec tests/ci/secret-scans.test.mjs` | PASS6; real disposable Git/scanner controls with generated nonfunctional bait. Gitleaks8.30.1 binary SHA256=`88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509`; checksum compared to exact repository tool lock before copying; temporary data cleaned. |

Additional actual packet checks: `node scripts/parallel/E/check-owners.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff --worktree --lane D` PASS,exact6 D paths/zero findings; `python /workspace/scratch/c990830ae7db/w08-packet-qa.py` PASS,68 unique blocked families/17 screens/six race controls/46 matching source-schema pins/relative links/fences/whitespace; default Gitleaks directory scans of the D W08 docs and specification PASS,zero findings each,owned temporary data cleaned. These checks inspect proposal structure and scanner output, not runtime behavior.

Final proposal-only guards, ownership/whitespace, structure and secret scans are
recorded with exact commands/results in the PR publication envelope. Required
CI remains mandatory; local diagnostic checks cannot configure required-check
trust or satisfy independent approval. At intake2026-10-06T19:45:52.684Z the
observed main had41 returned checks(35success/6in_progress) and8 workflows
(4success/4in_progress), including successful security jobs. That is neither a
W08 candidate result nor product acceptance; refresh target/head before review.

## Blocked product acceptance and concrete owners

The [acceptance specifications](../../../../tests/parallel/D/W08/ACCEPTANCE_SPEC.md)
define **68 unique families, all BLOCKED / NOT_RUN**, including17 screens and
six real Inbox race controls. No permission/direct-API/revocation/private-export
abuse/live DB/broker restart/projection-catch-up/admin concurrency/browser/manual
keyboard/Linux candidate pixels/Windows interaction/load acceptance was run.
No dashboard/search/export latency, throughput, error, memory or freshness
measurement is claimed. Canonical reference hashes and the fixture harness do
not replace any of those tests.

| Blocker | Owner / evidence / required next action |
| --- | --- |
| No integrated W07 or frozen W08 release | E + A/B/C/D: current release registry still W01; publish real providers, accepted schemas/clients/grants/common base and serialized candidate evidence. |
| Missing product admin/providers | D app and five domains remain technical marker/probe foundations; A/B/C producers absent. Sequence narrow providers then consumers, preserving all17 screens. |
| INT-D-01 still open | D: both PrismaInboxStore broad transaction uniqueness catches; static unreproduced risk. Real synchronized RHASH1–3/CHASH1–3 reproduction and owner-local fix required. E byte/fingerprint and B/E relay/lease/fencing defects require respective owner evidence. |
| Current authority and privacy seams | E and owners: finer grants, tab refresh/revocation/subscription lifecycle, D bindings/C relationships/E mapping, C task location, private Media/artifact purposes and export/privacy coordinator/retention remain unaccepted. B's current W06 financial privacy intent replaces obsolete deferral, without proving execution. |
| Accessibility/visual full scope | D + product/design + E harness: static reference debts need actual candidate fixes and keyboard/screen-reader/RTL/LTR/motion tests; missing English/production states and pinned browser/font/Linux versus Windows evidence remain blockers. No baseline regeneration. |
| Threat model, bounds and measured performance | E + product operations + each owner: approve workload/fault model, numeric budgets, request/query/export/retry/fan-out/subscription limits and isolated resources, then measure actual data. Foundation defaults are not approved SLOs. |
| Toolchain and gate/review trust | E: supply pinned runtime and protected externally reviewed policy/check configuration; eligible independent reviewer required. Same GitHub login sessions do not qualify. E owns the four inherited historical CodeQL OPEN_REVIEW warnings; no new CodeQL scan or dismissal in this packet. |

## Resources, recovery and next action

No server, browser, database, broker, container, queue/object namespace, port or
heavy acceptance slot was started. Owned persistent process handles: none.
Temporary Git/scanner fixtures self-cleaned; never mutate or clean peer checkouts.
The bounded read-only review is advisory, not independent GitHub approval.

E reviews [W09 requests](W09_OPERATIONS_CONTRACT_REQUESTS.md), resolves essential
trust/export/retention/receipt/replay/generation schemas before staging rehearsal,
and publishes actual BASE_W08 with entry evidence. D then resumes only this
task's dependent hardening writes against accepted providers and approved UI
states. E must construct latest-target+head candidate, run every mandatory and
affected real gate, obtain independent review, verify refs unchanged and use
the authorized merge process. Verify the actual resulting target before any
next base/wave. This submission stops at the draft review gate.

Evidence: [source observation](SOURCE_OBSERVATION.json),
[17-screen matrix](ADMIN_SECURITY_ACCESSIBILITY_MATRIX.md),
[security/privacy/export/recovery plan](SECURITY_PRIVACY_EXPORT_RECOVERY_PLAN.md).
