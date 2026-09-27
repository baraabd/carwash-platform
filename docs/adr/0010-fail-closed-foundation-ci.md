# ADR 0010 — Fail-closed foundation verification

Status: implemented for review; acceptance is determined by the current-source GitHub run, not this document.

## Context and decision

F001–F008 established real ownership, build, database/broker, authentication, gateway and observability checks. Existing image CI exercised one foundation service. Independent workflows did not provide one explicit fail-closed release decision. Temporary authoring workflows had also reached main; F009 removes three obsolete authoring workflows, not any acceptance workflow.

F009 adds `Foundation release gate` in `f009-foundation.yml`. Every run executes complete static, security, real infrastructure and all current runtime-image gates. A conservative path-aware job accelerates first feedback and orders impacted image targets first; it never substitutes selective coverage for full acceptance. This intentionally prioritizes evidence correctness over maximal CI cost savings.

Runtime targets come from the ownership catalog: ten current service runtimes plus the existing gateway. All workspace builds, including the three browser application boundary packages and nine ownership-only service skeletons, remain covered by F001. Missing app business implementations are not fabricated. An unclassified runtime image or schema causes discovery to fail rather than silently skipping it.

## Integrity and security

- Checkout uses the exact PR head or push SHA with read-only contents permissions and no persisted credentials.
- An aggregate requires all seven job dependencies to succeed and all seventeen distinct stage records to match source SHA, source tree, run ID and attempt. Missing, failed, canceled, skipped, duplicate or dirty-source evidence is rejected.
- Test wrappers additionally require a nonempty complete TAP summary with zero failures, skips, TODOs and cancellations. The negative test creates an actual cross-service import in a disposable fixture and proves the aggregate CLI exits unsuccessfully.
- Gitleaks scans committed source and full fetched Git history. Source scanning uses a clean Git archive, not local secrets or dependency caches. Raw scanner findings are never uploaded as artifacts.
- pnpm audit blocks all low-or-higher advisories, retaining the stricter F001 requirement. Trivy blocks HIGH, CRITICAL and unclassified findings, including unfixed findings, and any detected secret. Scanner/network failures also block. No new allowlist is introduced.
- CodeQL uses a full action commit and its linked tool/query bundle, plus an explicit SARIF result gate for security severity at least 7 or error-level findings. Successful analyzer execution alone is insufficient.
- Security tools are pinned by release URL, archive SHA-256 and extracted binary SHA-256. Node and pnpm retain F002 pins. Existing exact image tags are resolved to digests and the selected digest is used for the build and recorded per image.
- Artifacts contain structured summaries, tool/source identity and filtered CycloneDX inventories. Credentials, `.env.local`, acceptance contexts, raw request data, infrastructure logs and SARIF snippets are not included in F009 artifacts.

## Consequences and operating limits

Each implemented image is independently built, run without external networking, checked for non-root execution, liveness 200, deliberate not-ready 503, absence of root-level credential directories, and clean SIGTERM exit. Its exact image ID is then scanned and inventoried before scoped cleanup. No global Docker cleanup occurs.

Branch/ruleset configuration is separate from source code. A repository administrator must make `Foundation release gate` required and require review for CI changes; the connected integration does not expose administration access. Without that repository setting, a privileged human can still bypass a red check. F009 does not claim otherwise.

No production deployment, automatic merge, full browser application, high availability or load certification is introduced. F010 remains dependent on accepted F009 and identified approved HTML references.
