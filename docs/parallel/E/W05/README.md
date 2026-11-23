# W05-E verified payments and lifecycle compensation

Task **W05-E**, permanent lane **E**. Runtime phase **ENTRY_BLOCKED**;
parent **NOT_STARTED**. Child **W05-E-PAYMENT-ACCEPTANCE-PROPOSAL** is a
bounded draft handoff. It does not accept W05 or implement W06.

Observed source/analysis parent: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`;
tree: `cc3517ec85525c7310fe340397506ef6be3fe0a9`.
**BASE_W05 is unpublished**, the real W04 cash checkpoint is not green,
and required provider verification/access paths are unaccepted. The task permits
read-only analysis and E-local proposals while dependent writes wait.

W04 packets A–E were externally merged (#59, #58, #56, #57, #60). Since the
W04 entry audit, the target gained 31 documents/specifications and 5,168 lines,
with no business implementation, contract publication or registry advancement.
The registry still says W01 `INTEGRATION_PENDING`, `BASE_W02:null`, accepted
next-wave contracts empty. Historical A intake wording is stale: A packets are
present, and W05-A #61 is a new draft proposal, not an accepted provider.
C014 #41 remains merged and its explicit session demo is preserved.

## Reviewable packet

- [Source observation](SOURCE_OBSERVATION.json): immutable source, governance, entry blockers and evidence limits.
- [Provider and boundary requirements](PROVIDER_AND_BOUNDARY.md): current official-source research, merchant verification, typed transport and review authority.
- [Lifecycle and recovery](LIFECYCLE_AND_RECOVERY.md): independent facts, cancellation/payment/refund races, durable recovery and narrow child sequencing.
- [Acceptance specification](../../../../tests/parallel/E/W05/PAYMENT_ACCEPTANCE_SPEC.md): 40 case families, separate provider-derived and local-fault evidence, all currently BLOCKED/NOT_RUN.
- [W06 requests](W06_CONTRACT_REQUESTS.md): owner-specific Wallet/Entitlement/Support/Review/Fleet/Media/notification/privacy requests, not package exports.
- [Defects and decisions](DEFECT_AND_DECISION_LEDGER.md): accountable owners and observable closure criteria.
- [Checkpoint](CHECKPOINT.md): exact scope, command results, no owned runtime resources and safe resume sequence.

Only these seven E documents and one E test specification are added. No runtime,
schema, migration, package version, shared registry, route/client, CI rule or
approved reference changes. The task explicitly expires the W01 bootstrap lease;
stale conditional leases do not authorize E to replace A–D product sources.

## Conditional milestones

The Day 4 AM financial milestone is **not reached**. The 5–7 day full-launch
target is **not evidence-supported**. An accepted project start, staffed estimates,
merchant onboarding and real predecessor acceptance are missing, so no replacement
calendar date is invented. Reforecast against the remaining provider → coordinator
→ consumer → combined acceptance → security/recovery/device/staging/release gates.
Green foundation checks do not remove those dependencies.

BASE_W06 and exact next-wave package versions can be published only after real
W05 acceptance, eligible independent review, unchanged-ref candidate verification
and the actual resulting-target gate. No skipped provider test closes that barrier.
Stop at this bounded draft handoff; no auto-merge, self-approval, deployment,
live provider/money/refund operation or automatic W06 implementation.
