# W03-E entry proposal

Task: **W03-E — Integrate durable booking, capacity and finance primitives**.
Runtime phase: **ENTRY_BLOCKED**. Parent implementation: **NOT_STARTED**.
This child is **W03-E-ENTRY-PROPOSAL**, documentation for review only.

## Current entry truth

Observed main is `82e7402ed9ab6cc4f565f423441cd0655f2d627a`, tree
`050b4b8a03be2bc671cbaa00151ea7105891e2d4`. It contains externally merged
A–D W02 proposals (#46–49) and E's W02 proposal (#50). The 31 changed paths
since the W01-bootstrap target are documentation/declarative test specifications;
they do not implement W02 providers or accept their semantics.

`architecture/parallel-contract-release.json` still has BASE_W02=null,
no BASE_W03 field, an empty accepted-next-wave list, no reviewed release source,
and no published next-wave package versions. Registry status is W01
INTEGRATION_PENDING. Receiving and merging A's packet resolves its delivery gap;
its source registry's older “requested-not-received” entry is stale publication,
not current intake truth.

The current user instruction expires E bootstrap permission immediately.
Permanent A–D source ownership applies even while the old registry retains
conditional W01 leases. No old lease is used to authorize this proposal.
An observed main SHA is an audit target, not an invented BASE_W03.

## Entry dependencies

| Required producer/input                                                | Current source fact                                                                         | Acceptance owner                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Accepted BASE_W03 and W03 quote/hold/booking/obligation/review release | Unpublished; clients still empty                                                            | E with affected providers/consumers and independent review |
| Verified guest/member object scope and production recovery             | Existing member Identity security; guest contract/runtime absent                            | E, A and product/security owner                            |
| Real quote and ownership/coverage/policy providers                     | B/A/D packets exist; product APIs absent                                                    | B/A/D                                                      |
| Capacity, durable Booking and cash-due providers                       | Foundation markers only; no durable product state                                           | C/B                                                        |
| Private technician document review                                     | Workforce/Media markers only; admin production review states missing                        | C/D, E access contract and product/design owner            |
| Isolated combined stack, accepted migration baseline                   | Foundation allocation/provisioning exists; no W02 business baseline or integrated W03 stack | E plus each schema owner                                   |
| Independent review and protected enforcement                           | No PR50 review submission; main unprotected, rulesets empty                                 | Eligible reviewer/repository administrator                 |

## Reviewable output

- [Entry audit](ENTRY_AUDIT.json): dated immutable source, intake and blocked entry.
- [Commands, events and recovery](COMMAND_EVENTS_AND_RECOVERY.md): authority,
  crash windows, unknown outcomes and provider/consumer dependency sequence.
- [Topology and W04 requests](TOPOLOGY_AND_W04_REQUESTS.md): existing guarantees,
  durable subscriber activation and next-wave packet requirements.
- [Acceptance plan](ACCEPTANCE_PLAN.md): all W03 cases, observables and actual
  existing commands, with real-versus-fixture boundaries.
- [Defect ledger](DEFECT_LEDGER.md): source-linked prerequisites assigned to owners.
- [Checkpoint](CHECKPOINT.md): resumable English handoff. Final head/tree,
  candidate and CI artifacts are bound in the live draft PR.

A new C W03 draft, [#51](https://github.com/baraabd/carwash-platform/pull/51),
head `6a382fe4021aa61f3850f1d8cb0c082e3c488fcc`, was received during this
proposal review. Its four lane-local proposal/specification files describe
Scheduling constraints, durable Booking recovery and W04 requests. They remain
unmerged/unaccepted; no peer branch is used as an implementation base. Reconcile
its Billing-reference dependency and Work/location ownership request with B/C/E
and the product owner. Later intake is recorded in the live PR.

No runtime, contract export/version, migration, owner source, reference, registry,
CI threshold or acceptance flag changes in this child. All listed W03 domain,
broker, private-review, process/browser-restart and BASE_W02-data-upgrade cases
remain BLOCKED/NOT_RUN. Stop at this task's proposal handoff.
