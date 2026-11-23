# W09-B — proposed historical import and immutable lineage profile

**PROPOSED_NOT_ACCEPTED / ENTRY_BLOCKED / IMPORT_NOT_RUN / NO_GO.**
Observed target: `b47390c8ce04b2674e9222918bcd4e03fa5aed24`.
This target is not an accepted `BASE_W09`. The five B services remain foundation
providers; no accepted financial importer, historical dataset, Money policy,
staging allocation or command manifest is available. This is a B-local proposal,
not an implemented API, migration, CLI, permission to execute or evidence of a
historical migration. W08's [restore handoff](../W08/W09_RESTORE_HANDOFF.md) is a
proposed predecessor whose unavailable datasets remain unavailable.

## Entry, classification and authoritative ownership

E must accept the closed profiles below, actual common base, compatible contracts
and images, Identity/current authority support, isolated staging resources and
gate commands before importer implementation or execution. Data owners must
authorize each genuine export, extraction coverage and purpose. Accounting must
approve source-derived mappings, opening balances, currency precision and bounds.
The import identity belongs to the receiving B service; it cannot migrate peer
schemas, write a peer database or supply Gateway/admin with financial storage.

Classify input as `AUTHORIZED_HISTORICAL`, `APPROVED_REPRESENTATIVE_FIXTURE` or
`UNCLASSIFIED`. Only the first can establish historical migration acceptance.
Fixtures require approval and distinct namespaces/environments; they cannot
silently substitute for missing historical data. Unclassified input is blocked.
Verified absence requires an authorized owner's signed observation of the source,
coverage and date plus reviewer acceptance. Missing access or an export is not
verified absence. A legacy `paid` label, session demo, receipt image or successful
navigation is not verified credit or a settled cash obligation.

## Proposed closed request and record families

Family labels are requested versioned schemas, not existing endpoints. Reject
unknown fields, unsupported versions, malformed IDs, unapproved owner/purpose,
wrong environment and incompatible mapping/policy versions. Every field listed
is mandatory in its named family; where unavailable, return a blocked receipt
with explicit null plus reason rather than accepting incomplete economic input.
E must publish actual ID, bounded collection, timestamp and Money scalar schemas.

