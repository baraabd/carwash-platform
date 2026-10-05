# W04-E cash journey acceptance — conditional proposal

Task **W04-E**, permanent lane **E**. Runtime phase **ENTRY_BLOCKED**;
parent **NOT_STARTED**. Child **W04-E-CASH-ACCEPTANCE-PROPOSAL** is a bounded,
reviewable handoff, not acceptance of W04 or permission to start W05.

Observed target: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`;
tree: `9f04d674056041bbc810a62e4cc7f275c32581b8`.
**BASE_W04 is unpublished.** This target is an analysis parent, not a wave base.
The task explicitly permits read-only analysis and E-local proposals in this state.

All W03 packets A–E are now merged (#53, #52, #51, #55, #54). Their 29 added
documents/specifications do not implement providers, publish contracts, prove
W03 booking/capacity races or change the W01 contract-release status. C014 #41
is already merged; its session demo is preserved and no duplicate is created.

## Deliverables

- [Source observation](SOURCE_OBSERVATION.json): dated source, contract, governance and environment facts.
- [Journey and reconciliation](JOURNEY_AND_RECONCILIATION.md): independent authorities, access transitions and both cash outcomes.
- [Provider sequence and convergence](PROVIDER_SEQUENCE_AND_CONVERGENCE.md): proposed children, topology, causal acceptance and telemetry.
- [Cash acceptance specifications](../../../../tests/parallel/E/W04/CASH_ACCEPTANCE_SPEC.md): every task case, expected evidence and blockers.
- [W05 requests](W05_CONTRACT_REQUESTS.md): owner-reviewed payment/cancellation/reschedule/refund/compensation requests, not published exports.
- [Defects and decisions](DEFECT_AND_DECISION_LEDGER.md): source-owner closure and unresolved real inputs.
- [Checkpoint](CHECKPOINT.md): commands actually run, exact scope and restart instructions.

Only these seven E documents and one E test specification are added. No business
code, migration, package/version, route/client, topology, registry, design or CI
policy changes. Permanent A–D writers retain their sources: the current task
expires the bootstrap permission despite stale conditional leases in the registry.

## Day 3 and Day 7

The Day 3 cash milestone is **not reached on the observed source**. The Day 7
full-launch target is **not supported by current evidence**. No project start
timestamp, staffed owner estimates or measured provider throughput is accepted,
so a replacement calendar date would be invented. Reforecast by remaining gates:
predecessor providers/bases → work/media → cash/custody → app consumers →
combined adversarial acceptance → security/recovery/device/staging/release review.
Retain the full required scope and re-estimate after each real accepted provider.
A green foundation run cannot reduce this remaining critical path.

This packet stops at a draft reviewable handoff. BASE_W05 and a genuine cash
evidence bundle require accepted W04 combined-source and resulting-target gates,
eligible independent review and the authorized integration process.
