# W04-B — Cash collection, receipt, custody and settlement entry

Task: **W04-B**, Lane B. Phase: **ENTRY_BLOCKED / PROPOSAL_READY**.
Parent business implementation: **NOT_STARTED**. This is the bounded lane-local
analysis/proposal permitted by the task while its verified base is unpublished.

## Refreshed source truth

Observed main: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`.
Observed source tree: `9f04d674056041bbc810a62e4cc7f275c32581b8`.
These are audit identifiers, **not BASE_W04**.

W03-B #52 merged at `6f2763416c4ff7cb7e051c618ef18f8aee175c63`;
E W03 #54 merged at the observed main. Current main includes the A–E W03
packets, but the changes since the prior W03 audit source are documents and
declarative specifications. They implement no functioning obligations, cash
collection, Wallet custody or accepted business contracts. Initial intake now
has zero open PRs; old E references to unmerged intake are dated observations.

The published registry still has BASE_W02=null, no BASE_W03/BASE_W04 field and
no accepted next-wave contracts. E's merged W03 audit records BASE_W04Published
false. Billing/Wallet and C's Booking/Dispatch/Workforce schemas contain only
ServiceMarker. Operator/admin are technical boots. Customer receipt/payment
state remains a session demo; the current Receipt component is a booking-choice
summary, not an authoritative financial receipt or real download.

Existing packages: contracts **0.0.2**, event-contracts **0.0.2**, api-clients
**0.0.1** (empty exports). Accepted W04 business IDs/versions: **none**.
New migrations: **none**. The current instruction and E's merged interpretation
expire W01 bootstrap permission; permanent writers apply. The unreconciled old
lease does not restore permission or add a confirmation gate. Missing accepted
base/providers/contracts/policy independently block dependent finance writes.

## Reviewable deliverables

| File                                                                                                    | Purpose                                                                       |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [ENTRY_READINESS.md](ENTRY_READINESS.md)                                                                | Seven precise prerequisites and downstream acceptance evidence                |
| [ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json)                                                              | Immutable source fingerprints and actual schema/migration inventory           |
| [CASH_JOURNEY_AND_DURABILITY.md](CASH_JOURNEY_AND_DURABILITY.md)                                        | Actual-versus-required three-app trace and cash durability/failure invariants |
| [CONTRACT_DELTA_REQUESTS.md](CONTRACT_DELTA_REQUESTS.md)                                                | Cash/receipt/Wallet/settlement schema and compatibility closure requests      |
| [W05_CONTRACT_PACKET.md](W05_CONTRACT_PACKET.md)                                                        | Early private proof, verification, refund and late-payment request            |
| [cash-custody-acceptance.spec.json](../../../../tests/parallel/B/W04/cash-custody-acceptance.spec.json) | Real persistence/authority/recovery/three-app specifications, all NOT_RUN     |

Only new B/W04 documents and the declarative specification change. No service
code/schema/migration, app source, Identity grant, shared package/client, Gateway,
architecture/release registry, CI/infra or approved reference is edited.
No collection timing, partial/overpayment tolerance, cash holder, treasury actor,
hold purpose, currency, account/posting policy or production screen is invented.

## Proposed child sequence

1. E publishes actual BASE_W04 after real W03 obligations and accepted cash/Wallet/
   Identity/guest/provider contracts, policy and isolated resource evidence.
2. C accepts actual assignment/fenced Work facts and collection-eligibility authority;
   D/E provide current treasury/critical-operation scope and A guest receipt access.
   If final Work closure needs cash, split Work facts provider → Billing cash
   provider → Work financial-completion consumer instead of an impossible cycle.
3. **W04-B-CASH-PROVIDER** proves real owned Billing collection, immutable balanced
   journals/receipt/audit/outbox, unique business effect and current authority.
4. **W04-B-CUSTODY-PROVIDER** proves Wallet posting-linked custody/approved-purpose
   holds/handover projection against merged Billing. Freeze which owner coordinates
   treasury acceptance before **W04-B-SETTLEMENT** proves Billing settlement and
   Wallet recovery. Neither service waits for its future app to prove its provider.
5. **W04-B-THREE-APP-INTEGRATION** with A/C/D/E proves the real full order:
   completion → collection → downloadable receipt → custody → settlement,
   including paid customer with unsettled custody and explicit discrepancy owner.
   Every app consumer closes its real affected journeys before its authorized merge.

These are proposed reviewable child boundaries, not accepted schemas/versions or
permission to use moving peer branches. Provider-only success leaves the parent
**INTEGRATION_PENDING**. The full three-app flow and source-derived deployed schema
inventory remain required; no fixture is renamed real acceptance.

## Validation and resumable English handoff

Task/phase: W04-B / ENTRY_BLOCKED / PROPOSAL_READY. Accepted base: null.
Target/tree: exact audit identifiers above. Contract versions: foundation versions
above; accepted cash/Wallet/W05 IDs: none. Changed paths: this B/W04 folder plus
one B/W04 specification. Added migration IDs: none.

Pinned local checks use Node **24.21.0**, pnpm **10.32.1**, Prettier **3.9.8**.
Actual final commands, head/tree and hosted run/job links are recorded in the draft
PR after execution, avoiding a fabricated self-referential commit. Proposal JSON,
links, fingerprints and reference preservation are not finance runtime tests.

There is no Docker executable or provisioned B/W04 allocation in this environment.
No cash DB/HTTP/broker/provider/browser/three-app journey was run. All new cases
remain **NOT_RUN_SPECIFICATION_ONLY**, runtimeExecuted:false. Test fixtures cannot
enable production or close owner/integrated acceptance. Existing foundation CI
results apply only to their actual scope. Owned active resource handles: **none**.

Next action: E/owners resolve the exact policy/compatibility/authority deltas,
accept actual predecessor providers and publish immutable executable entry proof.
Re-read that base and current target, provision the isolated run and only then
select append-only Billing/Wallet migrations and source implementation. Preserve
the frozen seven Arabic RTL customer steps, optional plate, guest journey and
cash/ShamCash/Syriatel methods. Missing production receipt/discrepancy states need
exact design decisions, not invented screens or edited HTML baselines.

Stop at this reviewed handoff. No DONE, wave/base publication, self-approval,
auto-merge, deployment, real money/refund/provider operation or automatic W05
implementation is authorized or asserted here.
