# W01-B — Finance ownership and acceptance proposal

Task: W01-B. Lane: B. Phase: `PROPOSAL_READY / ACCEPTANCE_BLOCKED`.
Parent: `NOT_STARTED`; neither `DONE` nor `WAVE_ACCEPTED`.
Prepared: 2026-10-05. Target branch: `main`.

## Provenance and boundary

The attached W01-B prompt authorizes Lane B design/domain packets and declarative
test specifications only during W01. This packet changes no application, service,
schema, migration, package, approved reference, architecture aggregate or CI file.

Observed source/target: `69d81a83a3409d0693272efeb19ebeb9805750f5`.
Observed source tree: `1988caa3f882bc0c6007ae830950b7f34f53d294`.
**This is an audit SHA, not an accepted `BASE_W01`.** No E-published base, owner
registry, bootstrap lease, resource allocation or wave-contract acceptance was
found in its complete tree, current branch list, open PRs or BASE_W01 issue search.
E may hold unpublished work; absence in these surfaces is not proof about another
session's workstation. Do not begin dependent source writes until E publishes it.

Branch `proposal/w01-B-finance-acceptance` is a bounded proposal branch from that
observed source, not a claim to have started an implementation sprint on an
approved wave base. E must evaluate/reconcile this packet against the published
base before acceptance. No base or contract version is invented here.

[C014 PR #41](https://github.com/baraabd/carwash-platform/pull/41) is merged at the
observed source. Its orders remain explicit, in-memory session demos; no real
Booking, payment, receipt, capacity or durability is established. No duplicate
C014 branch/PR or customer source change is included.

## Packet

| File                                                                                                                           | Purpose                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md)                                                                                     | Actual source, ownership drift, auth/contracts and readiness            |
| [OWNERSHIP_AND_STATES.md](OWNERSHIP_AND_STATES.md)                                                                             | Owner boundaries, independent facts and proposed transitions            |
| [POLICY_DECISIONS.md](POLICY_DECISIONS.md)                                                                                     | Concrete business/privacy inputs and acceptance blockers                |
| [PROVIDER_ACCEPTANCE.md](PROVIDER_ACCEPTANCE.md)                                                                               | Primary documentation, evidence limits and provider acceptance dossiers |
| [W02_CONTRACT_PACKET.md](W02_CONTRACT_PACKET.md)                                                                               | Versioned proposals, authorization, recovery and child sequencing       |
| [w02-contracts.schema.json](w02-contracts.schema.json)                                                                         | Declarative candidate schemas; not published production contracts       |
| [FUTURE_FINANCE_CONTRACTS.md](FUTURE_FINANCE_CONTRACTS.md)                                                                     | W03–W07 versioned command/event reservations                            |
| [future-finance-contracts.schema.json](future-finance-contracts.schema.json)                                                   | Candidate future schemas referencing W02 types                          |
| [DEPENDENCY_HANDOFF.md](DEPENDENCY_HANDOFF.md)                                                                                 | E/A/C/D handoff, future waves and resumable checkpoint                  |
| [../../../../tests/parallel/B/W01/finance-acceptance.spec.json](../../../../tests/parallel/B/W01/finance-acceptance.spec.json) | Declarative scenarios; none executed as finance evidence                |

## Acceptance required

The F009 scanner-prose repair and its history boundary are documented in
[WORKFLOW_REPAIR.md](WORKFLOW_REPAIR.md). Final corrected-head CI is recorded in
the PR. This correction does not close the following business/wave decisions.

1. E records the real common base, owner/lease registry, accepted schemas and
   runtime/test allocation, and accepts the W02 packet after owner review.
2. Business/accounting owners supply the decisions in `POLICY_DECISIONS.md`.
3. Paymera is explicitly required with its approved relationship to the frozen
   methods, or explicitly deferred/excluded. An unanswered decision is open.
4. Required provider access/documentation and exact Wallet/custody/Subscription
   scope remain named launch blockers until resolved; no silent scope reduction.

Local document/schema/reference checks verify this proposal's integrity only.
No finance runtime, database upgrade, broker recovery, provider sandbox, browser
journey, independent approval, staging, production or real-money acceptance is
claimed. No auto-merge or deployment is requested.
