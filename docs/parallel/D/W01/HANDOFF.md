# W01-D handoff and resumable checkpoint

Task/phase: **W01-D / bounded admin and supporting-domain inventory proposal**.
Parent state: **WAVE_ACCEPTANCE_BLOCKED**, not DONE or WAVE_ACCEPTED.
Delivery state: source-derived packet prepared for a draft PR; no business implementation.

## Immutable source and publication identity

| Item | Value |
| --- | --- |
| Observation/branch parent | `69d81a83a3409d0693272efeb19ebeb9805750f5` |
| Observation source tree | `1988caa3f882bc0c6007ae830950b7f34f53d294` |
| Target | `main`; re-read the exact target SHA before candidate gates |
| Branch | `sprint/w01-D-admin-contract-freeze` |
| Published `BASE_W01` / `BASE_W02` | Absent at entry; null, never replaced by the observation SHA |
| Final packet head/tree/PR | Recorded externally in the draft PR description after object publication; a file cannot contain its own final Git commit SHA |
| Accepted-source contract packages | contracts 0.0.2; event-contracts 0.0.2; api-clients 0.0.1 |
| Proposed contract status | `draft`, unaccepted; see CONTRACT_PROPOSALS.md; package versions remain unchanged |
| Migration IDs | None |

## Complete changed-path allowlist

1. `docs/parallel/D/W01/README.md`
2. `docs/parallel/D/W01/SOURCE_AUDIT.md`
3. `docs/parallel/D/W01/BASE_CI_OBSERVATION.json`
4. `docs/parallel/D/W01/ADMIN_SURFACE_MATRIX.md`
5. `docs/parallel/D/W01/CONTRACT_PROPOSALS.md`
6. `docs/parallel/D/W01/DECISIONS.md`
7. `docs/parallel/D/W01/HANDOFF.md`
8. `tests/parallel/D/W01/ACCEPTANCE_SPEC.md`

No schema/client generation, migration, business database access, shared-contract publication, package/lockfile write or design-reference update occurred. The test file is a declarative Markdown specification, not a passing executable runtime suite.

## Publication requests to E

E receives this complete packet through the PR. These are requests, not recorded acceptance or a bootstrap lease.

| Request | Required publication and gate |
| --- | --- |
| Wave authority | Publish real BASE_W01 and owner registry, exclusions for any active changed paths, exact temporary bootstrap lease, expiry at verified BASE_W02 and gate manifest. Decide the disposition of this observation-based draft. |
| Existing Identity plus extensions | Preserve real sessions, CSRF, account status/role endpoints and existing permission strings. Accept a versioned finer admin action/object-scope grant model and an audited bootstrap plan with real custodians, expiry and revocation evidence. Do not fabricate new authentication. |
| W02 Configuration | Accept versioned reads/drafts/publications, optimistic concurrency, validation authority, future-effective activation/audit, consumer applicability and compatible event/client schemas from CONTRACT_PROPOSALS.md. |
| Shared changes | E alone authors any accepted packages/contracts, event-contracts, api-clients, package.json/lockfile/tsconfig, runtime bootstrap, infrastructure, CI and global script changes. No Lane D manifest or dependency edits in W01. |
| Resource allocation | Allocate lane/wave/run namespaces, ports, private DB/roles/queues/objects and browser profiles before real tests. One heavy acceptance slot per workstation initially. No namespace is silently invented here. |
| Local environment | Provide pinned Node 24.21.0 and pnpm 10.32.1 (actual local 24.19.0/11.25.0 failed the runtime guard). Root app build/typecheck does not cover all frontends; gate manifest must name actual per-app commands. admin/operator currently lack dev/preview scripts. |
| Acceptance | Preserve all mandatory CI and independent review; build a latest-main + PR-head candidate, verify both refs stable, rerun applicable gates for the resulting target and only then publish the next accepted base. |

## Cross-lane action requirements

The complete action inventory remains in ADMIN_SURFACE_MATRIX.md; these packets group producer requests without reducing scope.

| Lane/owner | Required admin producer surfaces and independent facts |
| --- | --- |
| A / Customer, Vehicle, Geo | Customer search/list/detail/contact/consent/history and purpose-limited CSV data; owned vehicle reads with optional plates; launch coverage geometry/version validation. Operational fleet belongs to Workforce, not customer Vehicle. Customer/coverage updates use owning-domain authorization and revisions. |
| B / Catalog, Pricing, Billing, Wallet, Subscription | Catalog package/add-on/duration data and package creation; authoritative price/promotion/coupon constraints; exact currency/minor-unit totals; obligation/payment verification/reconciliation/refund request reads and authorized actions; custody balances/holds linked to Billing posting references; customer plan/remaining-wash/renewal facts. No Card scope, customer stored-value funding/withdrawal, payroll or automatic recurring debit is inferred. |
| C / Workforce, Media, Scheduling, Booking, Dispatch | Technician list/create/eligibility and review requests; private identity/fleet evidence via object-authorized Media; workforce fleet/equipment/maintenance data; booking search/status/details and manual-create/reschedule/cancel actions that revalidate quote/availability; Dispatch assignment/location freshness; Scheduling holds/capacity. W02 producer contracts/readiness must precede W03 technician review and booking consumers. |
| D / Configuration, Communications, Support, Reviews, Reporting | Published settings snapshots; durable delivery attempts/conversations; cases/resolution and privacy intake; verified reviews/moderation; event-derived dashboards/reports/checkpoints/corrections/export jobs. D requests peer facts through public accepted contracts, never private DTOs, implementations or databases. |
| E / Identity and Gateway | Admin sessions/grants/bootstrap, object/resource claims and revocation freshness; stateless authorized composition/routing. Gateway/admin own no business data. |

