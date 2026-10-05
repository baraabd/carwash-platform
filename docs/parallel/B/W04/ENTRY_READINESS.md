# W04-B — Cash entry and acceptance proof

Source: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`, tree
`9f04d674056041bbc810a62e4cc7f275c32581b8`. Status: **ENTRY_BLOCKED**.
The seven dependencies are shared with the declarative acceptance specification.

| ID       | Current source fact                                                                                                                                              | Required producer / concrete proof                                                                                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENTRY-01 | BASE_W04 unpublished; BASE_W02 null; W03 merged documents do not implement durable obligations.                                                                  | E/B: actual immutable full BASE_W04 SHA, real accepted W03 obligation/quote behavior, reconciled ownership/release record, independent barrier review and resulting-target mandatory checks.                                                                                                                              |
| ENTRY-02 | No accepted Billing/Wallet cash command/read/event/client exports or frozen A/C/D authority/receipt interfaces.                                                  | E/B/A/C/D: closed schemas, exact versions/parsers/routes/method/subject/money/revision profile, assignment fence/commit semantics, business identity/replay/status and safe receipt/download plus reconciliation interfaces.                                                                                              |
| ENTRY-03 | W01 collection/currency/accounting/custody/hold/cancellation/privacy decisions remain open; prototype timing/full amount is not policy.                          | Product/accounting + B/C/D: approved timing, full/partial/overpay/remaining-due rules, discrepancy workflow, holder/recipient and hold purpose, current authority/approval separation, posting/reversal/settlement triggers and retention/replay/time decisions.                                                          |
| ENTRY-04 | Implemented member Identity does not supply accepted collector/treasury/custody/customer-guest grants; C has no live assignment/completion authority.            | E/C/A/D/B: actual current actor/service/object/market grants, fenced assignment/work facts, beneficiary receipt capability, independent treasury acceptance and replay/read revocation tests.                                                                                                                             |
| ENTRY-05 | Billing/Wallet lack public contracts/clients/security/messaging dependencies; Gateway has no cash/receipt/Wallet transport; broker bootstrap only serves probes. | E: reviewed manifests/lockfile/exports/CSRF/routes/errors, activated durable required subscribers/ACLs, adopted recovery stores and real executable provider/app gates. Ledger restrictions must survive provisioning replay.                                                                                             |
| ENTRY-06 | Canonical Billing/Wallet DB roles and allocator exist; no provisioned isolated W04 run is evidenced; Docker absent locally.                                      | E: usable merged providers, actual separate owned databases/roles/migration jobs, broker namespaces, ports/output/browser profiles and scoped cleanup evidence. Names alone do not provision resources.                                                                                                                   |
| ENTRY-07 | Completion → collection → real receipt download → custody → settlement across all three apps is absent.                                                          | A/C/D/E/B: downstream serialized latest-target candidate, real provider/consumer browser/HTTP/DB/broker/fault tests, explicit discrepancy owner/workflow, source-derived deployed inventory, unchanged refs and independent resulting-target acceptance. Not a cyclic prerequisite for the narrow provider's first write. |

## Immutable entry evidence

- `architecture/parallel-contract-release.json:20–23,87–94`: next base null,
  accepted list empty, no reviewed source/package release; BASE_W04 absent.
- `docs/parallel/E/W03/ENTRY_AUDIT.json`: expected BASE_W03 unpublished,
  W02/W03 runtime unaccepted, BASE_W04Published false. Its intake/checks are dated
  snapshots; current W03 proposal files are now merged into the observed main.
- Billing and Wallet `prisma/schema.prisma:20–28`: ServiceMarker only;
  Billing/Wallet `src/app.module.ts:12–15`: business readiness false.
- `packages/contracts/src/registry.ts:15–31`: Identity/Gateway only;
  `packages/api-clients/src/index.ts:1–2`: empty exports.
- `packages/contracts/src/identity.ts:13–28`: member permission vocabulary;
  `services/identity/src/application/identity-auth.service.ts:380–400`: real current
  account/session/authVersion checks, not a guest or new finance grant.
- Booking/Dispatch/Workforce schemas: marker-only. Work/assignment code or a role
  name cannot be used as an invented live eligibility contract.
- `infra/postgres/provision.sh:98–106`: replayed blanket runtime DML grants;
  marker isolation tests do not prove immutable journals.
- Customer session provider: explicit local demo, no network/storage/payment.
  Operator/admin source: technical boot; approved prototype controls do not prove
  authoritative collection, receipt, deposit or treasury settlement.

[ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json) fingerprints actual committed source
and derives model/migration inventories. The changed-path comparison since the
prior audit source shows W03 documentation/specification delivery only.

## Policy closure required

Freeze collection timing against explicit C Work facts. Customer prototype cash
simulation at stage4 and technician handoff/closed controls are visual evidence;
they neither approve business phase names nor resolve delayed offline collection
after reassignment. Decide accepted fence/current-authority validity at Billing
commit and unknown-outcome recovery. A preflight alone cannot remove that race.

Freeze full/partial/overpayment and the unique collection business identity together.
The task's baseline one order/one original receipt must resist different retry keys
and two collectors. If approved partial installments require a different business
identity/cardinality, publish that explicit compatible policy/contract change;
do not silently prohibit approved scope or invent repeated collection attempts.
No arbitrary amount tolerance, default currency or prototype price is accepted.

Resolve custody holder/recipient, hold purpose, amount allocations, handover/deposit
versus independent acceptance, disagreement/shortage/overage/remediation and
append-only adjustment grants. Reassignment fences future collection but does not
transfer already collected cash to a new technician/team. Wallet is not customer
stored value, payroll, a second ledger or a fourth checkout method.

Choose exact approved accounting/posting and cancellation/refund-compensation
policies. Collected cash and original receipt remain historical facts when Booking
is canceled. A pending refund/correction is not a return to unpaid or proof of
completed refund. Approved privacy/retention governs receipt fields and guest
access; do not invent legal document/tax identifiers or retention periods.

## Required child acceptance boundary

The owner/contract/barrier must show exact immutable source, policy/contract/package
revisions, real environment and executable passing artifacts. Close applicable
pre-write dependencies for each provider child, then the real app/integration
gate. New production states require a precise approved A/C/D design record; keep
references unchanged. Missing evidence is blocked/unexecuted, never passing skip.
