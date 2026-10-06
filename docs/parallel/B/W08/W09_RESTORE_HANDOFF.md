# W08-B — proposed W09 restore and reconciliation handoff

**PROPOSED / DATASETS_NOT_AVAILABLE / RESTORE_NOT_RUN / NO_GO.** This is a
reviewable handoff request to E, not an executed restore, an accepted contract,
an operational CLI or permission to start W09. W08-B remains NOT_STARTED for
dependent business implementation. No live provider, money operation or
destructive production exercise is authorized.

## Observed source and evidence boundary

The observed target is `f0b76221c1a1991ba78327c019f0b4a0a7c53dff`, tree
`1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d`. This observation is **not BASE_W08**.
At that exact source, `architecture/parallel-contract-release.json` remains a
W01 registry with no published BASE_W08 and no accepted next-wave finance
contracts. The source package versions are `@carwash/contracts` 0.0.2,
`@carwash/event-contracts` 0.0.2 and `@carwash/api-clients` 0.0.1; the client
registry is an empty skeleton. None establishes the financial recovery families
requested here.

Current B services supply foundation markers/probes rather than completed
Billing, Wallet, Subscription or Pricing business providers. Catalog's actual
foundation outbox can inform a source-path audit; probe events and marker rows
cannot supply genuine money, custody, entitlement or promotion restore datasets.
Disconnected quote/ledger helpers also cannot supply accepted journal snapshots.
The W07 B acceptance specifications remain NOT_RUN for their business cases.

Exact-source E evidence is
`docs/parallel/E/W07/W08_HARDENING_AND_BLOCKERS.md`: BASE_W08 is unpublished;
numeric product load, latency/error/freshness and RPO/RTO profiles are unapproved;
foundation lease/retry/lifecycle defaults are technical defaults. Its E07-B07
records static recovery hazards, including final-attempt outbox crash and lease
fencing. This handoff neither claims those hazards were repaired nor promotes a
source trace into real database/broker recovery evidence. The W08 defect packet
must retain its own source and reproduction classification.

The accepted W09 base, dataset receipts, backup objects, populated snapshot
digests, actual expected amounts, authority checkpoints, restore elapsed times
and performance measurements are all **null / NOT_AVAILABLE** here. No inferred
empty database, seeded amount or synthetic zero substitutes for an absent value.

## Genuine dataset delivery request

E must accept a versioned manifest and privacy classification before collection.
Each authoritative owner supplies its own authenticated, bounded dataset or
approved backup/export; B never reads a peer database or imports a peer Prisma
client. A composed manifest links owner-issued references without joining their
tables. The per-owner recovery cut may differ; E must approve the consistent-cut
or explicit convergence protocol and record gaps rather than assume a global
sequence or atomic cross-service snapshot.

