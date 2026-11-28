# P07-E4 — Main-branch governance and CodeQL disposition

Lane E · parent P07-E. Status: **main ruleset applied and verified on 2026-11-28.**
The existing S02–S12 owner authorization was used with an authenticated repository
administrator to apply the policy. The live ruleset is active and its readback
matches the explicit policy. The four previously open medium CodeQL findings
were subsequently reviewed and closed with the recorded reasons below; no
scanner or required gate was weakened.

## Historical state observed (read-only, 2026-10-11)

- `main` classic branch protection: **absent** (`GET branches/main/protection` → 404).
- Repository rulesets: **none** (`GET rulesets` → `[]`).
- `governance.mjs check` → `RULESET_ABSENT main-release-governance` (drift, exit 1).

At that observation, pushes to `main` were not constrained by this policy. The
2026-11-28 enforcement evidence below supersedes that historical state.

## Desired policy — `architecture/governance/main-ruleset.json`

| Rule                       | Setting                                                                                          | Why                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| deletion, non_fast_forward | on                                                                                               | no deleting or rewriting `main`                                                                                              |
| pull_request               | required; stale approvals dismissed on push; review threads must be resolved; merge commits only | every change arrives as a reviewed PR                                                                                        |
| approvals                  | **0 (owner decision)**                                                                           | single-maintainer repo: the author cannot approve their own PR, so ≥1 would block every merge until a second reviewer exists |
| required_status_checks     | strict (branch must be up to date with `main`), 14 checks from GitHub Actions (app 15368)        | "a green old head is not evidence for a changed merge tree"                                                                  |
| code_scanning              | CodeQL: security alerts `high_or_higher`, alerts `errors`                                        | new high/critical findings block merge                                                                                       |
| bypass_actors              | none                                                                                             | admins are not exempt                                                                                                        |

Required checks (all produced unconditionally by every PR to `main`, no path filter,
unique names): F001 final-source acceptance · identity-security · gateway ·
F008 redaction trace metrics and runtime acceptance · Foundation release gate ·
F010 parity harness gate · Frozen design reference · Static gates, builds and offline tests ·
Real PostgreSQL and RabbitMQ acceptance · Dependency and secret scanning ·
Declared scope of these gates · All business acceptance families passed ·
Release artifacts verified · Data-plane recovery drill.

Not required on purpose: path-filtered lane workflows (`p01-*`, `c0xx-*`),
which would leave unrelated PRs pending forever, and the
ambiguous job name `static` (exists in both f009 and f010; the aggregates cover them).

### P08 reconciliation — 2026-11-23

The complete business-acceptance aggregate is now mandatory in the desired
policy. Artifact and recovery rehearsals run on every `main`/`develop` PR,
without path filters; their named gates can therefore be required without
leaving unrelated changes permanently pending. Artifact publication remains
restricted to non-PR `main` runs. Develop and feature/manual runs use the
credential-free rehearsal path, and the aggregate rejects skipped, failed or
cancelled selected work.

The 2026-11-23 read of GitHub still returned no rulesets and both `main` and
`develop` reported protection disabled. The desired policy is source code,
not evidence of live enforcement. Apply it only after the corresponding
unconditional workflow definitions are present on the protected target, and
verify the live API record. The owner's zero-review policy for ordinary PRs is
preserved; the separate production-release independent-review receipt is still
mandatory. No code-scanning alert is dismissed by this sprint.

`validatePolicy` rejects: non-active enforcement, non-default-branch target, any bypass
actor, a missing mandatory rule, non-strict checks, kept stale approvals, unresolved
threads allowed, a missing mandatory gate, a CodeQL threshold below high, and any
required check that is mistyped, path-filtered, conditionally skipped, ambiguous or not
from GitHub Actions. `tests/production/E/governance.test.mjs` proves each rejection.

## CodeQL — reviewed findings and recorded disposition

All four are `js/file-access-to-http` (medium). Reviewed against source
`2405c809ea84988fd38d9a477ab5457d24add097`; the three alerted files were verified
unchanged from the then-current `main`:

| #      | Location                                          | Data flow                                                                                                                 | Recorded disposition                                                |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 12     | `scripts/ci/install-tools.mjs:21`                 | tool URL from the reviewed `tools.lock.json`; origin asserted `https://github.com`; archive SHA-256 verified before use   | false positive — pinned, origin-checked, checksum-verified download |
| 13, 14 | `tests/integration/rabbitmq-acl.test.mjs:255-256` | per-run generated broker credentials from the git-ignored acceptance context sent to the loopback RabbitMQ management API | used in tests — loopback, ephemeral credentials                     |
| 27     | `tests/production/C/media-s3.test.mjs:331`        | per-run test S3 endpoint/object key from the acceptance context to the loopback S3 emulator                               | used in tests — loopback, ephemeral data                            |

