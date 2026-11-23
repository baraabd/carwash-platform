# W05-B — electronic verification and refund recovery entry

Task **W05-B**, Lane **B**. Phase **ENTRY_PROPOSAL**. Product implementation
**BLOCKED / NOT_STARTED**; parent **NOT_ACCEPTED**. This is the bounded lane-local
analysis/proposal allowed while the accepted base and providers are unpublished.

Observed proposal parent/target: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`;
tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`. This is **not BASE_W05**.
Own branch/worktree: `proposal/w05-B-verification-entry`,
`/workspace/scratch/6a9547568741/carwash-w05b-source`. The current attachment
assigns B; the earlier A draft #61 is separate and is left untouched.

## Current source and scope

- B W04 #58 is merged at `af6e9e9d0c25d3762685674f3ea447aeee02e029`,
  head `0b5de0cb51036377dc89fe5ed6410c6f6f2d6b07`; its seven added files
  are proposals/specifications, not cash acceptance or provider implementation.
- The release record still has W01 `INTEGRATION_PENDING`, `BASE_W02:null`,
  no BASE_W03/BASE_W04/BASE_W05 and no accepted next-wave business contracts.
  B/C/D/E W04 packets are review requests, not a published executable base.
- Billing, Pricing, Wallet and Subscription schemas contain only ServiceMarker.
  Catalog additionally has FoundationProbe/OutboxMessage for technical probes.
  Business readiness is false; no real financial journal, obligation, provider
  adapter, review, refund, hold or entitlement activation is implemented.
- Existing packages are contracts/event-contracts/api-clients
  `0.0.2`/`0.0.2`/`0.0.1`: Identity/Gateway foundation, probe and strict
  contract-only booking.confirmed.v1; business client exports are empty.
- Permanent B writes cover its five services and lane-local paths. All manifests,
  locks/tsconfigs/Dockerfiles, shared packages, architecture, global CI and infra
  remain E-owned. Current task expiry overrides stale bootstrap leases; missing
  accepted contracts independently blocks dependent product writes.

## Financial and provider boundary

QR/instructions, proof submission, independent receipt of merchant funds,
allocation to an obligation, outstanding and refund execution are separate facts.
Wrong matching fields can block allocation without erasing genuinely received
credit; proof/review alone cannot establish funds. Unknown provider outcomes
retain durable operation identity and refund allowance until independently resolved.
Billing cannot recreate expired capacity, assign Work or confirm service.

Cash/ShamCash/Syriatel remain the approved visible methods. Paymera B-02 is
**OPEN**: infrastructure under an existing method and a fourth visible method are
separate scope questions. Required unresolved support remains a launch blocker.
Public first-party descriptions/API advertising are not accepted protocols,
merchant configurations or designated provider test facilities. Unsupported or
untested automation stays unavailable; independently authorized manual evidence
cannot close a separately required provider integration/sandbox gate.

## Proposed provider-first children — E agrees scope and gates before coding

| Child / owner                            | Predecessor and bounded real acceptance                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W05-PREDECESSOR-BARRIER / E with owners  | Real W01–W04 acceptance including cash/custody; publish actual BASE_W05, contracts/grants/policies and isolated run allocation.                                                                                      |
| W05-C-BINDING-AUTHORITY / C with E/A     | Narrow order/beneficiary/cancellation-purpose and Work/quiescence facts before dependent money/Media; no final coordinator dependency.                                                                               |
| W05-B-INSTRUCTIONS-PROVIDER / B          | Accepted obligation and genuine merchant/provider dossier; immutable amount/currency/recipient/version, intent identity and lookup.                                                                                  |
| W05-C-PROOF-PROVIDER / C Media           | Real Billing purpose binding; private reserve/upload/scan/finalize/current object access, not payment verification.                                                                                                  |
| W05-B-OBSERVATION-REVIEW / B with E/D/C  | Accepted raw provider-authenticated ingress/query, independent merchant evidence and private proof; durable observation/event/business dedup, current reviewer grants and separate credit/allocation.                |
| W05-B-REFUND-RECOVERY / B with Wallet    | Merged verification and narrow C cancellation/Work authority; atomic allowance, unique provider/refund/compensation operations, immutable reversal, authorized cash-disbursement/custody facts and restart recovery. |
| W05-C-COMPENSATION-CONSUMER / C          | Merged finance providers; durable cancellation/late-payment compensation and independent capacity/Work outcome. Split prepare-authority from final effect if a cycle remains.                                        |
| W05-A-C-D-CONSUMERS / respective owners  | Actual customer proof/status, authorized admin review/refund and operator financial/eligibility journeys against real merged providers, before consumer merge.                                                       |
| W05-E-BARRIER / E + independent reviewer | Latest target/exact-head candidate; mandatory and all task-listed real gates, unchanged refs and actual resulting-target checks before wave promotion.                                                               |

Provider children prove owned DB/HTTP/Identity/migration/constraints and published
conformance first. Provider-only success cannot accept the full parent; once
runtime starts it remains INTEGRATION_PENDING until affected journeys pass.
No moving peer branch, fixture or synthetic callback becomes a real provider base.
These requested children are unstarted, not additional PRs opened by this proposal.

## Deliverables and stop point

- [Provider capability and input dossiers](PROVIDER_CAPABILITIES.md).
- [Verification/refund/cash/late-payment recovery](VERIFICATION_REFUND_RECOVERY.md).
- [W05 acceptance specifications](../../../../tests/parallel/B/W05/ACCEPTANCE_SPECIFICATIONS.md): all new cases UNEXECUTED.
- [W06 posting/Wallet/Subscription contract requests](W06_CONTRACT_REQUESTS.md): proposed, not frozen.
- [Checkpoint](CHECKPOINT.md) and [source observation](source-observation.json): actual commands, source fingerprints and limits.

Stop at the W05 draft handoff. E/owners must publish accepted entry evidence before
dependent implementation; independent review/candidate acceptance remain pending.
No merge, deployment, live money/refund operation or W06 implementation occurs.
