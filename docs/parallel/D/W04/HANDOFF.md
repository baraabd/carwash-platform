# W04-D — English resumable handoff

Task/phase: **W04-D / BLOCKED_ENTRY / lane-local analysis and proposals**.
Parent product implementation: **NOT_STARTED**. All **34 declarative case families
are BLOCKED / NOT_RUN**; no passing product-case count is claimed.

## Source, base and publication binding

Observed immutable proposal parent/target:
`1ec9d8aebf4470a2815471116643fa6ebe0d5a95`.
Tree: `9f04d674056041bbc810a62e4cc7f275c32581b8`.
Accepted BASE_W04: **unpublished**; BASE_W03 field absent and BASE_W02 null.
No observed main SHA or proposal merge is renamed an accepted wave base.
Own isolated branch: `proposal/w04-D-cash-operations-entry`, targeting main as
a draft. Final head/tree, exact changed-path list and CI snapshot are bound in the
English PR description after Git objects exist, avoiding a self-referential SHA.

D W03 #55 is merged at `a2eb3aba835b48c0908fb4d0ac6339bd4120fbb3`.
All W03 #51–55 externally merged; their 29 new paths since the earlier observed
target are documentation/declarative specifications, no runtime acceptance.
Current observations, versions, model/reference hashes and main CI state are dated
in SOURCE_OBSERVATION.json; prior wave snapshots retain historical meaning.

Source versions: contracts **0.0.2**, event-contracts **0.0.2**, api-clients
**0.0.1**; admin, Communications, Reporting and Configuration **0.0.2**.
Accepted W04 assignment/Booking/cash/custody/settlement/Communications/participant
contract IDs, client versions and producer runtime acceptance: **none**.
Identity security and Catalog probe remain existing foundation capabilities.
Strict booking.confirmed.v1 remains contract-only; it is not a cash-event release.

## Exact changes and runtime effect

Six D-local additions only:

- `docs/parallel/D/W04/README.md`
- `docs/parallel/D/W04/COMMUNICATIONS_REPORTING_PLAN.md`
- `docs/parallel/D/W04/W05_CONTRACT_REQUESTS.md`
- `docs/parallel/D/W04/SOURCE_OBSERVATION.json`
- `docs/parallel/D/W04/HANDOFF.md`
- `tests/parallel/D/W04/ACCEPTANCE_SPEC.md`

No app/service/schema/shared-package/manifest/CI/infra/registry/reference source
modified. New migration IDs: **none**. Product behavior changes: **none**.
Admin remains technical-only; Communications owns marker/Inbox/ProbeNotification
and Reporting marker/Inbox/ProbeProjection. No product notification, attempt,
conversation/message, checkpoint/audit or reconciliation implementation is claimed.

E's bootstrap permission is expired by the current instruction and merged handoffs;
the unreconciled conditional registry does not restore it. D permanent ownership
does not waive missing BASE_W04/contracts or authorize peer source changes.
All 17 admin inventory rows remain present. Approved operational/finance/delivery/
freshness states and current actor/holder/policy/provider decisions remain pending.
Location source is explicitly **C Workforce** in W04; execution authority remains
separately unresolved pending C/E review. No new service is invented.

INT-D-01 is a **static finding, not a database reproduction**: both D Inbox stores
can classify changed-byte identity races and unrelated effect-unique errors as
DUPLICATE, then ACK. Required actual concurrent integrity/control/rollback tests
are in the specification; no repair or runtime failure evidence is claimed here.

## Tests actually run

Actual local runtime: Node **24.19.0**, pnpm **11.25.0**. Required pins:
**24.21.0 / 10.32.1**. Offline checks below are source/document diagnostics;
they do not certify pinned app/DB/broker/provider/browser acceptance.

