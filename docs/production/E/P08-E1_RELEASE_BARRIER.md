# P08-E1 — Final release barrier

Status: **implemented barrier; hardened by the 2026-11-23 P08 delivery**. The
historical 2026-10-10 candidate below received `NO_GO`; it is not a verdict for
today's main or a later candidate. Nothing was deployed by this tooling.
Production release still requires current evidence for every mandatory family.

## What this child delivers

| Path | Role |
| --- | --- |
| `architecture/release-barrier.json` | The mandatory receipt families, each with owner and required action. No thresholds or authorizations are defaulted here. |
| `scripts/production/E/release/barrier.mjs` | Pure evaluator (injected git/digest/clock). Produces `carwash.release-barrier-report/v1`. |
| `scripts/production/E/release/io.mjs` | Real git object/ref resolution and evidence sha256 digests (paths may not escape the root). |
| `scripts/production/E/release-receipt.mjs` | Uniform receipt producer: `candidate` pins sha/tree/refs/config digest; `run` executes one gate on clean, stable source and records PASSED only after a successful command and provenance verification. |
| `scripts/production/E/release-barrier.mjs` | CLI. Exit `0` GO, `2` NO_GO, `1` unusable input; writes JSON + Markdown. |
| `tests/production/E/release-barrier.test.mjs` | Positive and negative barrier regressions on a disposable real Git repository (runs under `pnpm test:production:e`). |

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
  "artifacts": { "booking/runtime": "sha256:<64 hex>" },
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

The artifacts family uses `details.manifestPath` to reference the full
file (`kind: carwash.release-manifest`, `schemaVersion: 1`) as hashed evidence. A bare image digest map is
insufficient. Artifact keys include both target and role (`booking/runtime`,
`booking/migration`), and coverage comes from the candidate's service catalog.
The authorization uses the canonical digest of that full manifest, including
its source and provenance metadata.

## Rules enforced (each has a negative test)

- Exactly one receipt per family; duplicates are `CONFLICT`, unknown/unparseable receipts block GO.
- Every receipt bound to the candidate sha **and** tree; candidate tree re-resolved from git; every pinned ref must still resolve to the pinned sha (a moved `main` is NO_GO).
- Evidence files re-hashed at evaluation; edited or missing evidence invalidates the receipt.
- Acceptance dependencies must be `REAL…`; any stub/mock/double/simulated/not-used label is rejected.
- The published manifest must cover every runtime and migration target in the candidate catalog, with the correct artifact kind, source blobs, migration sets, digest and provenance metadata. Any receipt that names an artifact digest must match this manifest; the authorization must name its canonical digest.
- Review must be APPROVED, on the candidate commit, by someone other than the author.
- Branch protection must enforce the complete candidate-pinned required-check policy and admins. Its ordinary PR approval count follows the recorded governance policy (currently zero); the separate independent production review remains mandatory.
- Authorization is time-bounded against an injected clock and must state `liveMoney` explicitly.
- Secret values anywhere in a receipt are rejected; only store references are accepted.
- Primary and backup incident contacts must be two distinct named people.
- Window thresholds must be finite with an explicit breach action; none are invented.
- Every configuration digest is mandatory and recomputed from the candidate's Git objects. An evaluator policy that differs from the pinned policy, config digest drift or future-dated receipts blocks release.
- A gate that changes relevant source, the commit or its tree cannot emit a passing receipt. Explicit local smoke fixture evidence cannot authorize production.

GO yields `deployment: AUTHORIZED_PENDING_RUNBOOK` — it **permits** the reviewed runbook
with the reported manifest digest; the barrier itself never deploys. No reviewed production
executor or runbook with real targets exists in this repository (see W10-E), so deployment
remains blocked even after a GO until that input exists.

## Railway secret evidence references

The release barrier also accepts the following **Carwash-internal evidence
locators** for the authorized Railway target. These are not Railway URLs or
connection strings. The barrier never opens them, retrieves a secret or grants
access. A syntactically valid locator does not establish that a resource exists.

