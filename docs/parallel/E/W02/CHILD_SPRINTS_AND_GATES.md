# W02-E — Dependency-bound children and gate proposal

Status: **PROPOSED**. Runtime entry: **BLOCKED**; parent implementation **NOT_STARTED**. Child names define review boundaries, not accepted future work or permission to write before a common base.

## Resolve the actual predecessor barrier

PR #45 supplies the merged W01 technical bootstrap. Its merge does not complete the existing W01-E-CONTRACTS or W01-E-BARRIER children. Current registries retain BASE_W02 null, unaccepted owner packets and pending independent policy review. They still carry the old conditional lease records. The current W02 instruction expires E's bootstrap permission now: permanent A–D writers control their product source, and registry publication must be reconciled without restoring E bootstrap writes.

First receive A's packet; reconcile B/C/D/E proposals and exact actor/guest, IDs/revisions, money/time, errors/deadlines and replay/recovery semantics with affected providers/consumers. Obtain independent policy review and eligible code-owner/check-producer enforcement. Serialize candidates and verify every required gate on the actual resulting target before publishing full BASE_W02, exact versions and the reconciled permanent-writer registry. Main's technical checks alone cannot supply these missing semantic/administrative approvals.

## Proposed implementation queue after accepted entry

| Child                                       | Bounded scope and prerequisite                                                                                                                                    | Provider exit / acceptance boundary                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W02-E-CONTRACT-PREWORK, if still needed     | Missing compiled exports, wire parsers, exact owner/route vocabulary and compatibility; actual owner-authored schemas plus guest/governance decisions             | Reviewed additive contracts/clients with provider/consumer conformance and a new common base before affected writes; no runtime fallback                                                                                                                                                        |
| W02-E-IDENTITY-GUEST                        | Accepted base/contract, allocated stack, recovery/copy/channel and privileged-actor decisions; Identity-owned credentials/security and approved audited bootstrap | Real Identity PostgreSQL/Redis/HTTP migration, credential/principal/scope isolation, expiry/revocation/replay, CSRF/origin, abuse and privilege denial; direct adapter failure tests; domain-object authority waits for real owner-provider gates; operational provider connectivity separately |
| W02-E-GATEWAY-ROUTES                        | Accepted Identity provider and published owner route schemas; exact transport/permission/spoof policy, errors/budgets and key propagation                         | Real Identity with explicit owner stubs proves Gateway transport only; each enabled real owner route needs its actual provider integration before full flow acceptance                                                                                                                          |
| W02-E-APP-BOOT                              | Accepted common source and actual three-app bundles; E-owned allocated browser orchestration/gate wiring                                                          | All three build/typecheck and executed browser DOM/error/cleanup checks; existing customer parity retained; technical boot does not close product journeys                                                                                                                                      |
| W02-A/B/C/D-PROVIDER, named by each owner   | Their own source/data/migrations and accepted contracts; no cross-owner implementation imports                                                                    | Real own DB/HTTP/constraints and provider/client conformance; no future app dependency required for narrow provider acceptance                                                                                                                                                                  |
| W02-A/C/D-APP-CONSUMER, named by each owner | Required real providers already merged; approved customer/operator/admin behavior                                                                                 | Complete affected real HTTP/persistence/error/authorization journey and canonical UI/accessibility evidence before consumer merge                                                                                                                                                               |
| W02-E-BARRIER                               | Every task-listed owner/app case available, reviewed W03 packets and independent enforcement                                                                      | Combined CRUD/quote/media/eligibility/config smoke, all mandatory/affected gates, authorized serialized reviews/merges, actual resulting-target checks; only then BASE_W03                                                                                                                      |

Same-lane children sharing Identity/Gateway/shared files execute sequentially. No child starts from a moving or unmerged peer branch. Every implementation branch starts at an accepted immutable base; later accepted producer checkpoints/new common bases are explicit. Breaking mid-wave dependencies pause affected writes until a reviewed contract change and new common base.