| Requested manifest fields | Required meaning and source | Current actual value / status |
| --- | --- | --- |
| `manifestVersion`, `datasetId`, `authority`, `classification`, `approvalRecord` | Closed manifest version, genuine producer and data/environment authorization; distinguish actual staging, sandbox and synthetic input. | null / NOT_AVAILABLE |
| `acceptedBaseSha`, `targetSha`, `headSha`, `treeSha`, `imageDigest`, `configurationDigest` | Exact verified source and retained deployed artifacts/configuration for both snapshot creation and restore candidate; secrets excluded. | null / NOT_AVAILABLE |
| `contractVersions`, `policyVersions`, `migrationIds`, `runtimeRoleProfile` | Published finance, Money, auth, event and provider versions; actual schema and tested append-only privilege profile. Current foundation versions above are observations only. | null / NOT_AVAILABLE |
| `snapshotStartedAtUtc`, `snapshotCompletedAtUtc`, `ownerAsOf`, `ownerRevision`, `ownerCheckpoint`, `recoveryCutProtocol` | Actual synchronized time bounds, each owner's revision/checkpoint and agreed cut/convergence protocol. Record market timezone where policy depends on it. | null / NOT_AVAILABLE |
| `protectedArtifactRef`, `sha256`, `rowCount`, `partitionCoverage`, `retentionBasis` | Genuine scoped artifact, independently checked bytes and completeness; access-controlled locator only, no proof bytes or signed download URL in this packet. | null / NOT_AVAILABLE |
| `journalPartitions`, `expectedJournalTotals`, `originalPostingRefs`, `correctionRefs` | Billing's exact debit and credit totals **per currency**, partition/account and approved classification, with source receipts and immutable correction lineage. Include confirmed capture/collection, allocation, refund and treasury settlement totals separately. | null / NOT_AVAILABLE |
| `refundOperationRefs`, `sourceCaptureRefs`, `reservedRefundTotals`, `confirmedReturnTotals` | Billing's original eligible source and independent reserved, inflight, UNKNOWN and confirmed outcomes; cumulative allowances must reconcile without mixing currencies or sources. | null / NOT_AVAILABLE |
| `walletAccountRefs`, `holderPurposeRefs`, `billingPostingRefs`, `movementRefs`, `balancePartitions` | Wallet's approved holders/purposes and actual linked Billing effects. Separate available, held, claimed and UNKNOWN exposure; no second revenue total or inferred customer funding. | null / NOT_AVAILABLE |
| `cashCollectionRefs`, `custodyMovementRefs`, `holderBalances`, `handoverRefs`, `companySettlementRefs`, `discrepancyRefs` | Billing collection/treasury facts and Wallet's independent physical holder history, linked through accepted owner references; unresolved differences and their review receipts remain visible. | null / NOT_AVAILABLE |
| `holdRefs`, `commandClaims`, `fenceRevisions`, `expiresAt`, `terminalNoncommitRefs` | Active Wallet and applicable finance reservations with original operation fingerprints, durable execution claims and actual terminal fencing evidence. Expiry is not proof of noncommit. | null / NOT_AVAILABLE |
| `planPurchaseRefs`, `billingAllocationRefs`, `termRefs`, `benefitReservationRefs`, `useRefs`, `adjustmentRefs`, `unitPartitions` | Subscription's independently valid terms, active reservations, consumed history and linked approved corrections. Renewal attempts do not erase an already valid term. | null / NOT_AVAILABLE |
| `quoteRefs`, `catalogPricePolicyRevisions`, `campaignRefs`, `reservationRefs`, `redemptionRefs`, `counterPartitions` | Pricing/Catalog immutable snapshots and actual held/claimed/used promotion exposure and scope/budget counters. UNKNOWN claims retain exposure; rebooking uses current authorities. | null / NOT_AVAILABLE |
| `providerOperationRefs`, `originalRequestFingerprints`, `merchantEnvironmentRefs`, `providerProtocolVersion`, `submissionState`, `lastAuthoritativeObservation`, `reconciliationRuleRef` | Genuine provider pending/UNKNOWN operations, durable original business identity and official outcome/query/refund rules. Record received credit, allocation, refund and settlement independently. | null / NOT_AVAILABLE |
| `outboxRefs`, `leaseFences`, `deliveryAttemptState`, `inboxRefs`, `eventHashes`, `ownerHighWater`, `consumerCheckpoints`, `projectionGeneration`, `sourceGapRefs` | Producer and consumer durable delivery state, conflicting/stale/unsupported version disposition and replay coverage. Preserve publication uncertainty and terminal/dead rows, not merely queue length. | null / NOT_AVAILABLE |
| `currentAuthorityCheckpoint`, `revocationRefs`, `guestTaskBindingRefs`, `privacySuppressionRefs`, `legalHoldRefs`, `artifactAccessPolicyRefs` | Current E identity/grants and owner privacy/retention restrictions applied before restored data is disclosed or replayed. An older snapshot must not roll them back. | null / NOT_AVAILABLE |
| `bookingIntentRefs`, `bookingFenceRevisions`, `capacityOutcomeRefs`, `workAttemptRefs` | Current owner-issued C Booking/Scheduling/Workforce facts through accepted APIs. Money or an old finance snapshot cannot recreate expired capacity or a revoked work assignment. | null / NOT_AVAILABLE |
| `expectedInvariantResults`, `approvedBudgetsRef`, `measuredResults`, `runId`, `attempt`, `evidenceArtifactRefs`, `independentReviewRef` | Predeclared source-derived expected results, approved workload/RPO/RTO profile, actual execution and independent review. Preserve blocked/partial/mismatched outcomes. | null / NOT_AVAILABLE |

Manifest acceptance must reject missing mandatory provenance, mismatched source
or schema versions, corrupted/truncated artifacts, unavailable owner coverage
and amounts whose currency/exponent or approved bounds are unknown. Empty
collections require an actual authenticated empty-source observation with its
cut and coverage; absence is not an empty collection. Expected totals must be
derived from the genuine pre-fault authoritative records and independently
reconciled to source evidence, not copied from restored output to make it pass.