| Family | Closed fieldset and required meaning |
| --- | --- |
| `finance.import-manifest.v1` | `schemaVersion`, `datasetId`, `classification`, `sourceAuthorityRef`, `sourceSystemNamespace`, `sourceExportId`, `sourceSchemaVersion`, `sourceCoverage`, `sourceAsOfUtc`, `extractionStartedAtUtc`, `extractionCompletedAtUtc`, `protectedArtifactRef`, `artifactSha256`, `artifactByteCount`, `sourceRowCount`, `authorizationRef`, `retentionPolicyRef`, `mappingRef`, `mappingDigest`, `moneyPolicyRef`, `openingBalanceApprovalRefs`, `expectedPartitionTotalsRef`, `acceptedBaseSha`, `sourceTreeSha`, `contractVersions`, `manifestSha256`. Coverage identifies partitions, omissions and cut semantics; SHA-256 binds actual retained bytes. The manifest digest covers the E-approved canonical manifest excluding its own `manifestSha256` member, so the digest is not self-referential. |
| `finance.import-preview.v1` | `schemaVersion`, `owner`, `manifestRef`, `manifestSha256`, `requestId`, `idempotencyKey`, `actorRef`, `delegationRef`, `purpose`, `reasonCode`, `reasonText`, `targetEnvironmentRef`, `targetNamespaceRef`, `expectedOwnerRevision`, `mappingDigest`, `moneyPolicyRef`. Preview validates and plans bounded owner-local effects without posting money, issuing benefits or initiating provider operations. |
| `finance.import-execute.v1` | All preview fields plus `previewReceiptRef`, `previewPlanSha256`, `executionApprovalRef`, `expectedExecutionFence`. Verify unchanged inputs and recheck current authority at execution; a preview is not continuing authorization or a cross-service lock. |
| `finance.import-status-query.v1` | `schemaVersion`, `owner`, `importRunRef`, `actorRef`, `delegationRef`, `purpose`, `fieldset`, `cursor`, `pageLimit`, `expectedSnapshotRevision`. Accept only approved bounded fieldsets/cursors; every item and replay is currently authorized. |
| `finance.import-receipt.v1` | `schemaVersion`, `owner`, `importRunRef`, `manifestRef`, `manifestSha256`, `requestFingerprint`, `actorRef`, `authVersion`, `authorizationDecisionRef`, `targetEnvironmentRef`, `mappingDigest`, `moneyPolicyRef`, `planSha256`, `status`, `startedAtUtc`, `completedAtUtc`, `counts`, `partitionTotals`, `lineagePageRef`, `rejectionReportRef`, `reconciliationRef`, `ownerRevision`, `executionFence`, `auditRef`, `outboxRefs`, `coverage`, `blockerCodes`. Unexecuted counts/totals are null, never invented zero. |
| `finance.import-lineage.v1` | `schemaVersion`, `owner`, `economicIdentity`, `sourceAuthorityRef`, `sourceSystemNamespace`, `sourceRecordId`, `sourceMovementId`, `sourceComponentId`, `sourceRevision`, `sourceExportId`, `artifactSha256`, `rowLocator`, `rowSha256`, `mappingDigest`, `semanticFingerprint`, `manifestRef`, `importRunRef`, `classification`, `currency`, `amountMinor`, `sourceEvidenceRefs`, `originalEconomicRef`, `postingRefs`, `allocationRefs`, `walletMovementRefs`, `subscriptionEffectRefs`, `correctionRefs`, `disposition`, `auditRef`, `createdAtUtc`. IDs reference actual owner-issued facts; disallowed effect families are empty only after validated inapplicability, not to conceal missing evidence. |
| `finance.import-rejection.v1` | `schemaVersion`, `owner`, `importRunRef`, `manifestRef`, `sourceRecordId`, `rowLocator`, `rowSha256`, `economicIdentity`, `reasonCode`, `safeFieldNames`, `dependencyRefs`, `disposition`, `reviewRef`, `resolvedByRunRef`, `auditRef`. Unresolved identity/reference fields are null with the reason retained. Reports exclude raw exports, proof contents, secrets and personal values. |
| `finance.import-reconcile.v1` | `schemaVersion`, `owner`, `importRunRef`, `manifestRef`, `actorRef`, `delegationRef`, `purpose`, `reasonCode`, `expectedPartitionTotalsRef`, `sourceCoverage`, `ownerSnapshotRef`, `ownerRevision`, `ownerCheckpoint`, `dependencyObservationRefs`, `requestId`, `idempotencyKey`. Read-only reconciliation compares independently derived expectations with actual owner history; it does not repair mismatches. |
| `finance.import-reconciliation-record.v1` | `schemaVersion`, `owner`, `importRunRef`, `manifestSha256`, `mappingDigest`, `expectedPartitionTotalsRef`, `observedPartitionTotalsRef`, `sourceCoverage`, `ownerSnapshotRef`, `ownerCheckpoint`, `dependencyObservationRefs`, `status`, `discrepancyRefs`, `unresolvedEconomicRefs`, `asOfUtc`, `auditRef`, `reviewRef`. Missing observations remain null with incomplete coverage. |

Proposed run statuses: `BLOCKED`, `PREVIEWED`, `AUTHORIZED`, `APPLYING`,
`RECONCILIATION_PENDING`, `ACCEPTED`, `REJECTED`. `AUTHORIZED` records an approval,
not an enduring grant; `ACCEPTED` requires completed owner reconciliation and
eligible review. Restarts resume the original run; timeout is not success.
Proposed row dispositions: `READY`, `IMPORTED`, `ALREADY_IMPORTED`, `QUARANTINED`,
`REJECTED`, `CONFLICT`, `CORRECTION_REQUIRED`. Reconciliation statuses:
`NOT_RUN`, `BLOCKED`, `PARTIAL`, `MATCHED`, `MISMATCHED`.
Quarantine is durable and visible to its authorized reviewer; resolving it links
a new review/run/correction without replacing the original rejection history.
The proposed closed `counts` object contains `sourceRows`, `examinedRows`,
`readyRows`, `importedRows`, `alreadyImportedRows`, `quarantinedRows`,
`rejectedRows`, `conflictRows`, `correctionRequiredRows` and `uniqueEconomicEffects`.
Exactly one current row disposition contributes to row totals; multi-component
effects are counted separately. A rejection can retain multiple safe reason
codes without multiplying the row count. Incomplete coverage is explicit.
Proposed closed rejection codes are `ENTRY_NOT_ACCEPTED`, `AUTHORITY_UNAVAILABLE`,
`SOURCE_UNAUTHORIZED`, `VERSION_UNSUPPORTED`, `DIGEST_MISMATCH`, `COVERAGE_GAP`,
`IDENTITY_UNTRUSTED`, `MEANING_CONFLICT`, `MONEY_INVALID`, `EVIDENCE_UNVERIFIED`,
`REFERENCE_ORPHAN`, `REFERENCE_UNAVAILABLE`, `REFERENCE_FOREIGN` and
`OPENING_BALANCE_UNAPPROVED`; E/data owners must accept them before publication.

