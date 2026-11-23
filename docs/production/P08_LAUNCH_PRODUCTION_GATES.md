# P08 — launch and production gates

## Scope and source

This delivery follows the owner's 2026-11-23 instruction to implement P08 after
merging P07. Its base is `develop`
`7245fdc9d91ef5bc68f207f1c324028317d57437` (merged PR #148).
It strengthens the existing P07-E1 artifact pipeline, P07-E3 recovery drill,
P07-E4 repository governance and P08-E1/E2 launch tooling. The historical
requirement identifiers remain unchanged.

The delivery makes launch decisions fail when their source, evidence or
observations cannot be verified. Completing these engineering gates does not
itself deploy the platform or issue production authorization.

## Closed failure modes

| Boundary | Failure before this change | Enforced behavior |
| --- | --- | --- |
| Pull-request coverage | Artifact and recovery workflows could be absent from a `develop` pull request, or from a change outside their path filters. | Both workflows run for every pull request to `develop` and `main`. The artifact aggregate accepts only the successful path selected by the event and branch. |
| Candidate provenance | A gate or build could change source after the initial check while retaining the earlier commit identity in its evidence. | Relevant source must be clean and remain on the same commit and tree before and after the operation. Source drift cannot produce a passing receipt. |
| Release manifest | A small digest map could stand in for the complete release and use a different authorization digest. | The barrier reads the full hashed release manifest, checks every catalog runtime and migration artifact, and uses its canonical digest for authorization. |
| Candidate configuration | Configuration digests could be omitted, and the evaluator's policy could differ from the candidate's policy. | Candidate and receipt configuration digests are mandatory and recomputed from pinned Git objects. Policy, source metadata and migration sets must match that candidate. |
| Required checks | A protection receipt could name an arbitrary subset of checks; the ordinary review count conflicted with the owner's recorded policy. | Protection evidence must cover the candidate's complete governance policy. The recorded ordinary PR review count is preserved; independent production review remains a separate required receipt. |
| Recovery inventory | A database owner without a migration directory could silently disappear from the drill. | Every catalog database owner must have a valid migration set, and recovery evidence records clean, stable source. |
| Production smoke | An off-origin denial, an unrelated dashboard response or an endless slow response could produce misleading evidence. | Protected paths stay on the gateway origin; HTTPS, hostname coverage, dashboard identity and absolute request deadlines are enforced. Explicit local fixture results cannot serve as production evidence. |
| Initial operating window | An empty window, invalid incident resolution or lower-priority breach could mask missing observations. | Observation coverage is required, incident timestamps and contacts are validated, and the highest-severity decision wins. |

## Continuous integration

The release pipeline checks out the exact pull-request head. The catalog
currently contains 23 runtime targets and 19 migration targets; all 42 artifacts
must be represented. Each matrix job builds and pushes to a disposable loopback
registry, verifies the resulting digest and provenance, pulls by digest, and
rehearses the migration image against PostgreSQL where applicable. Assembly
rejects incomplete inventories and inconsistent source or base-image metadata.

`Release artifacts verified` is an unconditional aggregate. For a pull request
or a `develop` push, rehearsal must succeed and publication must be skipped.
For a `main` push or a manual run on `main`, publication must succeed and
rehearsal must be skipped. A skipped, cancelled, missing or failed selected path
cannot pass the aggregate. Publication keeps its existing main-only permission
boundary.

`Data-plane recovery drill` runs the real disposable database, broker, cache,
object-storage and monitoring recovery scenarios. Its report contains measured
RPO/RTO and injected-failure outcomes. The drill is additional evidence; it does
not substitute a restoration rehearsal from the actual previous production
backup.

The desired governance policy adds these two gates and
`All business acceptance families passed`. The business aggregate requires all
19 acceptance families. Existing build, contracts, design lock, security,
database, broker and browser checks continue to apply.

## Release evidence workflow

1. Select the exact release commit and clean checkout. Generate the candidate
   with `release-receipt.mjs candidate`, pinning the intended Git references.
2. Run each required gate through `release-receipt.mjs run`. Retain the command
   result and hashed evidence; a changed source or unsuccessful gate produces
   failure evidence.
3. For `E.artifacts-published`, use `--artifact-manifest` to bind the full
   verified `release-manifest.json`. The artifact receipt and production
   authorization must agree on that manifest's canonical digest.
4. Obtain real protection records, independent review, infrastructure and
   secret-store references, merchant readiness, incident contacts, approved
   thresholds and time-bounded production authorization. They are required
   evidence, not generated defaults.
5. Evaluate `release-barrier.mjs`. A missing, conflicting, changed, stale or
   invalid receipt yields `NO_GO` and identifies the remaining owner action.
   `GO` authorizes the reviewed runbook for the exact candidate and artifact
   digest; the evaluator does not deploy anything.
6. After an authorized deployment, run production smoke against the approved
   target and evaluate the initial operating window with actual observations.
   The runbook acts on `ROLLBACK`, `STOP` or `FORWARD_RECOVERY` decisions.

Detailed contracts and commands are in
[P08-E1_RELEASE_BARRIER.md](E/P08-E1_RELEASE_BARRIER.md) and
[P08-E2_SMOKE_AND_OPERATING_WINDOW.md](E/P08-E2_SMOKE_AND_OPERATING_WINDOW.md).

## Acceptance and operational boundary

Regression tests use disposable Git repositories, real TLS/HTTP listeners and
invalid or drifting evidence to exercise the failure cases. The full production
tooling suite, formatting, lint, workflow validation and existing repository
gates must pass on the exact PR head before merge. The artifact and recovery
workflows must complete successfully in CI; unit fixtures cannot replace them.

Repository protection is described truthfully in
[P07-E4-GOVERNANCE.md](E/P07-E4-GOVERNANCE.md). Its desired policy is not a claim
that GitHub enforcement is already active. Applying required contexts must wait
until their workflow definitions exist on the protected target branch, and must
be verified through the GitHub API.

No production target, merchant credentials, live-money authorization or
independent release approval is invented by this delivery. Historical release
reports retain their original dates and candidate IDs. They cannot authorize a
new candidate. Locked UI references, service ownership, financial policy and
existing database migrations remain unchanged.
