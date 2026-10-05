# W03-B — Billing entry and provider acceptance proposal

Task: **W03-B**, Lane B. Phase: **ENTRY_BLOCKED / PROPOSAL_READY**.
Parent implementation: **NOT_STARTED**. This is the bounded lane-local work
explicitly permitted while the accepted wave base/contracts are unpublished.
It does not create a journal, intent, obligation, payment or accepted policy.

## Current truth

Observed main: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`.
Observed tree: `050b4b8a03be2bc671cbaa00151ea7105891e2d4`.
These identify the audit source; **neither is BASE_W03**.

The earlier B W02 proposal PR #49 merged at
`5893ce294336daa934be334b078f0099c5f382b7`. E's W02 prerequisite proposal
PR #50 also merged. No open PR was observed at initial intake. Those merges
deliver proposals, not persistent Catalog/Pricing or wave acceptance.
The registry still has `BASE_W02: null` and no accepted next-wave contracts;
`BASE_W03` has not been published. E's W02 audit explicitly records it as null.
Billing and Pricing schemas remain ServiceMarker-only. Catalog's probe/outbox
remain foundation facilities. No accepted immutable business quote can be consumed.

Foundation source versions: contracts **0.0.2**, event-contracts **0.0.2**,
api-clients **0.0.1** (empty exports). New accepted business contract versions:
**none**. Added migrations: **none**.

The prompt expires W01 bootstrap permission; E's merged W02 instructions agree
that permanent writers apply immediately. The old conditional lease registry
still needs reconciliation. It grants no renewed bootstrap permission and is
not an extra user-approval gate. Missing base, accepted providers/contracts and
accounting policy independently prevent the dependent Billing source writes.

## Reviewable packet

| File                                                                                          | Result                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [ENTRY_READINESS.md](ENTRY_READINESS.md)                                                      | Seven source-grounded dependencies and required publication evidence               |
| [ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json)                                                    | Immutable schema/source fingerprints, actual inventory and nonexecution labels     |
| [BILLING_DESIGN.md](BILLING_DESIGN.md)                                                        | Due/collected/custody/settlement separation; durable invariants and failure design |
| [CONTRACT_DELTA_REQUESTS.md](CONTRACT_DELTA_REQUESTS.md)                                      | W03 Billing/Pricing/Booking/Identity compatibility decisions for E review          |
| [W04_CONTRACT_PACKET.md](W04_CONTRACT_PACKET.md)                                              | Early collection/receipt/settlement and minimal Wallet request                     |
| [billing-acceptance.spec.json](../../../../tests/parallel/B/W03/billing-acceptance.spec.json) | Real provider/integration acceptance specification; cases NOT_RUN                  |

Only new B-local documents/test specifications change. Service code, schemas,
migrations, manifests, packages, Gateway, global CI/infra, ownership/release
registries and the three approved references retain the observed source bytes.
No chart of accounts, recognition date, price, currency exponent, replay retention,
guest grant, merchant capability or collection policy is invented.

## Proposed provider-first sequence

1. E publishes reviewed prerequisites and actual BASE_W03 after W02 real
   Catalog/Pricing, Identity/guest and policy acceptance. Freeze the specific
   quote-validation/consumption and Billing commands before their consumers write.
2. **W03-B-BILLING-PROVIDER** implements the narrow owned database/HTTP provider
   against real merged Pricing/Identity/configuration: intents, cash obligations,
   authorized accounts and policy-driven immutable balanced journals, stable
   command receipts, audit, outbox/inbox, status and cancellation/compensation.
   Prove real PostgreSQL constraints/privileges, authorization and restart recovery.
3. C's Scheduling provider and Booking coordinator consume merged providers in
   their explicit dependency order. Billing does not require the unimplemented
   full Booking journey before its first provider write. Any required Booking
   reference/service authority must already be defined in the frozen contract.
4. **W03-B-CASH-INTEGRATION** with A/C/E proves the actual quote → Booking →
   cash-obligation journey, unavailable capacity and duplicate broker delivery.
   Exactly one durable obligation remains unpaid; no intent implies receipt.
   E accepts the latest-target combined candidate and independent review.

Provider-only acceptance leaves the parent **INTEGRATION_PENDING**. Fixtures
cannot close the real consumer gate. Splits are proposed child boundaries for
E review, not a new accepted base or permission to consume moving peer branches.

## Validation boundary

Use actual Node **24.21.0**, pnpm **10.32.1**, Prettier **3.9.8**. Existing
reference/toolchain/inventory checks and explicit proposal formatting/JSON/link/
source-fingerprint checks are applicable; they are not Billing runtime tests.
Actual final commands, delivered head/tree and hosted run links belong in the
draft PR after execution, avoiding invented self-referential commit identifiers.

No Docker executable or provisioned B/W03 allocation is present in this local
environment. No finance PostgreSQL/HTTP/broker/browser acceptance or provider
operation was run. All new specification cases remain
`NOT_RUN_SPECIFICATION_ONLY`; `runtimeExecuted:false`. Existing CI exercises
foundation capabilities and cannot be relabeled W03 finance acceptance.
No skipped/canceled check counts as success. Owned active resources: **none**.

## Resumable checkpoint / English handoff

Task/phase: W03-B / ENTRY_BLOCKED / PROPOSAL_READY. Accepted base: null.
Audit target/tree: the exact identifiers above. Contract versions: foundation
versions above; accepted W03 IDs: none. Changed paths: this folder and the
single B/W03 specification. Migration IDs: none. Environments: read-only source
audit and local proposal checks; no actual finance runtime and no unlabeled mock.
Blocked cases: all Billing provider/integration specification cases.
External dependencies: E publication/allocation/transport/authorization, B real
W02 Pricing, C Booking/Scheduling, A guest access, D approved accounting inputs.
Owned PIDs/containers/queues/browser profiles: none.

Next action: E reviews the contract deltas and missing policy decisions, completes
the accepted producer/barrier sequence, and publishes immutable executable entry
proof. Re-read that base and current target, allocate the isolated run and select
append-only Billing migrations only then. Record source-derived schema inventory
and all actual acceptance artifacts. Keep the parent pending until combined
journeys pass. No DONE, merge, self-approval, live money, deployment or automatic
W04 implementation follows from this handoff.