## Permanent economic identity and truthful replay

Define economic identity from the approved receiving owner, source authority,
stable source-system namespace, permanent source movement ID, component ID and
approved effect purpose. The data owner must attest that these identifiers are
stable across exports and uniquely identify the economic fact. A source lacking
reliable identifiers is quarantined pending an approved identity/mapping decision.
Row number, import run, batch, export ID, artifact checksum, mapping revision,
operator idempotency key and target queue identity are provenance, never economic
uniqueness. Importing reordered rows, a new export or revised mapping cannot
create a second obligation, credit, benefit or cash movement for the same fact.

Each owner requires permanent unique economic-effect admission and a canonical
semantic fingerprint. The fingerprint includes immutable source identity,
owner/effect purpose, currency and exact amount, counterpart/account purpose,
effective source time, original payment/allocation reference and trust evidence
classification. Do not hash arbitrary raw JSON ordering as economic meaning.
Raw bytes, row and manifest digests preserve provenance separately. A new mapping
with unchanged accepted meaning can attach additional provenance after approved
compatibility validation; changed meaning conflicts and requires an independently
approved linked correction, never overwrite or a fresh import identity.

An unchanged command/request fingerprint preserves its immutable admission and
run identity under current authorization. While pending, a retry returns that
same run/operation reference and a truthful pending outcome; newly observed
progress is exposed through currently authorized versioned status snapshots,
not by rewriting a promised stable terminal receipt. Once terminal, replay
returns the original immutable outcome/counts/references/lineage. Different
request keys still converge on permanent effect uniqueness. A distinct export/run may
report previously accepted rows as `ALREADY_IMPORTED`; its run-specific counts
are kept separate from the original receipt and aggregate unique economic count.
Changed payload under the same request key conflicts. Expired replay-cache or
export-retention windows do not expire financial uniqueness or erase posted
lineage. Policy-approved privacy retention must preserve lawful minimum identity
and audit evidence without retaining unnecessary raw personal data indefinitely.

## Money, evidence and source-derived mapping

Accept amounts only under the approved source-currency/Money policy. Decode exact
decimal strings into canonical integer minor-unit strings using the approved
currency exponent, sign rules, legal range and component mapping. Reject or
quarantine exponent notation, malformed decimals, excess precision, overflow,
unknown currency/exponent, forbidden sign and unsupported mixed-currency records.
Do not use binary floating point, guessed rounding or an invented exchange rate.
The proposed canonical representation must normalize equivalent allowed values;
E/accounting must decide supported currencies, bounds and canonical negative zero
behavior before implementation. Totals are per currency and approved partition.

| Historical fact | Required accepted mapping and blocked ambiguity |
| --- | --- |
| Quote/obligation | Preserve the original catalogue/price/policy revision, exact snapshot and source intent reference. Missing trustworthy history is quarantined; current prices cannot rewrite historical quotes. C-owned bookings use actual public owner references. |
| Verified collection | Require authoritative payment/cash evidence, original immutable collection identity and approved allocation. Demo labels remain nonfinancial provenance. A screenshot or ambiguous legacy status cannot create verified funds. |
| Balanced posting/opening balance | Billing maps actual supported facts to balanced immutable per-currency postings. Opening balances require independently approved source evidence, cut, account purpose and reconciliation lineage, not a balancing plug or unexplained credit. |
| Cash custody/settlement | Link actual collection, holder movement, handover and company settlement independently. A collection receipt does not prove physical custody transfer or treasury acceptance. Missing custody evidence remains an accountable discrepancy. |
| Wallet | Import only approved actor/purpose movements backed by actual accepted Billing references. A legacy balance alone is not authority to issue spendable value; held/claimed/UNKNOWN exposure remains distinct. |
| Subscription | Require actual eligible Billing purchase allocation/posting and preserved term/reservation/use/correction history. A legacy active flag or pending payment cannot mint benefits; invalid renewal must not erase an independently valid prior term. |
| Refund/provider uncertainty | Preserve original capture and operation identities, reserved/UNKNOWN/confirmed amounts and authentic observations. Reconcile original provider outcome before an authorized retry; import must never submit a debit/refund or mark uncertain funds settled. |
| Missing/foreign references | Validate genuine references through accepted public owner providers. Orphan, unavailable, conflicting or unauthorized references are quarantined without substitute IDs, peer database reads or invented zero amounts. |

