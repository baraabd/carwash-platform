# W01-E bootstrap checkpoint

Task: `W01-E-BOOTSTRAP`. Parent: `INTEGRATION_PENDING`. No merge or deployment.

`BASE_W01` and observed target: `69d81a83a3409d0693272efeb19ebeb9805750f5`.
Base tree: `1988caa3f882bc0c6007ae830950b7f34f53d294`.
Branch: `sprint/w01-E-bootstrap`. Exact candidate head/tree are recorded in the draft PR and final-source CI evidence; the handoff file cannot contain its own commit SHA.
PR #41 is already merged. Its 33 W01 A-owned paths remain protected. Identity source and all ten original schemas remain unchanged.

## Resulting behavior

- All 832 tracked base files have one effective owner; 165 exact nonreserved bootstrap paths have E leases until a verified `BASE_W02`.
- Unknown/unowned/multiply-owned changes, forbidden manifests, live C014 exceptions, overlapping leases and expired leases fail closed. Initial enforcement requires an independently reviewed bootstrap digest. Writer plans are independently pinned policy commits binding exact base/head/path writers; they do not create a Git SHA self-reference.
- Nine new services have independent foundation runtime/build/Prisma/migration/image identities. Their business readiness remains false. Every new migration is `20261005060000_w01_foundation` in its own service.
- Customer has a separate technical image for the unchanged demo. Operator/admin have minimal technical boots, with liveness 200 and readiness 503. No operator/admin product screens were ported.
- Classification separates skeletons, onboarded foundation runtimes and the existing Identity/Gateway capabilities. CI discovers 19 DB owners, Gateway and three web artifacts; unknown runtimes, DB owners, Docker variants and symlink artifact trees are rejected.
- Generators require explicit service scopes. Existing evolved files/schemas are never overwritten; publication is exclusive and batch failures roll back only newly created files. Read-only checks enforce runtime identities and boundaries while allowing owner evolution.
- Acceptance provisions credentials for all 19 services, validates exact source/tree and migrated-owner scope, and persists its verdict after scoped cleanup. Cleanup failure or `--keep` cannot produce acceptance.
- Lane allocations supply separate Compose projects, port blocks, broker/object/Redis prefixes, browser and artifact paths. Catalog DB names are scoped inside separate containers. A one-slot launcher and real two-stack PostgreSQL isolation gate are implemented.

## Local validation

Node `24.21.0`, pnpm `10.32.1`, Linux. Frozen install, dependency audit, backend build/typecheck/lint, all three explicit app builds/typechecks, boundary/layer/migration guards, contract discovery, secret guard and design preservation passed. The two formatter policies are kept separate.

Focused suites before the security follow-up: 81 parallel-platform tests, 553 general unit tests, 171 Nest tests, 49 observability tests, 22 Gateway tests, 10 F010 unit tests; zero failures/skips in those passing runs. The nine newly onboarded services contribute 81 of the Nest cases, not an extra 81 on top of that suite. Earlier failed attempts (formatting and old fixed artifact count) were corrected and their affected gates rerun. The security follow-up adds three allocator cases and nine portable-execution cases; current counts and final-source results are recorded in the draft PR.

F001's complete local suite returned `ACCEPTED`: all 17 gates PASS, no blockers, `sourceDirty=false`, tested commit `116ebf67a00641612d67e5a14b6ebc0ba63750c5`, tree `9c59004c2fecddf833281a9cd41b792d2e951639`. Report generated at `2026-10-05T06:51:37.775Z` in `/workspace/scratch/baf0b620615a/f001-final-evidence/report.json`. This verifies that code candidate's F001 scope only. Later intake/checkpoint documentation and subsequent source edits change the final source/tree: affected gates require reruns, and final-source CI remains pending. The local result is not independent review, Docker/browser acceptance or resulting-main acceptance.

Real PostgreSQL/RabbitMQ migration/upgrade/drift, two-stack runtime isolation, non-root container boot/native/Trivy/SBOM, Identity browser and canonical Linux pixel gates require CI/Docker. Docker is unavailable in the current workspace. Policy fixture tests and real HTTP tests do not establish those results. Windows/device evidence was not run here.

## Hosted candidate and security follow-up

