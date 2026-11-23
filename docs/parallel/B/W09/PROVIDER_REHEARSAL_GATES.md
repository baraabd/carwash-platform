# W09-B — provider rehearsal intake and acceptance gates

**PROPOSED / ENTRY_BLOCKED / PROVIDER_NOT_RUN / FULL_LAUNCH_NO_GO.**
Observed main: `b47390c8ce04b2674e9222918bcd4e03fa5aed24`; this is not BASE_W09.
The accepted base, financial providers, genuine account documents, authorized
non-money environments and E staging allocation are missing entry evidence.
No provider/account probe, credential handling, callback, payment or refund ran.
No production financial write is authorized to complete this rehearsal.

## Required scope and truthful current state

Cash, ShamCash and Syriatel Cash are the three approved customer UI methods.
Wallet remains an internal owner, not another checkout method. Required Paymera
scope remains unresolved: the owner must state its relation to those methods
and required acceptance. It cannot be silently omitted, represented as a fourth
method or bypassed by advertising a cash-only launch.

| Route | Required owner intake currently supplied | Actual test capability | Acceptance |
| --- | --- | --- | --- |
| Cash | Approved collector/holder/disbursement authority, custody policy and authorized rehearsal records: NOT_PROVIDED | Authorized non-money cash rehearsal and reconciliation procedure: NOT_PROVIDED | NOT_RUN / BLOCKED |
| ShamCash | Genuine merchant/environment/official versioned protocol: NOT_PROVIDED | Sandbox, verification, status and refund capabilities: UNKNOWN | NOT_RUN / BLOCKED |
| Syriatel Cash | Genuine merchant/environment/official versioned protocol: NOT_PROVIDED | Sandbox, verification, status and refund capabilities: UNKNOWN | NOT_RUN / BLOCKED |
| Paymera | Required relationship/scope decision and genuine merchant/environment/protocol: NOT_PROVIDED | Supported test rails, status, verification and refund capabilities: UNKNOWN | NOT_RUN / BLOCKED; scope decision remains OPEN |

NOT_PROVIDED means unavailable in this authorized intake, not absent outside it.
UNKNOWN means no current authorized specification establishes that capability;
it does not assert that a provider lacks an API, sandbox or refund facility.
W01/W05 public research remains dated research, not current merchant entitlement
or protocol acceptance. This packet adopts no public marketing protocol claim.
A QR, customer proof, successful navigation, adapter fixture or account approval
does not establish an independently verified received payment.

## One populated intake receipt per required provider or cash route

Every field below is currently null / NOT_PROVIDED unless explicitly labeled
UNKNOWN above. E/B must review a populated, versioned receipt before execution.
The same field names do not imply the providers share a protocol.

