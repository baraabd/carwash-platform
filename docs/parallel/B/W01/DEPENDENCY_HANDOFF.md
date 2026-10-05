# W01-B handoff and resumable checkpoint

Task/phase: W01-B, `PROPOSAL_READY / ACCEPTANCE_BLOCKED`.
Parent: `NOT_STARTED`. Target: `main`.
Observed target/base-for-analysis: `69d81a83a3409d0693272efeb19ebeb9805750f5`.
Observed source tree: `1988caa3f882bc0c6007ae830950b7f34f53d294`.
Accepted `BASE_W01`: **not published/found; do not substitute audit SHA**.
Proposal branch: `proposal/w01-B-finance-acceptance`.
Delivered head/tree/PR checks are recorded by the PR/Git commit metadata; this
file cannot self-reference its own future commit. Verify the immutable PR head
and exact changed tree before use, then re-evaluate against E's accepted base.

## Requests to E

Accept/reject the W02 packet and schemas explicitly; publish actual package
versions, owner registry, base/barrier and bootstrap lease with expiry at verified
BASE_W02. Allocate isolated project/ports/DB-role/queue/object/output/browser
namespaces and the heavy-test slot before any dependent tests/source work.

E-owned changes requested, not made by B:

- Guest/public/authenticated route modes, verified guest owner capability and
  revocation/claim semantics; no fake account or SMS claim.
- Catalog/Pricing publisher and later financial grants, independently enforced
  by domain owners; explicit service identity/actor delegation.
- Pricing/Wallet/Subscription Gateway owner vocabulary/origins, allowed route/ID/
  query/error contracts, versioned clients/OpenAPI/AsyncAPI/package exports.
- Accepted configuration/policy read contract without cross-DB dependencies.
- Source-derived metadata correcting old Catalog/Billing grouping and historical
  verification claims. Proposed ownership matches F001, not a new ownership change.
- Supported runtime dependencies, manifests/Docker/tsconfig/generation outputs,
  migration/bootstrap isolation for skeleton services; no B manifest edit.
- Actual mandatory/affected gate manifest and explicit customer/operator/admin
  commands; keep all mandatory CI and serialized latest-target verification.

This packet is the technical handoff to E/A/C/D. No external recipient message
was sent, no independent approval is claimed, and no approval request or branch
rule was weakened. Review helpers under the same author are not independent
GitHub approval. No merge/deployment/real-money execution is authorized here.

## Financial display and authorization requirements

| Lane | Required consumer behavior                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Preserve seven steps/guest/optional plate. Render server quote/policy revisions, expiry and exact amounts; display issued quote separately from booked/paid. Keep draft on errors; recover mutation with same key. New rebooking requotes current data. Production payment/tracking is separate from C014 session demo |
| C    | Work completion, assigned collector's cash receipt, custody transfer and verified electronic payment remain separate facts. No technician electronic-payment approval. Booking saga handles capacity expiry/late payment and durable compensation; Workforce/Dispatch validates current eligibility                    |
| D    | Admin Catalog/Pricing writes go to owning services; finance/support roles cannot bypass grants. Reporting projections show revision/as-of and cannot authorize money. Refund/custody decisions have live owner checks/audit. B privacy fulfillment requirements are separate from intake                               |

All lanes preserve locked Arabic/RTL visuals, focus, motion/reduced motion and
approved states. Missing English/production financial designs require an exact
owner decision; no reference regeneration or unapproved fourth method.

## Future-wave financial dependency calendar

This is a dependency order, not a duration guarantee or authorization to start
the next wave. E defines child scopes/gates and accepted common base each time.

| Wave | B provider/contract packet                                                                        | Prerequisites and later consumers                                                                                                      | Parent completion evidence                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| W02  | Catalog definitions/revisions; Pricing immutable quotes                                           | E guest/Gateway/config prerequisites → Catalog → Pricing → A/C/D consumers                                                             | Real owned DB/HTTP/auth/contracts; full affected quote journey                                                   |
| W03  | Billing obligation/create/read; immutable posting foundations and verified quote binding          | Billing/Scheduling provider children → Booking durable coordinator → app consumers                                                     | Capacity/quote/obligation saga and failure recovery, not fixtures                                                |
| W04  | Billing cash receipt/reversal; Wallet custody/transfer/reconcile with posting refs                | C actual eligible assignment/work; cash producer → custody producer → customer/operator/admin finance consumers                        | Assigned collector auth, independent treasury acceptance, shortage/replay/crash recovery                         |
| W05  | Provider intent/proof/verify/status; refund reserve/verify/reconcile                              | Approved B-02/B-11 and policies; Media private-object auth; real provider documentation/environment                                    | Genuine sandbox or explicitly approved independent evidence, concurrent refunds and late settlement/compensation |
| W06  | Required Wallet holders/holds and Subscription plan/entitlement reserve/consume/release           | Approved actor/product/funding/lifecycle policies; Billing provider → Wallet/Subscription providers → Booking compensation → consumers | Last entitlement/hold concurrency; durable release/consume; no implicit stored-value/payroll/recurring debit     |
| W07  | Remaining finance inventory: promotion limits/admin policy operations/privacy fulfillment/reports | Pricing/admin provider children → Booking/app consumers; D projection/intake and E policy contracts                                    | Redemption limits, audit, retention/export decisions and all required production financial states                |