```text
railway://project/<project-id>/environment/<environment-id>/service/<service-id>/variable/<VARIABLE_NAME>
railway://project/<project-id>/environment/<environment-id>/service/<service-id>/volume/<volume-id>/file/<volume-relative-path>
```

Copy the project, environment, service and volume IDs from actual provider
readback. IDs use canonical lowercase UUID spelling with a valid version and
variant. Display names and placeholders do not qualify. A file is identified
by its volume ID and exact path inside that volume; no file UUID is invented.
This matches Railway's [volume file operations](https://docs.railway.com/cli/volume),
which address files by path. Variable references are scoped to the live service
instance, including the consuming service when a variable is shared or rendered
from another service.

The internal grammar accepts uppercase variable names matching
`[A-Z_][A-Z0-9_]{0,254}`. File paths are relative to the volume root, with
nonempty segments matching `[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}` and a maximum
length of 1,024 characters. Locators are at most 2,048 characters. Query strings,
fragments, userinfo, percent encodings, whitespace/control characters,
backslashes, absolute file paths and `.`/`..` segments are refused. There is no
URL decoding or path normalization that could conceal an invalid spelling.
Secret values, database URLs and Railway template expressions do not belong in
these identifiers.

Each Railway entry in `details.references` must also have `readbackPath`, pointing
to a JSON file retained in the receipt's `evidence` with its SHA-256 digest:

```json
{
  "name": "identity-otp-pepper",
  "ref": "railway://project/<project-id>/environment/<environment-id>/service/<service-id>/variable/IDENTITY_OTP_PEPPER",
  "readbackPath": "release/evidence/railway-identity-pepper.json"
}
```

The readback file has exactly the following observation fields. The placeholders
illustrate the format and are not valid evidence:

```json
{
  "schema": "carwash.railway-secret-readback/v1",
  "ref": "<the exact locator from the receipt>",
  "observedAt": "<actual UTC readback time>",
  "present": true,
  "deployed": true
}
```

The operator may record `present: true` and `deployed: true` only after an
authenticated read verifies the secret variable or file in the actual live
target. A staged change, a successful upload request without readback, or a
redacted variable name alone is insufficient. For a volume file, verify the
volume's attachment to that environment/service and the exact file, including
the protected permissions and runtime identity's access required by the
deployment contract. Preserve sanitized supporting provider/CLI output as
additional hashed evidence when needed; never retain secret values or file
contents in the receipt or observation.

The barrier requires the same locator, affirmative live presence, an observation
time no later than the receipt or evaluation time, and an unchanged hashed file.
Missing, modified, malformed, mismatched or future readback fails the secrets
family. Extra observation fields are rejected so raw provider responses and
secret-bearing payloads cannot be embedded in this minimal record. The evaluator
is offline: it validates evidence integrity and binding, not the authenticity
of an operator's claim or the current remote state. Re-read after rotations or
deployment changes; a snapshot does not establish future availability or that an
external provider will accept a credential. Hosted acceptance remains required.

The existing `vault://`, `aws-sm://`, `gcp-sm://`, `azure-kv://` and
`k8s-secret://` contracts remain unchanged. `env://` is not a production secret
store reference and is still refused. No alternative store reference may be
invented to disguise a Railway resource.

## Artifact receipt command

After obtaining the full release manifest from the artifact workflow, use a
clean checkout of its exact candidate and record actual verification:

```sh
node scripts/production/E/release-receipt.mjs run --root <candidate-checkout> \
  --family E.artifacts-published \
  --artifact-manifest <candidate-checkout>/release/release-manifest.json \
  --receipts <candidate-checkout>/release/receipts \
  --evidence-dir <candidate-checkout>/release/evidence \
  -- node scripts/production/E/release/verify-release.mjs \
     --manifest release/release-manifest.json --pull true \
     --report release/verify-release.json
```

The producer hashes the manifest and records its path. A verification command
that changes the source or the manifest fails. Keep evidence outside source
input directories and retain the published registry objects by digest.

## Historical verdict on main (2026-10-10)

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