## Atomic progress, crash recovery and source upgrades

For each admitted owner-local effect, economic uniqueness, immutable posting or
eligible state effect, lineage, row receipt, audit and Outbox commit in the same
owned database transaction. Counts derive from durable receipts, not optimistic
worker increments. A failed transaction leaves no claimed success. Chunk/page
budgets, locking and transaction policy require accepted limits; do not invent a
cross-service transaction. Dependent Wallet/Subscription effects consume merged
real Billing providers/events with durable inbox/hash/effect/checkpoint before
ACK and permanent business deduplication. A partial owner import remains partial.

Test crashes before admission, before/after commit, before/after publication and
before/after ACK. Resume the same run with retained identities and fences; prove
stable original receipt counts, unique postings and unchanged history. W08's
final-attempt Outbox/fencing findings require accepted source repairs and real
DB/broker evidence; an importer fixture cannot bypass that prerequisite. Preserve
unresolved delivery and rejection state across backup/restore and source upgrades.
E's fresh restore/process incarnation fence must reject surviving old workers.

Append-only schema upgrades preserve admitted identities, receipts and lineage.
Before a new source schema or mapping is accepted, run read-only compatibility
preview against retained original bytes; require an explicit version and review.
Unsupported versions stop rather than silently reinterpret records. Reconciliation
compares actual per-currency postings, Wallet references, benefits and outstanding
custody/provider exposure to independently derived pre-import expectations, not
expectations copied from importer output. A mismatch creates a discrepancy for
approved owner repair; this profile has no generic balance/paid override command.
Refund import must preserve confirmed plus unresolved reserved exposure against
the original eligible capture and aggregate purchase caps per currency; it cannot import a return with missing backing
or replenish benefits/promotion headroom from an unresolved provider status.

## Authority, protected evidence and actual status

Current actor/service identity, action, tenant/customer ownership, source-data
authorization and purpose apply to preview, execution, status, replay, reports
and rejection detail. Authority unavailability fails critical access/mutation
closed. Reviewer authority for one dataset is not authority for every customer's
receipt or private proof. Restored roles cannot undo subsequent revocation.
Retain original exports in approved protected storage with digest, scoped access,
retention basis and legal holds. Reports expose classified references and safe
reason codes; logs/PRs contain no raw rows, provider credentials or signed URLs.
Private evidence uses C's accepted object-scoped access; B does not copy it into
public reports. E owns storage/network/secrets and D's views consume bounded owner
facts. No CLI command or operational capability is claimed to exist here.

| Actual W09 historical evidence | Value | Status |
| --- | --- | --- |
| Authorized export/artifact/source coverage | null | NOT_PROVIDED |
| Actual source rows, dry-run counts, rejection counts | null | NOT_PROVIDED / NOT_RUN |
| Actual import receipts, lineage and reconciliation totals | null | NOT_PROVIDED / NOT_RUN |
| Verified absence | false | UNCONFIRMED; no absence assertion |
| Representative approved fixture dataset and approval | null | NOT_PROVIDED |
| Accepted importer/Money/auth/mapping versions and commands | null | NOT_PUBLISHED |
| Isolated staging execution and real DB/broker recovery evidence | null | NOT_RUN |

Next action: E/data/accounting owners review these profiles, publish actual
BASE_W09 and approved prerequisites, then queue a narrow B importer provider
child with real owner DB/HTTP/current-authority/upgrade/replay gates. Dependent
owner/app reconciliation runs follow merged real providers in E's serialized
candidate before consumer merge. Missing genuine data or verified absence,
provider acceptance, restoration or reconciliation keeps full launch **NO_GO**.