Owner sequencing is explicit: B Catalog → Pricing; C Workforce binding → Media → Workforce document review/eligibility; every enabled Media purpose needs its actual authority producer. D Identity-governance prerequisites and Configuration validation need accepted real inputs/providers. A Customer/Vehicle/Geo ownership remains with A. These owner dependencies cannot be replaced by E's fixture or a read into another service's database.

## Commands and execution discipline

Use actual Node 24.21.0 / pnpm 10.32.1. Existing entries include:

```bash
pnpm install --frozen-lockfile
pnpm acceptance:identity
pnpm acceptance:gateway
pnpm test:gateway
pnpm test:contracts
pnpm check:gateway-contract
node scripts/ci/run.mjs static
node scripts/ci/run.mjs targeted
node scripts/ci/run.mjs integration
node scripts/ci/run.mjs security
node scripts/ci/run.mjs codeql
node scripts/ci/image.mjs <catalog-target-id>
```

These are existing entrypoints, not executions or new passing results. Preserve all seven F009 mandatory concepts, all catalog image artifacts, the explicit six frontend build/typecheck commands and inherited foundation/browser/reference/recovery/stability jobs. Impact testing supplements required gates. Future guest/app/full-smoke commands do not exist yet and must be implemented and demonstrated by their accepted child, rather than recorded as successful here.

Use `scripts/parallel/E/allocate-environment.mjs` with lane E, wave W02 and an owned run, shared workstation state root and token. Allocate Compose/ports/DB roles/queue/object/browser/artifact namespaces. One local heavy acceptance slot starts as the default. The integration command's two-stack subgate acquires its own heavy lease: do not wrap the whole CI integration command in an outer heavy lease. Record owned handles; perform scoped cleanup before verdict, retain failure evidence and never claim acceptance with missing cleanup.

At each PR: construct latest target + head; bind evidence to exact source/tree and real environment; require independent review; recheck unchanged refs; merge only through the authorized process; verify actual resulting-target checks. A previous head or an identical-tree observation does not replace that resulting-commit policy proof. Path-filtered workflows can leave required contexts missing; approved always-running protected producers and code-owner policy remain administrative prerequisites recorded in W01.

## W03 packet requests submitted for review

These are request categories, not exported wire schemas, selected business values or W03 implementation authorization.

| Packet producer                                               | Required next-wave packet                                                                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C Booking coordinator                                         | Authoritative booking actor/resource linkage; immutable quote/service/location snapshots; state/revision transitions; idempotent command outcomes; timeout uncertainty; durable compensation and reconciliation |
| C Scheduling                                                  | Real capacity authority; hold identity/quantity/revision/expiry; reservation/consume/release transitions; concurrent last-capacity constraints; idempotent recovery and late-payment behavior                   |
| B Billing obligation, with Pricing                            | Exact amount/currency/precision and immutable quote references; obligation/confirmation/refund separation; authorized server verification/audit; replay/lifetime/unknown outcome and compensation               |
| C Media/Workforce document review, with D governance consumer | Private object purpose/binding/access/scan/quarantine; case revision and review decisions; who may review; grant/revocation/eligibility transitions and current-revision checks                                 |
| E and all affected consumers                                  | Compatible auth/guest examples, exact routes/parsers/errors/budgets, public compiled exports, sanitized test identities, provider/consumer cases and required configuration                                     |

Each packet includes owner/consumer, contract ID/version, request/response/event schemas and unknown/null handling, actor/guest scope, IDs/revisions, UTC/local expiry, exact money/time, allowed transitions, command-key scope/fingerprint/conflict/replay retention, errors/deadlines, recovery/compensation, backward compatibility, real versus fixture tests, dependencies/config and external decision owner. Collect unresolved product/provider inputs explicitly. The eventual W02 barrier may publish additive W03 packages only after review and combined-source acceptance.

## Stop and resume

This documentation child stops at its reviewed prerequisite handoff. W02 runtime remains blocked until the predecessor/base and product/access decisions are satisfied. W02 parent remains NOT_STARTED now and INTEGRATION_PENDING once implementation begins until all listed real owner/app cases pass. No BASE_W03, production deployment, live delivery/money or automatic next-wave work follows from this proposal.