## Proposed isolated rehearsal procedure

The steps below are manual workflow requirements for E to turn into named,
accepted commands and gates. No finance restore or reconciliation command is
claimed to exist today. E controls allocation, backups, restore resources,
network/secret configuration and the serialized heavy-test slot. Each owner
controls its data and approved repair implementation.

1. **Approve the entry and cut.** E publishes actual BASE_W08/next accepted
   restore candidate, closed contracts, compatible retained images, migrations,
   isolation allocation, accepted workload and RPO/RTO budgets. Owners deliver
   the populated manifest and source evidence above. Missing required coverage
   blocks a complete rehearsal; partial diagnostic work is labeled partial.
2. **Capture the independently verified pre-fault record.** On the allocated
   authorized environment, record each owner's current receipts, exact totals,
   active/UNKNOWN partitions and checkpoints. Check artifact digests and
   extraction coverage independently. Record current E revocation and owner
   privacy restrictions separately from older business snapshots. Retain the
   declared fault boundary, original operation IDs and owned process handles.
3. **Restore into the allocated destination only.** E selects approved retained
   backups/images and restores the required compatible schemas/data under the
   exact accepted procedure. Preserve original journals, business uniqueness,
   receipts/fingerprints, inbox/outbox state, leases/fences and history. Do not
   reset amounts, erase dead delivery rows, reseed business keys, prune shared
   infrastructure or perform a destructive production restore. Record actual
   backup age, data coverage and restore start/end; approved RPO/RTO is still
   required to judge the measured observations.
   Before restored workers resume, E and owners establish an accepted fresh
   restore/process incarnation fence. Restoring an older row revision or lease
   counter must not make a surviving pre-restore worker token valid again. Test
   the old process against the restored destination and reject its finalization;
   preserve original business/provider identities while changing execution
   authority. A process kill alone is not proof of durable fencing.
4. **Apply current authority before disclosure or execution.** E and the owner
   providers establish current session/service/guest grants, revocation and
   task/object/purpose bindings; C establishes current work and capacity facts.
   Apply current privacy suppressions and legal holds to restored copies and
   replay/export paths. If authoritative checking is unavailable, financial
   mutation, privileged repair and private access fail closed. Stale snapshot
   roles and cached successful responses do not authorize a restored request.
5. **Reconcile immutable Billing history first.** Billing verifies per-currency
   balanced journals, preserved original/correction lineage, business effect
   uniqueness and confirmed capture/refund/settlement references against the
   genuine manifest. Reserved/inflight/UNKNOWN refunds remain bounded by their
   eligible captured source along with confirmed returns. A missing observation
   or mismatch becomes an audited discrepancy; no balancing credit, history
   edit/deletion or guessed exchange conversion is permitted.
6. **Reconcile original uncertain provider operations.** Billing queries or
   consumes accepted authenticated authoritative evidence for the **original**
   merchant operation using its durable identity and fingerprint. A lost reply
   does not justify a new debit/refund key. Preserve UNKNOWN when the official
   protocol cannot prove the result; route unresolved recipient/amount/finality
   differences to authorized review. Screenshot/proof receipt and fixture
   fault injection never establish provider credit, connectivity or refund.
7. **Reconcile Wallet, benefits, promotions and physical custody separately.**
   Wallet recovers a missing eligible movement only from its accepted original
   operation and actual Billing references, once. Claimed/UNKNOWN funds remain
   unavailable even after TTL or authority revocation until definitive fenced
   noncommit or an approved linked correction is established. Subscription
   verifies purchase allocation, reservations/use and independent term validity;
   Pricing verifies held/claimed/used coupon and budget exposure. Neither refund
   submission nor a restored old state automatically restores units or coupon
   allowance. Independently compare Billing cash collection/company receipt to
   Wallet holder movements/handover/custody; record unexplained differences for
   review rather than equating company receipt with holder settlement.
8. **Recover delivery and projections with durable deduplication.** Owners
   inspect expired leases, exhausted attempts, producer publication uncertainty,
   inbox hash/effect/checkpoint history and gaps before bounded replay. The
   accepted repair must fence stale workers and preserve original event/effect
   identities; never clear every attempt/dead marker or assume a reused worker
   ID is sufficient fencing. Consumer effect, dedup receipt and checkpoint
   commit before ACK. Conflicting hashes/unsupported versions are quarantined
   under the accepted protocol. D rebuilds a new projection generation from
   permitted owner history, with truthful asOf/coverage/gaps; this does not
   replay money commands, resurrect deleted private copies or reissue customer
   notifications as fresh business actions.
