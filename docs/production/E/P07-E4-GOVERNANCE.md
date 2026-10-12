# P07-E4 — Main-branch governance and CodeQL disposition

Lane E · parent P07-E. Status: **policy, validator and drift check implemented; NOT applied.**
Applying a repository ruleset and dismissing code-scanning alerts are repository-admin
actions and require an explicit owner authorization reference
(`governance.mjs apply --authorization <ref>`). None was given at the time of writing.

## Live state observed (read-only, 2026-10-11)

- `main` classic branch protection: **absent** (`GET branches/main/protection` → 404).
- Repository rulesets: **none** (`GET rulesets` → `[]`).
- `governance.mjs check` → `RULESET_ABSENT main-release-governance` (drift, exit 1).

So today any push to `main` is possible without review or green checks. This is the
gap this child closes once authorized.

## Desired policy — `architecture/governance/main-ruleset.json`

| Rule | Setting | Why |
| --- | --- | --- |
| deletion, non_fast_forward | on | no deleting or rewriting `main` |
| pull_request | required; stale approvals dismissed on push; review threads must be resolved; merge commits only | every change arrives as a reviewed PR |
| approvals | **0 (owner decision)** | single-maintainer repo: the author cannot approve their own PR, so ≥1 would block every merge until a second reviewer exists |
| required_status_checks | strict (branch must be up to date with `main`), 11 checks from GitHub Actions (app 15368) | "a green old head is not evidence for a changed merge tree" |
| code_scanning | CodeQL: security alerts `high_or_higher`, alerts `errors` | new high/critical findings block merge |
| bypass_actors | none | admins are not exempt |

Required checks (all produced unconditionally by every PR to `main`, no path filter,
unique names): F001 final-source acceptance · identity-security · gateway ·
F008 redaction trace metrics and runtime acceptance · Foundation release gate ·
F010 parity harness gate · Frozen design reference · Static gates, builds and offline tests ·
Real PostgreSQL and RabbitMQ acceptance · Dependency and secret scanning ·
Declared scope of these gates.

Not required on purpose: path-filtered lane workflows (`p01-*`, `c0xx-*`,
`p07-release-artifacts`), which would leave unrelated PRs pending forever, and the
ambiguous job name `static` (exists in both f009 and f010; the aggregates cover them).

`validatePolicy` rejects: non-active enforcement, non-default-branch target, any bypass
actor, a missing mandatory rule, non-strict checks, kept stale approvals, unresolved
threads allowed, a missing mandatory gate, a CodeQL threshold below high, and any
required check that is mistyped, path-filtered, conditionally skipped, ambiguous or not
from GitHub Actions. `tests/production/E/governance.test.mjs` proves each rejection.

## CodeQL — open alerts on `main` and proposed disposition

All four are `js/file-access-to-http` (medium). Reviewed against the code:

| # | Location | Data flow | Proposed disposition |
| --- | --- | --- | --- |
| 12 | `scripts/ci/install-tools.mjs:21` | tool URL from the reviewed `tools.lock.json`; origin asserted `https://github.com`; archive SHA-256 verified before use | false positive — pinned, origin-checked, checksum-verified download |
| 13, 14 | `tests/integration/rabbitmq-acl.test.mjs:255-256` | per-run generated broker credentials from the git-ignored acceptance context sent to the loopback RabbitMQ management API | used in tests — loopback, ephemeral credentials |
| 27 | `tests/production/C/media-s3.test.mjs:331` | per-run test S3 endpoint/object key from the acceptance context to the loopback S3 emulator | used in tests — loopback, ephemeral data |

These were previously recorded as accepted dispositions in P04-E3 but remain **open**
in code scanning. Dismissal (with the reasons above) needs owner authorization. No
code change is proposed: the flows are the intended behavior of these test/CI tools.

The new P07-E1 code introduced one blocking finding (`js/file-system-race` in
`infra/release/migrate-job.mjs`), fixed in PR #128 by reading through one descriptor.

## Commands

| Command | Result |
| --- | --- |
| `node --test tests/production/E/governance.test.mjs` | 5 pass, 0 fail |
| `node scripts/production/E/governance/governance.mjs check` | DRIFT: RULESET_ABSENT (expected before authorization) |

## Remaining blockers

- **E4-B1** Owner authorization to apply the ruleset (and choose approvals 0 vs ≥1).
- **E4-B2** Owner authorization to dismiss alerts 12/13/14/27 with the reasons above.
- After apply: `governance.mjs check` must return `GOVERNANCE MATCHES POLICY`; that
  output is the acceptance evidence. It is not claimed here.
