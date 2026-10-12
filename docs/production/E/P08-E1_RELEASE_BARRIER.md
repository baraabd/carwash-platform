# P08-E1 — Final release barrier

Status: **implemented barrier; release verdict on current main is NO_GO**. Nothing was
deployed. Parent P08-E stays `INTEGRATION_PENDING`.

## What this child delivers

| Path | Role |
| --- | --- |
| `architecture/release-barrier.json` | The mandatory receipt families, each with owner and required action. No thresholds or authorizations are defaulted here. |
| `scripts/production/E/release/barrier.mjs` | Pure evaluator (injected git/digest/clock). Produces `carwash.release-barrier-report/v1`. |
| `scripts/production/E/release/io.mjs` | Real git object/ref resolution and evidence sha256 digests (paths may not escape the root). |
| `scripts/production/E/release-receipt.mjs` | Uniform receipt producer: `candidate` pins sha/tree/refs/config digest; `run` executes one gate on a clean tracked tree and records PASSED only on exit 0. |
| `scripts/production/E/release-barrier.mjs` | CLI. Exit `0` GO, `2` NO_GO, `1` unusable input; writes JSON + Markdown. |
| `tests/production/E/release-barrier.test.mjs` | 22 tests on a disposable real git repository (runs under `pnpm test:production:e`). |

## Receipt contract (`carwash.release-receipt/v1`)

```json
{
  "schema": "carwash.release-receipt/v1",
  "family": "C.rc-acceptance",
  "status": "PASSED",
  "rc": { "sha": "<40 hex>", "tree": "<40 hex>" },
  "producedAt": "2026-10-11T10:00:00.000Z",
  "producer": { "actor": "lane-c" },
  "configDigest": "sha256:<64 hex>",
  "dependencies": { "postgres": "REAL (disposable container)", "rabbitmq": "REAL" },
  "artifacts": { "booking": "sha256:<64 hex>" },
  "evidence": [{ "path": "release/evidence/c.log", "sha256": "sha256:<64 hex>" }],
  "details": {}
}
```

Kind-specific `details`: review (`pullRequest`, `reviewer`, `author`, `state`, `commitId`),
branch protection (`branch`, `requiredChecks`, `enforceAdmins`, `requiredApprovals`),
authorization (`authorizer`, `candidateSha`, `artifactManifestDigest`, `scope.liveMoney`,
`notBefore`, `expiresAt`), secret references (`references[{name, ref: vault://…}]`),
incident contacts (`primary`/`backup` `{name, channel}`), window policy (`approvedBy`,
`durationMinutes`, `maxSampleGapMinutes`, `thresholds{name: {bound, limit, onBreach}}`).

## Rules enforced (each has a negative test)

- Exactly one receipt per family; duplicates are `CONFLICT`, unknown/unparseable receipts block GO.
- Every receipt bound to the candidate sha **and** tree; candidate tree re-resolved from git; every pinned ref must still resolve to the pinned sha (a moved `main` is NO_GO).
- Evidence files re-hashed at evaluation; edited or missing evidence invalidates the receipt.
- Acceptance dependencies must be `REAL…`; any stub/mock/double/simulated/not-used label is rejected.
- Any receipt that names an artifact digest must equal the single published manifest; the authorization must name the canonical manifest digest, so deployment can only use identical digests.
- Review must be APPROVED, on the candidate commit, by someone other than the author.
- Branch protection must enforce checks, approvals and admins.
- Authorization is time-bounded against an injected clock and must state `liveMoney` explicitly.
- Secret values anywhere in a receipt are rejected; only store references are accepted.
- Primary and backup incident contacts must be two distinct named people.
- Window thresholds must be finite with an explicit breach action; none are invented.
- Config digest drift and future-dated receipts are invalid.

GO yields `deployment: AUTHORIZED_PENDING_RUNBOOK` — it **permits** the reviewed runbook
with the reported manifest digest; the barrier itself never deploys. No reviewed production
executor or runbook with real targets exists in this repository (see W10-E), so deployment
remains blocked even after a GO until that input exists.

## Verdict on current main

See `docs/production/E/evidence/p08-e1/` for the report produced by the real commands
below against a detached checkout of main. Commands:

```sh
node scripts/production/E/release-receipt.mjs candidate --root <main-checkout> \
  --ref refs/remotes/origin/main --out <main-checkout>/release/candidate.json
node scripts/production/E/release-receipt.mjs run --root <main-checkout> --family E.design-lock \
  --receipts <main-checkout>/release/receipts --evidence-dir <main-checkout>/release/evidence \
  -- node scripts/check-design-reference.mjs
node scripts/production/E/release-barrier.mjs --root <main-checkout> \
  --candidate <main-checkout>/release/candidate.json --receipts <main-checkout>/release/receipts \
  --out <main-checkout>/release/report/barrier-report.json
```

Executed 2026-10-10T22:16–22:19Z (UTC) against a clean detached checkout of
`3e1ab23bff450235858ea13e049f8fb373df393f` (tree `53edea7ff5348c969408e9fd3ee23569b06a9f94`),
pinning `refs/remotes/origin/main`, after `pnpm install --frozen-lockfile` and
`pnpm run build:packages`. Copied verbatim into `docs/production/E/evidence/p08-e1/`
(receipt evidence paths are relative to that checkout's root, i.e. `release/evidence/…`).

**Verdict: NO_GO, deployment NOT_PERMITTED.**

| Family | Result | Basis |
| --- | --- | --- |
| E.design-lock | PASSED | `node scripts/check-design-reference.mjs` exit 0 |
| E.contract-compatibility | PASSED | `node --test tests/production/E/contract-compatibility.test.mjs` 5/5 |
| repo.required-checks-enforced | INVALID (receipt FAILED) | Both `gh api …/branches/main/protection` runs hit a GitHub TLS handshake timeout; the same call at session start returned **404 Branch not protected**. Owner: repository administrator. |
| A/B/C/D.rc-acceptance | MISSING | No P05–P08 RC acceptance exists for any lane; open lane work (e.g. P05-D, P06-D) is unmerged. |
| E.ci-mandatory, E.security-scans, E.migration-rehearsal, E.recovery-rehearsal, E.artifacts-published | MISSING | No RC exists to run them on; images are not published to a registry; no restored production schema exists. |
| review.independent | MISSING | No RC pull request. |
| ext.* (authorization, infrastructure target, secrets, merchant onboarding, incident contacts, window policy) | MISSING | Genuinely external owner inputs; none were provided. |

The previous FAILED protection receipt is kept under `superseded/` (it was moved aside
deliberately before the retry; the barrier never sees two receipts for one family).

## Security / privacy

Receipts carry references, digests and role names only; secret-shaped keys with values are
refused. Incident contact names are required by the task and are supplied by the owner at
release time, never committed as fixtures.

## Rollback

Additive tooling only (no runtime code, migration, contract or event change). Revert the
commit to remove it.
