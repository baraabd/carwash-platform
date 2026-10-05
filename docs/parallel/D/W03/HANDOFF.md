# W03-D — English resumable handoff

Task/phase: **W03-D / BLOCKED_ENTRY / lane-local analysis and proposals**.
Parent runtime implementation: **NOT_STARTED**. All required product cases:
**BLOCKED / NOT_RUN**, enumerated in `tests/parallel/D/W03/ACCEPTANCE_SPEC.md`.

## Exact source and publication

Observed proposal parent/target: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`.
Tree: `050b4b8a03be2bc671cbaa00151ea7105891e2d4`.
Accepted BASE_W03: **unpublished**; no substitute or placeholder SHA. BASE_W02
still null. Branch: `proposal/w03-D-private-review-entry`, targeting main as a
draft. Final published head/tree/check snapshot is bound in the PR description
after Git objects exist; this file does not invent a self-referential commit ID.

Source versions: contracts `0.0.2`, event-contracts `0.0.2`, api-clients `0.0.1`,
admin-web/Reporting/Configuration `0.0.2`. Accepted W03 reviewer/Media/Booking/
permission/Reporting client/event IDs and release versions: **none**. Strict
Identity V1, Catalog probe and contract-only booking.confirmed.v1 remain separate
from the unaccepted W02/W03/W04 requests.

PR #48 merged at `0df9469c41f62c35235291fa7402cc132d690a25`; E #50 merged at the
observation target. The 31 paths added by all W02 proposal merges contain no
runtime change. E explicitly prohibits further bootstrap cross-owner writes;
the conditional registry/checker and exact transition gaps still need reviewed
reconciliation. No E permission is restored by the old registry.

## Scope and static findings

Exact additions in this proposal:

- `docs/parallel/D/W03/README.md`
- `docs/parallel/D/W03/SOURCE_OBSERVATION.json`
- `docs/parallel/D/W03/W04_CONTRACT_REQUESTS.md`
- `docs/parallel/D/W03/HANDOFF.md`
- `tests/parallel/D/W03/ACCEPTANCE_SPEC.md`

No app/service/package/schema/CI/infra/registry/reference change. New migration IDs:
**none**. Reporting still owns only ServiceMarker/InboxMessage/ProbeProjection;
real product checkpoints/audit/projections and their append-only migrations are
future accepted work. All 17 screen rows are retained in the README.

INT-D-01 is a **static integrity finding, not a database reproduction**: Reporting's
entire-transaction unique-error catch can classify a changed-payload race or an
unrelated projection constraint error as DUPLICATE, which the consumer ACKs.
Required real race/rollback tests and owner-local repair are provider acceptance
prerequisites. Communications shares the pattern; no broader fix starts here.

## Tests actually run and limits

Actual local runtime: Node **24.19.0**, pnpm **11.25.0**. Repository requires
**24.21.0 / 10.32.1**. The checks below are offline source/document diagnostics,
not pinned W03 application/DB/broker/browser acceptance.

| Exact command | Actual result |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 82e7402ed9ab6cc4f565f423441cd0655f2d627a` | PASS before and after edits; 10 artifacts |
| `node scripts/f010/reference-registry.mjs --base-ref 82e7402ed9ab6cc4f565f423441cd0655f2d627a` | PASS: 3 approved references compared with immutable source |
| `node scripts/parallel/E/check-owners.mjs --base-ref 82e7402ed9ab6cc4f565f423441cd0655f2d627a --worktree --lane D` | PASS: exactly 5 D-local document/spec paths, no findings; diagnostic only |
| `node scripts/check-migrations.mjs --base-ref 82e7402ed9ab6cc4f565f423441cd0655f2d627a --json` | PASS: 21 owner-local migrations, none changed |
| `git diff --cached --check` | PASS: staged diff has no whitespace errors |
| `node --test --test-reporter=spec tests/parallel/E/ownership.test.mjs tests/design/reference-lock.test.mjs tests/f010/reference-registry.test.mjs` | PASS: 35 existing guard tests, no skipped cases |
| `node architecture/implementation-status.mjs --self-test` | PASS: 9 adversarial cases, 19 runtimes/18 foundation shells, productionReady false |
| `node scripts/verify-toolchain.mjs --json --config-only` | PASS: configuration only |
| `node scripts/verify-toolchain.mjs --json` | FAIL: two actual runtime-version mismatches; no pin/guard changed |

The existing ownership tests model historical W01 policy; their passing lease
tests do not override E's current prohibition. These immutable-base path,
reference and append-only migration diagnostics do not prove product behavior.
The CLI's `protected-base-blob` label cannot establish protection: main was
observed unprotected. Local review does not satisfy independent GitHub approval.

Discovered commands, **NOT_RUN** for this proposal:

```bash
pnpm --filter @carwash/admin-web typecheck
pnpm --filter @carwash/admin-web build
pnpm --filter @carwash/admin-web test:runtime
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

Reporting has no `test:runtime` package script; do not invent one. Root build/
typecheck omits frontends; explicit admin commands remain required. Existing
foundation DB/broker suites and F010 reference parity do not test the new product
journeys. Migration execution requires the allocated migration identity; no
db push/reset, shared teardown or broad source generator is used.

## Environment, skipped cases and next action

Real work: source/GitHub inspection and offline guards only. Fixtures/mocks used
for product acceptance: **none**; prototype rows remain reference fixtures.
DB/broker/browser/staging/Windows/device environments: **NOT_STARTED**. Owned
process/container/port/queue/object/browser-profile/allocation/lease handles:
**none**. No runtime cleanup remains. Current GitHub observation is dated in
SOURCE_OBSERVATION.json and does not certify this proposal head or W03 business.

All review/private-access/correction/activation/operator visibility, Booking
paging/filter/finance and Reporting hash/order/checkpoint/restart/freshness cases,
plus Linux visual/keyboard/mobile and separate Windows/device tests, are unrun.

Next action: E completes the earlier reviewed base/contract barrier and publishes
actual BASE_W03 with versions/ownership/resources/gates; affected C/A/B/E owners
accept the precise providers and Baraa/design resolves missing production review
states/policies. Accept real C providers first, then D Reporting and admin
consumers, then the combined operator-visible journey. Fix INT-D-01 within that
accepted provider scope before claiming event integrity.

W04 requests remain proposals for dispatch/assignment, cash collection/custody/
handover/settlement and Communications delivery/reconciliation. E/B/C must close
schemas and policy before BASE_W04. Stop at this reviewed W03 handoff; no automatic
next-wave implementation, merge, production deployment or real money operation.
