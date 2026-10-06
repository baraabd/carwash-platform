# W05-A resumable English checkpoint

Task/phase: **W05-A / ENTRY_PROPOSAL**. Product implementation **BLOCKED**;
parent **NOT ACCEPTED**. Observed target/proposal parent:
`3ce756cd39a9b0c1013043cee0ca1bb183466da7`; target tree:
`cc3517ec85525c7310fe340397506ef6be3fe0a9`. `BASE_W05` is absent.
Branch/worktree: `proposal/w05-A-payment-entry`,
`/workspace/scratch/6a9547568741/carwash-w05-source`.
The live draft PR binds final full head/tree, exact remote path verification and
dated hosted CI. Including a document's own resulting commit SHA changes that SHA;
the PR is the final immutable-source handoff. Accepted candidate: **none**.

## Scope and contracts

Six new files only: `docs/parallel/A/W05/{README.md,PAYMENT_RECOVERY_AND_ACTIONS.md,
W06_CONTRACT_REQUESTS.md,CHECKPOINT.md,source-observation.json}` and
`tests/parallel/A/W05/ACCEPTANCE_SPECIFICATIONS.md`. No product source, shared
package/configuration, registry, approved reference, workflow or migration edits.
Migration IDs: **none**.

Current packages: `@carwash/contracts@0.0.2` (Identity v1 foundation/Gateway v1
routing), `@carwash/event-contracts@0.0.2` (foundation probe/strict contract-only
`booking.confirmed.v1`), `@carwash/api-clients@0.0.1` (empty). W05 intent/proof/
verification/refund/change and W06 contracts remain unpublished/unaccepted.
Candidate packet schemas below are documentation, not public exports or clients.

## Commands actually run

- `git status --short`, `git worktree list --porcelain`, remote refs/PR refresh,
  `git clone https://github.com/baraabd/carwash-platform.git /workspace/scratch/6a9547568741/carwash-platform`,
  `git worktree add -b proposal/w05-A-payment-entry /workspace/scratch/6a9547568741/carwash-w05-source 3ce756cd39a9b0c1013043cee0ca1bb183466da7`:
  isolated observed-source proposal; no reset/stash/force-push/peer-source overwrite.
- `node scripts/check-design-reference.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7`:
  PASS before and after proposal edits, 10 artifacts/base comparison. This
  protects bytes; it does not prove React pixel parity.
- `node scripts/f010/reference-registry.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7`:
  PASS three registered reference hashes/base comparison; no registration/parity claim.
- `node architecture/implementation-status.mjs --self-test`: PASS inventory + nine
  adversarial cases; `productionReady:false`, current candidate unverified.
- `node scripts/verify-toolchain.mjs`: FAIL 38/40, actual Node `24.19.0` /
  pnpm `11.25.0`, pins `24.21.0` / `10.32.1`. Primary runtime Node also `24.19.0`.
  `node scripts/verify-toolchain.mjs --config-only`: PASS 39/39, runtime skipped.
  No shared pins/configuration changed; no pinned gate is claimed locally complete.
- `node scripts/parallel/E/check-owners.mjs --inventory`: PASS
  `proposal-inventory-only`, historical inventory source/count; no live base acceptance.
- Existing C001–C014 unit command is fully enumerated in source-observation:
  **304/304 PASS**, zero failures/cancellations/skips/todos. Fixture/session
  diagnostics at observed source; product files identical at proposal head.
  Alternate-runtime results do not close real W05 acceptance.
- `npm pack prettier@3.9.8 --ignore-scripts --json --pack-destination /workspace/scratch/6a9547568741/w05-tools`:
  standalone formatter archive outside repository, no dependency/lock edits.
  Archive SHA-256 `c33e1990a784e5a4cbc357b0755dac69868eb80a4893940db483cbab4e8aa44f`;
  package version/npm-reported SHA-1 verified before safe extraction.
- `node scripts/parallel/E/check-owners.mjs --base-ref 3ce756cd39a9b0c1013043cee0ca1bb183466da7 --worktree --lane A`:
  PASS six permanent-A proposal/specification paths, zero findings. Final-head
  command and result are bound in the draft PR; this is not independent approval.
- Standalone Prettier `--write` then `--check --ignore-path /dev/null`:
  PASS only the six files listed above. Full exact invocation is recorded in
  source-observation; no whole-repository write formatting.
- `git diff --cached --check`: PASS. JSON parsing plus a one-off document inventory
  verifies 38 unique W05-A-001–038 and seven W06-PC-01–07 families, all UNEXECUTED.
  This inventory is not an executable business test.

Public provider inspection was GET-only at the README URLs. Paymera advertising
and Syriatel service descriptions were retrieved; ShamCash retrieval timed out.
No actual provider protocol, merchant access, test facility or scope decision was
accepted, and no account/credential/payment/refund operation occurred.
Temporary unit TAP: `/workspace/scratch/6a9547568741/w05-existing-customer-unit.tap`;
durable command/result inventory: [source-observation.json](source-observation.json).
Current-source security/check observations are dated; a historical failure is not
inherited as a current target defect, and a successful security job alone is not W05.
The supported GitHub run-jobs query observed target F009 run `37352669544`, security
job `111907287552`, completed/success. Full release/candidate checks and independent
review remain separate requirements.

## Unexecuted/blocked cases and resources

All 38 new W05 case families and seven W06 proposed gate families are
**UNEXECUTED**. No real cash/electronic booking/QR/proof/
Media storage/scan/verification/cancellation/late-settlement/refund/reschedule,
provider-facility transaction, last-slot race, business-data migration, broker
crash/replay, three-app browser/reload, canonical pixels/accessibility or device/
Windows acceptance ran. No app build/typecheck, staging/live money/deployment ran.
Zero W05 business-production acceptance passes. No future W06 case executed.

Owned long-running PIDs, listening ports, Compose projects, test DB/role/vhost/queue/
object prefixes and browser profiles: **none**. Diagnostics completed; no shared
integration/staging resources started/stopped. Standalone formatter is not a server.

## External dependencies and next action

E/owners complete predecessor real providers/barriers and publish reviewed immutable
BASE_W05/versions/clients, guest/public ingress/CSRF/grants and isolated run manifest.
B/product resolve Paymera requirement separately from method design, merchant/test
facility/protocol/verification/refund inputs; B/C/D approve eligibility, finance,
retention/replay/recovery and exact production copy. Accept narrow providers first,
then A/C/D consumers and every task-listed real case on E's serialized candidate.
Any target/head change requires a new candidate and applicable rerun; eligible
independent review and actual resulting-target checks precede wave promotion.
Stop at this W05 draft proposal handoff. Eligible independent review and E's
serialized candidate are pending; no merge/deployment or W06 implementation.