Initial delivered head `4face6d0cda833306fd1030d11ac52cd09215ec7`, tree `d9c853588462406ccc5e7698120182242072488e`, is in draft PR #45. GitHub's target-plus-head candidate `e0e78715cfef1d4d7acbdedef8f5ec6c262188cc` had the identical tree and exact parents `BASE_W01` plus that head. F001/static and the real integration job passed on that source. Integration included all 19 DB owners, PostgreSQL/RabbitMQ and Identity/Gateway browser acceptance, plus two real independent PostgreSQL stacks: distinct ports, containers, volumes, cluster identities, credentials and sentinel data, foreign-password refusal and scoped cleanup/lease release. This evidence belongs only to the initial head; every required check is rerun after source changes. [Initial F009 run](https://github.com/baraabd/carwash-platform/actions/runs/37275286841).

CodeQL found a blocking allocator file race. JSON reads now use one bounded checked descriptor, with nonblocking opens to refuse FIFOs promptly. Tests reject symlinks, directories, oversized manifests and substitution before any bytes are read. Windows package-manager resolution now invokes known JavaScript CLI entrypoints with Node or native executables, refusing unsupported batch aliases. Asset tests validate flat paths and exact loopback origin before requests, with redirects rejected. No scanner assertion, threshold, reference or exception was loosened. Simulated Windows resolver tests are not actual Windows/device evidence; final CodeQL and runtime checks remain required.

The initial F009 all-ref Gitleaks gate failed on `generic-api-key` in unrelated, unmerged B commit `2b5042caa6902b911f01ae5b9d41725a1b79fcf7`, `docs/parallel/B/W01/POLICY_DECISIONS.md:19` (B-11 prose). Pinned reproduction found zero findings before adding B's branch and exactly one afterward; that commit is not ancestral to the accepted base or E head. The row supplies no credential literal and appears to be a documentation false positive, but the inherited `--all` gate still blocks. B and the repository owner must choose reviewed remediation; a wording-only follow-up retains the old history. E changed no peer source, scanner allowlist or ref scope. [Failed security job](https://github.com/baraabd/carwash-platform/actions/runs/37275286841/job/111650910450). No matched value is reproduced here.

## Release boundary and dependencies

`BASE_W02` is null. No A–D packet is present in the immutable inventoried base. The 2026-10-05 06:56 UTC GitHub refresh received unmerged draft proposals B #44 (`2b5042caa6902b911f01ae5b9d41725a1b79fcf7`), C #43 (`15e5b224d122a995bbe932725c1b3a71d7a06aeb`) and D #42 (`edb8a0392e3c3ad926cdb35d17c9c0e54b2dac00`); A remains unreceived in the observed open PRs. Immutable packet indexes and pending dependencies are in `INPUTS_AND_CONTRACTS.md` and `architecture/parallel-contract-release.json`. All three remain proposals pending review; no next-wave HTTP/event/client contract has been invented or accepted. At the separately recorded current-head check observation, C/D each had 32 successful checks; B had failed security and Foundation release gates, which block its acceptance pending B-owned investigation and reruns. See the intake document for immutable-head evidence URLs; green peer checks are not independent review or resulting-main acceptance. Existing public contract packages remain `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, and skeleton `@carwash/api-clients@0.0.1`. See `INPUTS_AND_CONTRACTS.md` for owners, required semantics and barrier deadlines.

Main is unprotected, with no rulesets observed. The connection's branch-administration endpoint returned 403. `REPOSITORY_RULES.json` prepares enforceable settings without claiming they were applied. Independent reviewer identity and protected owner-policy configuration remain pending. One GitHub author cannot independently approve their own PR.

Prices/geography/hours, custody and hold holders/purposes, merchant/provider verification, refunds/cancellations, technician operating model, privacy fulfillment/retention and performance/recovery targets require their listed input owners. The approved current methods remain cash/ShamCash/Syriatel Cash. No Paymera method, global database delete, stored-value product or production payment was introduced.

Development Compose now provisions all 19 owners on a fresh disposable stack. Existing developer volumes are not reset or implicitly upgraded by this change; adding roles to an existing stack requires a separately reviewed provisioning operation.

Owned running process/container handles at handoff: none. Allocation tests clean only their own temporary leases. The real two-stack gate records its created handles and retains leases if cleanup fails.

Next action: review this bounded bootstrap provider draft, complete exact-source required CI and independent policy review, then sequence actual A-D contract packets as `W01-E-CONTRACTS`. Only the serialized `W01-E-BARRIER`, with checks on the resulting target SHA, can publish `BASE_W02` and expire the W01 leases.