9. **Prove C remains authoritative and test current access.** Through real
   accepted providers, C reconciles saga outcome/compensation and current
   capacity; late payment cannot reopen an expired slot. Real independent
   customer/guest/staff sessions test own/foreign receipts, private proof,
   revoked reviewer/collector grants and current downloads after restart.
   Recovery reads, status and replay must reauthorize, not just first execution.
10. **Compare and retain measured acceptance.** Compare every post-restore owner
    result with the independent pre-fault manifest and approved invariant
    expectations. Retain actual real-DB contention, broker crash/restart,
    provider provenance and performance evidence tied to source/tree/config,
    run/attempt and allocated resources. Measure recovery time/loss/latency/load
    against the approved profile, including remaining UNKNOWN backlog. Record
    every missing owner/provider result as BLOCKED; a model or foundation CI
    cannot close full finance restore acceptance. E obtains eligible independent
    review and verifies the actual unchanged candidate/resulting target gates.

## Audited repair and bounded operational view requirements

An eventual accepted repair receipt must bind current authorized actor/service,
action/object/purpose, approved reason, original operation/business identity,
canonical fingerprint, expected revision/fence, permitted precondition, actual
effect or explicit no-effect/UNKNOWN result, audit reference and original retry
identity. Recheck current authority on execution and sensitive status/replay.
Dry-run preview alone does not authorize execution. Financial state, repair
receipt/audit and outbox commit atomically within the responsible owner's DB.
No-effect terminal release needs a schema that represents genuine no effect;
invented Billing posting IDs cannot satisfy a required reference field.

Owner operational queries need bounded page/record/time-window limits, a stable
approved cursor/snapshot and item-level current authority. Expose classified
references, actual status/revision/asOf/coverage and safe next action, not secret
provider messages or private proof contents. Alert thresholds for stalled
outbox/inbox, failed compensation, unprocessed provider evidence and aging
custody must reference the approved budget. Current technical retry/lease
defaults do not establish those thresholds. An alert or D projection is a
signal for owner reconciliation, never an authoritative money repair command.

## Narrow owner dependencies and exact next action

| Owner | Required deliverable before this handoff can be accepted |
| --- | --- |
| E | Verified common base, frozen contracts/clients and command/gate manifest; allocated backup/restore/test resources and serialized heavy slot; current revocation/service/guest support; append-only runtime privilege provisioning that remains correct after reprovision; retained source/image/config provenance and approved RPO/RTO/performance intake. |
| B | Real finance providers/constraints/history and owner APIs; independently sourced populated dataset manifests/expected amounts; narrow source repairs with actual DB/broker fault evidence and permitted audited reconciliation commands. Foundation outbox findings remain separately tracked until their accepted repair and recovery gate passes. |
| C | Accepted current Booking/lifecycle/fence, Scheduling capacity and private Media/work-attempt authority; genuine owner-issued references and late-payment compensation/capacity recovery evidence. No peer DB access is requested. |
| D | Approved operational projection/alert consumers, owner coverage/checkpoints and rebuild procedure; privacy task/copy obligations under the accepted coordinator; real report/custody reconciliation evidence using owner APIs/events. D neither authors financial postings nor grants refunds through a case closure. |
| Product/accounting/privacy and provider account owners | Real currency/precision/bounds and financial/retention policies, approved target/dataset authority, genuine merchant/environment/protocol/finality/query/refund evidence for every required route. ShamCash/Syriatel Cash remain unaccepted; Paymera scope remains an explicit unresolved owner decision, not silently omitted or a fourth UI method. |

**Next action:** E and source owners review this proposed fieldset and procedure,
publish the actual base/contracts/resource/gate and policy decisions, then queue
narrow real providers and their restore dataset producers before integrated
consumers. Populate the null fields from genuine authorized owner evidence and
review an isolated, source-bound rehearsal plan. Missing prerequisite business
providers, current authority, official provider evidence or budgets keep the
rehearsal **BLOCKED / NO_GO**. This packet starts no W09 branch, runtime process,
provider operation, restore or deployment; owned runtime handles are **none**.