| Intake field | Required authoritative content |
| --- | --- |
| `scopeDecisionRef`, `routeId`, `requiredCapabilities` | Approved product/provider relationship and required payment, verification, refund and reconciliation paths; retain unresolved scope explicitly. |
| `businessOwnerRef`, `providerAccountOwnerRef`, `integrationContactRef` | Actual named accountable identities, authorization and source of genuine merchant documents. Role titles alone do not assign a person. |
| `merchantRef`, `recipientBindingRef`, `agreementRef`, `accountEntitlementRef` | Protected merchant/account aliases, authorized recipient, effective agreement and exact permitted activities; never raw credentials/account identifiers in this packet. |
| `environmentRef`, `testAccountRef`, `providerEnvironmentEvidenceRef` | Provider-confirmed environment and account with documented non-real-money behavior, supported rails and isolation from live account/settlement. A local sandbox flag proves nothing. |
| `officialDocumentRef`, `protocolVersion`, `effectiveAt`, `sha256`, `originAuthorityRef` | Genuine current provider-issued specification, retained document digest/version/effective date and permitted use. Retrieval date cannot substitute for revision. |
| `authScopeRef`, `credentialInjectionReceiptRef`, `rotationPolicyRef` | Accepted least-privilege provider/service/merchant authority; E-controlled secret injection, rotation/revocation and callback ingress. Receipt contains no key, token, password or signed URL. |
| `moneyPolicyRef`, `nativeAmountEncodingRef`, `limitsFeesFinalityRef` | Approved currencies/exponents/bounds, exact decimal encoding, direction, fee/finality/reversal semantics and clocks/zones. No assumed denomination conversion or exchange rate. |
| `paymentTestPathRef`, `verificationTestPathRef`, `nativeIdNamespaceRef` | Documented supported non-money operations and authoritative received-credit mechanism, including provider/environment/merchant/payment identity scope. |
| `callbackProtocolRef`, `independentReviewProtocolRef` | Supported callback authentication/bytes/replay/ACK rules or approved independent merchant/bank verification route, with genuine provenance and review separation. |
| `statusLookupRef`, `retrySafetyRef`, `idempotencyRef` | Original-operation lookup identities, query authorization, pending/final/unknown outcomes and authoritative retry/noncommit rules. No guessed endpoint or retry deadline. |
| `refundPathRef`, `refundStatusRef`, `refundEligibilityRef` | Supported full/partial refund path, original payment linkage, cumulative allowance, submission identity, finality and uncertain-outcome resolution. |
| `reconciliationSourceRef`, `statementSchemaRef`, `coverageRef` | Authorized provider/account statement or documented status source, exact native identities, direction, amounts, timestamps, gaps/cursor/watermark and settlement/fee coverage. |
| `retentionPolicyRef`, `classificationRef`, `accessPolicyRef`, `disposalHoldRef` | Approved evidence lifetime, protected storage, current object/purpose access, redaction/export limits, deletion and legal holds; no invented retention period. |
| `financeReviewerIdentity`, `independentReviewerIdentity`, `reviewReceiptRef` | Actual identities and eligible independence/current authority. Both identities are presently null / UNASSIGNED; no self-approval by another same-account session. |
| `admissibilityApprovalRef`, `resourceAllocationRef`, `commandGateManifestRef` | Explicit isolated non-money execution authority, E network/DB/broker/object/process allocation and accepted commands/gates tied to the exact source and images. |

Cash uses the corresponding approved collector/holder, collection, custody,
handover and disbursement identities and genuine authorized rehearsal records;
it must not invent an electronic merchant API or claim provider connectivity.
Each electronic provider needs its own populated receipt and evidence result.
An approved manual route does not replace a required automated integration.
If genuine documentation establishes an unsupported required capability,
record the exact source/decision and keep that requirement BLOCKED / NO_GO.

## Pre-execution admissibility and dependency sequence

E publishes the actual BASE_W09, accepted contracts/clients, retained images,
configuration digest without secrets, migrations, prior real W08 recovery
evidence and serialized staging gate. B supplies actual finance providers and
owned-DB constraints; C supplies Booking/capacity/Media authority; A/C/D supply
real application consumers. Missing predecessors block dependent execution.
No unmerged peer branch, private DTO or peer SQL substitutes for them.

The provider owner confirms the supported test path can exercise the required
flow without real value or live refunds. Record separate authorization for any
later real operation; sandbox authority never grants it. If the only known path
would move real money, prepare the concrete reviewable plan and leave execution
pending its applicable authority; never choose a live path to close this gate.
E accepts resource names, network egress, protected callback routing and owned
process handles before any runtime starts. Proposed commands are not existing
CLIs. No staging namespace or external account is probed by this proposal.

Where provider and consumer dependencies form a cycle, propose explicit narrow
children to E: provider protocol/configuration and B durable finance producer
gates first; genuine connectivity/recovery next; A/C/D full affected journeys
against merged real producers before consumer merge. No fixture closes these
gates. The parent remains NOT_STARTED here; actual implementation starts
INTEGRATION_PENDING and requires all task evidence for acceptance.

## Required genuine flow and evidence receipts

1. **Bind the run.** Record exact base/target/head/tree, deployed image and
   configuration digests, contract/policy/migration versions, provider intake
   receipt, authorized environment and actor, run/attempt and allocation.
   Capture independent pre-fault Billing totals, refund exposure, Wallet links,
   benefits, cash custody and original pending operation identities.
2. **Establish received credit independently.** Exercise only the documented
   authorized path. Verify authenticated provider/source, intended merchant,
   native transaction identity, direction, exact amount/currency and finality.
   Bind independent evidence to the original operation. A wrong merchant or
   unverified source establishes no received credit for this merchant.