These were previously recorded as proposed dispositions in P04-E3. Under the
owner's S02–S12 closure authorization, GitHub recorded alert 12 as `false positive`
and alerts 13/14/27 as `used in tests` between 08:37:52 and 08:38:22 UTC on
2026-11-28. Authenticated readback subsequently returned zero open alerts. The
[sanitized API record](evidence/S09-codeql-dispositions-2026-11-28.json) preserves
the reasons, actor, timestamps and source identity. These are reviewed alert
classifications, not claims that source vulnerabilities were patched.

The origin assertion for the tool downloader covers its initial GitHub URL;
the pinned archive/binary hashes verify downloaded bytes, not a redirect-origin
allowlist. The test dispositions apply to the trusted runners that generate
ephemeral contexts and bind their infrastructure to loopback. They do not
claim schema validation or an allowlist for arbitrary externally supplied
context files. No secret values, signatures or provider credentials are part
of this record.

The new P07-E1 code introduced one blocking finding (`js/file-system-race` in
`infra/release/migrate-job.mjs`), fixed in PR #128 by reading through one descriptor.

## Historical command outcomes — before policy application

| Command                                                     | Result                                                |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `node --test tests/production/E/governance.test.mjs`        | 5 pass, 0 fail                                        |
| `node scripts/production/E/governance/governance.mjs check` | DRIFT: RULESET_ABSENT (expected before authorization) |

## Enforcement history and remaining release gates

### S09 continuation — 2026-11-27

The owner has now authorized the complete S02–S12 engineering and deployment
work. The earlier E4-B1 authorization gap does not justify pausing this work.
The existing zero-review ordinary-PR policy remains unchanged; the separate
independent production review is still required by the release barrier.

Fresh GitHub reads show both `main` and `develop` with `protected:false`,
required-status-check enforcement `off`, and an empty repository ruleset list.
The existing `governance.mjs apply` was invoked with authorization reference
`user-s02-s12-full-closure-2026-11-27`. It failed before any mutation because
the local GitHub CLI has no authenticated session. The available connector
supports ruleset reads, not administration writes. This is an access blocker,
not a request for the owner to repeat authorization. The reviewed desired
policy and drift verifier are concrete and ready for an authenticated
administrator. No alert was dismissed and no enforcement is claimed.

### S09 enforcement evidence — 2026-11-28

The official GitHub CLI authentication completed for `baraabd`; the repository
API confirmed administrator access and `main` as the default branch. Applying
the reviewed policy with `user-s02-s12-full-closure-2026-11-27` created active
ruleset [28284393](https://github.com/baraabd/carwash-platform/rules/28284393).

GitHub returned two additional pull-request defaults: `required_reviewers: []`
and `require_extra_approval_for_unattributed_changes: true`. These are now
explicit in the desired policy. The validator rejects disabling or omitting
the latter. The strict live comparison is unchanged and still detects omitted,
weakened or unexpected parameters. Ordinary PR approvals remain zero.

The authenticated readback confirmed:

- `main.protected: true`;
- active default-branch targeting with no bypass actors;
- deletion, non-fast-forward, pull-request, required-status-check and CodeQL rules;
- all 14 required checks bound to GitHub Actions application 15368;
- `GOVERNANCE MATCHES POLICY`, `drift: []`, live ruleset ID 28284393.

The successful drift check was recorded at `2026-11-28T07:57:05.614Z`.
Classic branch protection remains absent: enforcement is supplied by the
repository ruleset. The sanitized live records are retained in
[`evidence/S09-main-ruleset-2026-11-28.json`](evidence/S09-main-ruleset-2026-11-28.json).
The governance, release-barrier and release-provenance test suites passed
62/62 tests; the ten frozen design references remained unchanged.

This proves repository enforcement at the recorded observation. Release-candidate
checks must still refresh it, and the separate independent production review,
hosted acceptance and production authorization remain release-barrier inputs.

- **E4-B1** Resolved: owner authorization, authenticated administration and live ruleset enforcement are verified.
- **E4-B2** Resolved: source review, authorized dispositions for 12/13/14/27 and authenticated readback are retained above.
- Refresh `governance.mjs check` for the release candidate and retain its current
  API evidence; the observation above is not a perpetual guarantee.