Future commands/events must specify owner-derived actor, immutable revisions,
canonical money/time, allowed transitions, idempotency tuple/fingerprint/replay,
errors/deadlines, compensation, provider/consumer schemas and actual tests.
Billing candidate families: obligation create/read, cash record/reverse,
provider proof/verified receipt, refund reserve/status/confirm and posting refs.
Wallet families: custody record/handover/accept/reconcile and only approved
balance hold/release. Subscription families: plan/entitlement reserve/consume/
release. No family is accepted or implemented by this inventory.

## Evidence and environment

Local environment: Linux; initial default Node `v24.19.0`, pnpm `11.25.0`.
Repository pins: Node `24.21.0`, pnpm `10.32.1`. Initial checks were diagnostic.
After preparation, isolated npm-exec tools provided verified Node `v24.21.0`,
pnpm `10.32.1` and Prettier `3.9.8` for the final scope/reference checks below.
No workspace dependency install/lockfile update, service build, DB, Docker,
queue, provider account, browser/profile or shared integration/staging resource
was used. Temporary QA tools were isolated outside tracked repository files.

Before edits, actually run from the clean isolated proposal worktree:

| Command                                            | Result and precise scope                                    |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `node --version` / `pnpm --version`                | Available versions above; pin mismatch recorded             |
| `git status --short` / `git worktree list`         | Clean proposal worktree; separate newly cloned object store |
| `node scripts/check-design-reference.mjs`          | Exit 0, 10 artifacts; preservation only                     |
| `node --test tests/design/reference-lock.test.mjs` | Exit 0, 12/12 existing guard tests; no finance behavior     |
| `git diff --check`                                 | Exit 0                                                      |

Remote observed target check-runs were queried at the exact observed source;
44 returned checks were completed/success. This proves only those reported
foundation/UI gates on that SHA, not this proposal head or implemented finance.
Example evidence: [foundation](https://github.com/baraabd/carwash-platform/actions/runs/37252929542),
[C014](https://github.com/baraabd/carwash-platform/actions/runs/37252929464),
[Sprint 0.2](https://github.com/baraabd/carwash-platform/actions/runs/37252929487).
No cancelled/skipped run was promoted to a pass.

After-edit checks actually run successfully:

| Command                                                                                                                    | Result and precise scope                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-design-reference.mjs --base-ref 69d81a83a3409d0693272efeb19ebeb9805750f5`                              | Exit 0, 10 artifacts and protected baseline/policy preserved                                                                                                                          |
| `node scripts/f010/reference-registry.mjs --base-ref 69d81a83a3409d0693272efeb19ebeb9805750f5`                             | Exit 0, all 3 customer/technician/admin references preserved                                                                                                                          |
| `node --test tests/design/reference-lock.test.mjs`                                                                         | Exit 0, 12/12 existing guard tests under pinned Node; no finance tests                                                                                                                |
| `prettier --ignore-path /dev/null --check docs/parallel/B/W01/*.md docs/parallel/B/W01/*.json tests/parallel/B/W01/*.json` | Exit 0 with 3.9.8; explicit allowlisted files (global ignore otherwise omits these docs)                                                                                              |
| `PYTHONPATH=/workspace/scratch/0cf8bb000a7a/finance-qa-deps python3 /workspace/scratch/0cf8bb000a7a/finance-packet-qa.py`  | Exit 0; jsonschema 4.25.1: 2 candidate schemas, 64 definitions/references, 31 positive/negative structural fixtures, 26 declarative-case records and 10 local links; 12 allowed files |
| `git diff --check`                                                                                                         | Exit 0; changed paths limited to lane packet/specifications                                                                                                                           |

Schema QA explicitly enabled calendar/date-time assertions. Its first diagnostic
run found that the optional default Python date-time checker was unavailable;
the isolated QA runner enabled actual calendar validation and then passed the
invalid-date rejection fixture. No repository assertion or schema was weakened.
This is a proposal validation issue, not a payment/runtime regression.

Exact delivered refs/results are included in the PR body and final handoff.
The declarative scenarios have `NOT_RUN_SPECIFICATION_ONLY` status, including
all task-listed money/refund/custody tests. Local schema validation means only
that candidate schemas/specifications are coherent; no payment evidence.

Owned runtime process handles: **none**. No shared cleanup/reset occurred.
Migration IDs added: **none**. Accepted new contract versions: **none**.
Changed scope: this lane folder plus `tests/parallel/B/W01` specifications only.

## Resume / next action

1. Read the packet/PR at its immutable head and refresh main/open-PR/registry refs.
2. Obtain E's base/lease/contract/resource publication and recorded decisions B-01
   through B-15. Keep unresolved items named; do not mark W01-B DONE.
3. Reconcile/review the proposal through the authorized serialized target gate.
   Required independent approval and actual resulting-target checks remain E's
   merge prerequisites; no auto-merge.
4. Stop after this W01-B handoff. Start dependent implementation only after E's
   accepted next base and an explicit next task prompt.
