# W05-D — English resumable handoff

Task/phase: **W05-D / BLOCKED_ENTRY / lane-local analysis and proposals**.
Parent product implementation: **NOT_STARTED**. All **44 declarative case
families remain BLOCKED / NOT_RUN**. No successful financial action is claimed.

## Exact source and publication

Observed immutable proposal parent/target:
`3ce756cd39a9b0c1013043cee0ca1bb183466da7`.
Tree: `cc3517ec85525c7310fe340397506ef6be3fe0a9`.
Accepted BASE_W05: **unpublished**; BASE_W02 is null and BASE_W03/04/05 absent.
This observed main is not a substitute wave base. Own isolated branch:
`proposal/w05-D-finance-authority-entry`, targeting main as a draft.
Final published head/tree/path list and CI snapshot are bound in the English PR
description after Git objects exist; this file invents no self-referential SHA.

D W04 #57 is merged at `b5ea7b620eab777685959d71dacd5b43632a2617`.
W04 #56–60 add 31 document/specification paths since the previous observed target;
they do not implement or accept product runtimes. C014 #41 remains merged session
demo at `69d81a83a3409d0693272efeb19ebeb9805750f5`, not real payment/refund work.
SOURCE_OBSERVATION.json records current model/version/reference and GitHub evidence.
Successful main foundation checks do not establish this head or W05 acceptance.

Source versions: contracts **0.0.2**, event-contracts **0.0.2**, api-clients
**0.0.1**; admin and D supporting services **0.0.2**.
Accepted W05 B payment/proof/refund/cancellation-compensation/reconciliation/
settlement, C Media/Booking and E permission/client contract IDs/versions: **none**.
Existing Identity V1, Catalog probe and strict contract-only booking.confirmed.v1
remain distinct. No private DTO or peer feature branch is consumed.

## Exact changes and limitations

Six D-local additions:

- `docs/parallel/D/W05/README.md`
- `docs/parallel/D/W05/FINANCIAL_OPERATIONS_PLAN.md`
- `docs/parallel/D/W05/W06_CONTRACT_REQUESTS.md`
- `docs/parallel/D/W05/SOURCE_OBSERVATION.json`
- `docs/parallel/D/W05/HANDOFF.md`
- `tests/parallel/D/W05/ACCEPTANCE_SPEC.md`

No app/service/shared package/schema/manifest/registry/CI/infra/reference source
changed. New migration IDs: **none**. Product behavior changes: **none**.
Billing/Wallet/Media/Booking/Scheduling/Dispatch are marker-only; admin is a
technical boot; D workers are foundation probes. No payment search/private proof/
review/refund/settlement/cancel/reschedule/report consumer is implemented here.

Permanent D ownership applies and E bootstrap permission is expired by current
instructions/merged handoffs; stale conditional records do not restore permission.
The missing base/contracts independently block product writes. All 17 admin screen
rows remain visible. Missing precise production Finance/Media/compensation/export
states and actor/approval/reason/currency/provider policies remain external inputs.

**Cancellation AND rescheduling are required current W05 tests**, not W04's
deferred actions. Booking owns durable lifecycle coordination, Scheduling capacity,
Dispatch assignment and B financial compensation; D displays their independent
progress. Failed refund cannot be disguised as failed cancellation, and late
payment cannot revive expired capacity. Work execution binding still requires
accepted C/E owner authority. No local cross-domain state overwrite is proposed.

Cash/ShamCash/Syriatel remain frozen methods; Wallet is internal custody.
Paymera scope, accepted merchant setup/documentation/verification and actual
sandbox/test-fund evidence are pending. No provider availability or real channel
capability is inferred. Production money/refund execution is not a test prerequisite.

INT-D-01 remains a **static source finding, not a reproduced DB failure** in both
D Inbox stores; whole-transaction unique errors can be ACKed as DUPLICATE.
Actual conflicting-hash/same-hash/unique-effect rollback tests and owner-local
repair are required under accepted provider scope. No repair/evidence is fabricated.

## Tests actually run

Actual local Node **24.19.0**, pnpm **11.25.0** versus required **24.21.0 /
10.32.1**. The checks below are offline source/document diagnostics, not pinned
application, database, broker, provider or browser acceptance.

| Exact command | Actual result |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7` | PASS before and after proposal edits; 10 artifacts |
| `node scripts/f010/reference-registry.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7` | PASS before and after proposal edits; 3 references |
| `node scripts/parallel/E/check-owners.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7 --worktree --lane D` | PASS: exact six D-local paths, permanent-owner; no findings |
| `node --test --test-reporter=spec tests/parallel/E/ownership.test.mjs tests/design/reference-lock.test.mjs tests/f010/reference-registry.test.mjs` | PASS: 35 existing guard tests, no skips |
| `node architecture/implementation-status.mjs --self-test` | PASS: 9 adversarial cases; 19 runtimes/18 foundation shells; productionReady false |
| `node scripts/check-migrations.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7 --json` | PASS: owned/append-only migration diagnostics; none changed |
| `node scripts/verify-toolchain.mjs --json --config-only` | PASS: 39 configuration checks; runtime checks explicitly omitted |
| `node scripts/verify-toolchain.mjs --json` | FAIL: 2 actual runtime-version mismatches out of 40 checks; no pin/guard changed |

Final staged/committed owner-scope, whitespace and exact-tree commands/results are
bound in the PR publication checkpoint. Existing ownership tests model historical
W01 policy; passing lease tests does not restore permission. The CLI's protected-
base-blob label cannot establish branch protection: main was observed unprotected.
Read-only packet review does not supply independent GitHub approval.

Discovered commands, **NOT_RUN for W05 product acceptance**:

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

Communications/Reporting have no package test:runtime. Root build/typecheck omits
frontends; E must retain explicit affected app commands and every mandatory CI
job. Existing foundation DB/broker and F010 tests cannot close financial/private-
proof/cancellation/rescheduling/platform product cases.

## Real environment, blocked cases and next action

Real work: immutable local source/Git and GitHub inspection, offline diagnostics.
Product fixtures/mocks presented as acceptance: **none**. Prototype data stays
illustrative. Install/build/HTTP/DB migration/broker/provider/sandbox/test funds/
Linux visual/browser/Windows/device/staging execution: **NOT_STARTED**.
W05 isolated environment/heavy slot not allocated or reserved. Owned runtime PIDs,
containers, ports, database roles/queues/object prefixes, browser profiles and
resource/lease handles: **none**. No runtime cleanup remains.

All permissions/tampering/private proof/reviewer races, provider verification/
duplicate callbacks/partial refunds/unknown settlement, cancel AND reschedule/
alternative-slot/late-payment/partial compensation/customer-operator convergence,
financial-event/history/hash/freshness/export audit and platform cases are unrun.

Next action: E closes predecessor contract/provider/barrier reviews and publishes
actual BASE_W05 with accepted versions, current permission/route/client policy,
resources and mandatory gates. B/C/A/E provide real narrow authority/binding APIs
and approved provider/policy/design evidence; D consumes only then. Agree provider-
first children before coding: B payment binding → C Media → B verification/refund/
settlement and C durable cancel/reschedule → D events/admin → integrated apps.
Keep the parent INTEGRATION_PENDING until every required combined-source case passes.

W06 Support/refund linkage, verified Reviews, template/consent/conversation and
Wallet/Subscription admin requests remain proposals only. Stop at this bounded
reviewed W05 handoff; no automatic next wave, approval, merge, deployment or live
payment/refund execution is authorized.