| Exact command | Actual result |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95` | PASS before and after edits; 10 artifacts |
| `node scripts/f010/reference-registry.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95` | PASS before and after edits; 3 references |
| `node scripts/parallel/E/check-owners.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95 --worktree --lane D` | PASS: exactly 6 D-local document/spec paths, zero findings |
| `node --test --test-reporter=spec tests/parallel/E/ownership.test.mjs tests/design/reference-lock.test.mjs tests/f010/reference-registry.test.mjs` | PASS: 35 existing guard tests; no skipped cases |
| `node architecture/implementation-status.mjs --self-test` | PASS: 9 adversarial cases; 19 runtimes / 18 foundation shells; productionReady false |
| `node scripts/check-migrations.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95 --json` | PASS: 21 owner-local migrations, none changed; 427 source files scanned |
| `node scripts/verify-toolchain.mjs --json --config-only` | PASS: declared configuration only, runtime verification omitted |
| `node scripts/verify-toolchain.mjs --json` | FAIL: two actual runtime-version mismatches; no pin or guard changed |

Final staged/committed owner-scope and whitespace commands/results are recorded in
the PR publication checkpoint. Historical W01 ownership test success is not active
bootstrap permission. The CLI protected-base-blob label does not prove branch
protection: main was observed unprotected. Read-only packet review is not eligible
independent GitHub approval or a latest-target integrated candidate gate.

Actual discovered commands, **NOT_RUN for product acceptance**:

```bash
pnpm --filter @carwash/admin-web typecheck
pnpm --filter @carwash/admin-web build
pnpm --filter @carwash/admin-web test:runtime
pnpm --filter @carwash/communications generate
pnpm --filter @carwash/communications typecheck
pnpm --filter @carwash/communications build
pnpm --filter @carwash/communications build:tests
pnpm --filter @carwash/communications migrate:deploy
pnpm --filter @carwash/reporting generate
pnpm --filter @carwash/reporting typecheck
pnpm --filter @carwash/reporting build
pnpm --filter @carwash/reporting build:tests
pnpm --filter @carwash/reporting migrate:deploy
pnpm test:nest
pnpm test:contracts
pnpm acceptance:preflight
pnpm acceptance:run
```

Communications/Reporting have no package test:runtime script. Root build/typecheck
does not cover the three frontends; E's final gate must run explicit affected app
commands and every mandatory job. Foundation DB/broker and F010 tests do not cover
the listed product cases. No install/build, source generator, db push/reset or
runtime acceptance was attempted by this packet.

## Environment and external dependencies

Real work: local immutable source/Git inspection, GitHub metadata and offline guards.
Product fixtures/mocks used as acceptance: **none**. Approved prototype rows remain
fixtures. DB/broker/HTTP/provider/browser/staging/Windows/device environment work:
**NOT_STARTED**. E-assigned W04 environment/heavy slot: **not published/reserved**.
Owned runtime PIDs, containers, ports, DB roles/queues/object prefixes, browser
profiles and allocation/lease handles: **none**. No runtime cleanup remains.

All integrated cash/eligibility/private evidence/collection/handover/treasury,
concurrent admin/rejection/response-loss, persistence/duplicate/order/hash/restart,
provider-timeout/current-membership/fanout, reconciliation/freshness/location and
Linux/Windows/device cases remain blocked and unrun.

Next action: E completes predecessor contract/provider/barrier reviews and publishes
actual BASE_W04, reconciled permanent path policy, resources and mandatory commands.
A/B/C/E supply the accepted real authority providers; product/design resolves exact
cash/operational/membership/provider/visible states. Agree child scopes with E:
narrow C binding/operations → D Communications → B cash/custody as dependencies
require → D Reporting/admin consumers → serialized three-app integration.
Do not impose unmerged consumer journeys as producer prerequisites.

W05 requests for electronic proof review, cancellation compensation, refunds,
rescheduling and settlement corrections are unaccepted next-wave proposals only.
No W04 action/test requires executing them. Stop at this reviewed W04 handoff;
no automatic next wave, self-approval, merge, deployment or live money operation.