3. **Separate financial dimensions.** Preserve genuine received credit even
   when matching/allocation is ambiguous; quarantine the allocation decision.
   Received credit, Billing obligation/allocation, provider settlement/fees and
   physical cash custody are separate facts. Neither payment nor late credit
   recreates C's expired capacity or authorizes Work automatically.
4. **Verify callbacks or approved independent review.** Follow actual documented
   signature/raw-byte/replay rules and merchant binding, or the separately
   approved independent merchant/bank evidence procedure. Reject wrong
   authentication or wrong-merchant evidence as credit for this merchant.
   Preserve authentically established own-merchant credit with unexpected
   amount/currency/reference as a discrepancy/unallocated fact; reject the
   proposed allocation rather than erasing received money. Retain provenance.
   Exercise duplicate/reordered deliveries, native-ID conflicts, pending and
   reversed outcomes under documented transitions. Customer-uploaded proof
   cannot supply independent review. Current actor/object authority is checked
   for review, read, status, execution and replay; unavailable authority fails
   closed without erasing established money facts.
5. **Rehearse refund and response loss.** Use the documented non-money refund
   path linked to the original captured source and approved amount. Keep the
   original refund operation ID and canonical fingerprint across timeout,
   process crash, lost reply and restart. Query/reconcile that original
   operation before any retry that might repeat moved money; submit again only
   under the accepted authoritative retry/fenced-noncommit protocol. A new key
   never resolves uncertainty. UNKNOWN retains cumulative refund allowance
   alongside disjoint reserved/inflight and confirmed returns within both original
   capture and aggregate eligible purchase caps per currency despite TTL, revocation,
   backup restore or lease expiry. Submission is not confirmed return.
6. **Restore and replay with E.** Preserve original provider/business/native
   identities, financial lineage, dedup receipts, inbox/outbox and refund
   reservations. Apply current grants/privacy restrictions and a fresh durable
   process fence before resuming. Reject pre-restore worker finalization and
   replay callbacks against restored real consumers once. Reconcile unresolved
   external operations before retry and compare source-derived pre/post totals
   and liabilities. No history deletion, fabricated credit or guessed zero.
7. **Reconcile the required journeys.** Use actual Billing, Wallet, Subscription,
   cash-custody and C authority through accepted APIs/events. Show independent
   customer/operator/admin sessions, forbidden foreign access, revoked reviewer
   access and honest pending/unknown states. Compare merchant/statement source
   coverage, credit/allocation/refund/settlement separately; exceptions remain
   visible and assigned. Cash additionally requires separate collection,
   holder custody/handover and company/disbursement evidence under its policy.
8. **Retain and review.** Publish only sanitized protected artifact references,
   hashes, source coverage, exact observations, redacted exception identifiers,
   immutable receipts, measured timings and reviewer approval reference.
   Do not publish secrets, raw messages, private proof, personal data, account
   numbers or signed download URLs. Validate retention/access/hold controls
   before accepting the evidence; no arbitrary deletion of posted history.

Local synthetic callback/status/refund tests may test code but remain explicitly
MODEL_OR_FIXTURE; they cannot demonstrate merchant connectivity or acceptance.
No actual source-only/foundation CI result proves a genuine flow listed above.
Record blocked cases as NOT_RUN/BLOCKED with null evidence, not passing skips.

## W10 evidence packet and exact remaining blockers

Each required route delivers an intake receipt plus genuine source-bound flow,
restore/reconciliation and retention evidence with actual named reviewers.
Include source/image/migration references, authorized commands/results, original
unresolved operation refs, retained exposure/next permitted action, source gaps,
recovery limits and redacted exception reports. Missing or contradictory evidence
keeps that route BLOCKED and full launch NO_GO; no cash-only downgrade.

Current blockers are unpublished BASE_W09/contracts, incomplete financial
producers/recovery, NOT_PROVIDED merchant/protocol/test authorization/intake,
UNKNOWN non-money provider capability, missing E staging/resources/network/
secrets/command allocation, unapproved policy/retention, unresolved Paymera
scope and null / UNASSIGNED finance and independent reviewers. The next action
is owner/E review and populated authorized intake, followed by agreed narrow
gates. Provider operations and runtime process handles in this packet: **none**.