Finance authorization is independent of support/reviewer authority. Private reviewer access is not granted by navigation. Booking state, capacity, assignments/work, money, custody and entitlements remain separately authoritative. Reporting is eventually derived with checkpoint/freshness disclosure and is never used to approve payments.

## Proposed dependency sequence — requires E acceptance and the next prompt

1. **W01-E-BOOTSTRAP-PREREQUISITE** (E-owned proposal): publish and complete the exact W01 temporary lease for technical service/admin/operator activation and manifests/resources without business behavior or locked design changes. Its authority expires at verified BASE_W02; W02 must not inherit that lease. Accept actual runtime commands and publish the verified common base before permanent business writers begin.
2. **W02-E-IDENTITY-PREREQUISITE** (E-owned proposal): on accepted BASE_W02, accept compatible Identity admin grants/account bootstrap and transport, with real owned persistence/HTTP/CSRF/revocation tests. An already satisfied foundation capability needs verification, not a duplicate replacement. Any post-expiry cross-owner technical write needs a separately accepted exact lease.
3. **W02-D-CONFIGURATION-PROVIDER** (future D child proposal): Configuration provider against the merged Identity prerequisites with real local DB/upgrade/concurrency/outbox/authorization and published contract conformance. No admin consumer is required to exist to prove this narrow provider slice.
4. **W02-D-ADMIN-BOOTSTRAP-CONSUMER** (future D child proposal): admin shell and allowed settings reads/actions against the now-merged real providers; prove the affected browser journey before consumer merge. Approved reference gaps must be resolved before affected production screens are authored.
5. C/A/B provider children then their consumers: W03 technician review waits for accepted Workforce/Media/Identity producer evidence; booking readers/actions wait for accepted Booking/Scheduling/Pricing/etc. configuration and settings never bypass domain validation. Supporting-domain producer children precede the admin consumers requiring their real full journeys.

These are dependency proposals, not authorization to start W02 or promises that the source can finish in seven days. Keep each parent INTEGRATION_PENDING until all its task-listed integrated cases pass. E names/accepts child scopes and gates at the barrier; never branch from an unmerged peer or close integration with fixtures.

## Evidence and execution limits

Exact before-edit commands/results are in SOURCE_AUDIT.md. Source-reference guards and their 16 existing unit cases passed under the actual unpinned local runtime. Full toolchain guard failed on both actual versions; config-only guard passed with runtime excluded. All future product cases in ACCEPTANCE_SPEC.md are NOT_RUN, including DB migrations, HTTP authorizations, broker crash/replay, full browser/visual/accessibility flows, Windows/device checks, staging and live providers. No fixture or simulated toast is treated as persistent state or operational proof. BASE_CI_OBSERVATION.json concerns only the immutable pre-packet source SHA.

After-edit proof:

| Exact command / review | Result and scope |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 69d81a83a3409d0693272efeb19ebeb9805750f5` | Exit 0; 10 artifacts, `baseCompared=true`, zero errors; references and protected policies unchanged |
| `node scripts/f010/reference-registry.mjs --base-ref 69d81a83a3409d0693272efeb19ebeb9805750f5` | Exit 0; 3 references, `baseCompared=true`, zero errors; no baseline registration or tolerance changes |
| `git diff --cached --check` | Exit 0 after staging the final eight-path packet; whitespace gate only |
| `git diff --cached --name-only` | Exactly the eight allowlisted paths above; no source/shared/generated edits |
| Source and packet census / relative-link review | All 17 sections/nav IDs, 58 static buttons (36 handler-bound/22 inert), 8 static fields, 5 modal types/16 fields covered; 105 unique declarative case families; 18 open decisions; local deliverable links resolve |
| Internal read-only quality review | Confirmed source claims/coverage and corrected bootstrap lease sequencing and adjacent source-line anchors. This is not independent GitHub approval. |

Final PR metadata carries the published head/tree and latest remote checks; old base CI must not be copied as final-head green evidence. The failed local runtime pin guard remains visible in SOURCE_AUDIT.md; diagnostic reference success does not waive pinned candidate acceptance.

## Owned resources and resume action

- Owned source worktree: Lane D branch above. Other sessions' worktrees and refs were not reset/stashed/cleaned/overwritten.
- Owned runtime processes, server PIDs, containers, ports, DB/roles, queues, buckets, browser profiles: **none allocated or started**. Cleanup: none needed.
- Scratch diagnostics: `w01-d-evidence/00.log` through `06.log` and `results.json` alongside the worktree. These are reproducible source-only logs, no secrets. Durable evidence summaries and exact remote workflow links are committed in this packet.
- External dependencies: E's actual wave/contract/resource/gate publication; owner decisions DEC-D-*; independent reviewer; real provider contracts/accounts/capabilities where required; producer implementations in A/B/C.
- Next action: E reviews this draft, accepts or returns proposal changes, resolves required decisions with their owners, and publishes the accepted next base/contracts. Resume only on that base and the next bounded Lane D task. No auto-merge or deployment is authorized.
