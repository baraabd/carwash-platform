# W10-B — proposed finance operating instructions

**PROPOSED_NOT_EXECUTABLE / ENTRY_BLOCKED / OPERATIONS_NOT_RUN / NO_GO.**
Observed source: `8bfa805d033cb29373c33886bf71bce4885a2f67`, tree
`9288ac9a1320221f309ce33b571a057f5ec2ea57`. This is not BASE_W10 or an accepted
release candidate. The registry remains W01; the accepted BASE_W10, release
manifest, genuine W09 evidence and financial operating command manifest are
null / NOT_PROVIDED. Business providers remain foundation shells. W09's import,
provider and restore packets are predecessor proposals, not executed acceptance.

These steps make the missing operational decisions reviewable. They do not
define existing CLI commands, authorize runtime execution or assign a named
person. No financial read/write, provider/account probe, migration or restore
ran under this packet; owned operational process handles are **none**.

## Ownership, assignment and configuration intake

| Required responsibility | Actual named identity | Evidence required before operation |
| --- | --- | --- |
| B finance provider maintainer and accounting decision owner | null / UNASSIGNED | Current owner authority, approved Money/cash/refund/accounting policies and exact source/contract references. |
| Assigned cash collector and accountable holder | null / UNASSIGNED | Current C work/assignment and B collection/holder/purpose authorization; prior custody remains linked to its actual holder. |
| Treasury recipient and independent handover reviewer | null / UNASSIGNED | Approved recipient, acceptance/discrepancy authority and separation of duties. |
| Refund requester, approver and executor | null / UNASSIGNED | Actual named eligible actors, approved separation/limits and current object/purpose grants. |
| Provider/account owner and finance evidence reviewer, per required route | null / UNASSIGNED | Genuine merchant/environment/protocol entitlement and independently verified financial evidence. |
| E staging/restore operator and incident/on-call owner | null / UNASSIGNED | Approved environment, configuration/resources, recovery/fencing controls and incident route. |
| Privacy/data-retention owner and eligible independent signoff reviewer | null / UNASSIGNED | Actual retention/access/legal-hold policy and reviewer independence. Same-login agents cannot provide independent approval. |

E must supply the actual candidate/base/target/head/tree, dependency lock, retained
registry image digests and compatible migration inventory, current Identity/
guest/service grants, resource allocation and accepted command/gate manifest.
Secret configuration requires protected version/access/rotation references only;
never include credentials, raw merchant identifiers or signed download URLs.
Provider owners supply authenticated native-ID, amount/currency/finality, status,
refund, callback and reconciliation protocols and authorized non-money test paths.
Actual configuration references, commands, budgets, alert thresholds, retry/
escalation deadlines and RPO/RTO are **null / NOT_PROVIDED**; no defaults are set.

**FOUNDATION_ONLY — actual committed configuration key names, no values:**

| Inspected source | Actual key/name and limit |
| --- | --- |
| All five B `src/infrastructure/persistence/prisma.service.ts` and `prisma.config.ts` | `DATABASE_URL` is the runtime and Prisma-command environment key. E supplies the correct distinct application/migration identity per execution. `CARWASH_DATABASE_URL` is a Nest injection token, not another environment key; no `MIGRATION_DATABASE_URL` is read. |
| All five B `prisma.config.ts` | `SHADOW_DATABASE_URL` is optional for authorized migration authoring; it does not allocate a staging/shadow database. Schema files carry no connection URL. |
| `packages/service-kit/src/config.ts`, consumed by B bootstrap | `PORT`, `HOST`, `LOG_LEVEL`, `STARTUP_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`; inherited foundation defaults are not approved recovery budgets. |
| Catalog `src/outbox/relay.runner.ts` | `DATABASE_URL`, `BROKER_URL`, `LOG_LEVEL` for the foundation probe relay, not a finance/provider protocol. |
| `infra/postgres/provision.sh` | `CW_SERVICES`, `POSTGRES_USER`; each listed service's uppercase prefix yields `<SERVICE>_DB_PASSWORD` and `<SERVICE>_MIGRATION_PASSWORD`, including CATALOG/BILLING/WALLET/PRICING/SUBSCRIPTION. This provisioner is explicitly for a disposable foundation database, not historical or production data. |
| All five B `src/app.module.ts` and `package.json` | `BUSINESS_READY=false` is a source constant, not a configurable approval switch. Existing script names include `generate`, `build`, `build:tests`, `typecheck`, `migrate:deploy`, `start`; only Pricing/Wallet/Subscription additionally have foundation `test:runtime`. No finance operational CLI is established by these scripts. |

No finance/provider secret key or new operational command is invented here.
E publishes the accepted staging configuration/secret references separately.

Preserve Cash, ShamCash and Syriatel Cash as the three approved UI methods.
Required Paymera scope/relationship remains unresolved; obtain the explicit
decision and genuine acceptance without silently omitting it, adding a fourth
method or downgrading full launch to cash-only. Wallet is internal ownership.
The task's Wallet funding/spend/refund gate covers approved holders/purposes and
actual eligible Billing references; it does not approve customer stored-value
funding/withdrawal, marketplace balances, payroll or automatic recurring debits.

## Common controls for every proposed workflow

Use only the accepted owner API/command and approved bounded fieldset. Gateway,
admin and Reporting do not own financial state. Never inspect peer tables,
import peer Prisma clients or repair an owner through a reporting projection.
Verify current actor/service/guest authority, object ownership, delegation and
purpose on sensitive reads/status/replay and queued mutation, including after
preview. Unavailable current authority fails closed. Guest receipt access uses
the accepted resource capability, not phone, plate or a supplied customer ID.

Bind each action to its original business identity, canonical fingerprint,
expected revision/execution fence, approved reason and audit receipt. Same-key
same-meaning retry retrieves the original result after current access checks;
changed meaning conflicts. A different key cannot duplicate the same economic
effect. Timeout or lost response is pending/UNKNOWN, never fabricated success.
Each owner atomically commits state, durable receipt/audit and Outbox; consumers
commit effect/dedup/checkpoint before ACK. Corrections append linked history.

Use exact approved Money per currency and source-derived amounts. Missing facts,
coverage or references remain unavailable; they are not zero, unpaid or settled.
Keep protected provenance and sanitized artifact references, not private proof,
raw provider payloads, account secrets or personal data in logs/events/exports.

## Receipt lookup and customer/operator/admin presentation

1. Obtain an authorized immutable Billing receipt/payment/obligation reference
   from the owning flow; use the accepted bounded lookup and current ownership
   grant. Test guest and absent-plate paths without weakening access checks.
2. Read actual amount/currency, original posting/allocation/correction references,
   owner revision/as-of and coverage. Present verified collection/credit,
   allocation, outstanding obligation, refund exposure and treasury settlement
   independently. A QR, proof upload, review badge or navigation is not money.
3. Resolve missing/stale references through authorized owner inquiry. Preserve
   an incomplete status rather than manufacture a receipt or use Reporting as
   authority. C Media independently controls each private proof read/version.
   Current grants and retention apply to downloads, status and exported copies.

## Cash collection, custody, handover and treasury reconciliation

1. Verify current C assignment/work eligibility and approved B cash collector,
   amount/currency/quote/obligation/holder/purpose policy. Cash collection does
   not itself complete Booking/Work or prove company treasury receipt.
2. Under the original collection identity, obtain actual authorized collection
   evidence and execute the accepted Billing operation once. Retain immutable
   receipt/posting/audit references; response loss queries that original result.
3. Wallet records the approved holder's corresponding custody movement only
   from actual eligible Billing references. Reassignment does not move already
   held cash. Delayed Wallet updates require original-reference reconciliation,
   not a second collection or an arbitrary balance edit.
4. Preview the proposed handover using permitted holder/treasury references and
   independently evidenced amounts. Recheck current authority at execution.
   Record sender delivery and independently authorized recipient acceptance;
   a declaration alone cannot settle custody or approve one's own handover.
5. Compare physical holder/custody counts, accepted handover, Billing collection
   and company treasury facts separately per currency/cut. Preserve short/over,
   unaccepted or missing evidence as an assigned discrepancy. No balancing
   credit, deleted collection, forced settled state or guessed conversion.

## Authorized refund review and original-provider uncertainty

1. Locate the original eligible capture/collection, purchase, immutable receipt,
   prior confirmed returns and disjoint reserved/inflight/UNKNOWN exposure.
   Validate current requester/approver/executor grants, reason/policy and exact
   amount. Atomically reserve within both source capture and aggregate purchase
   caps per currency; different keys cannot evade those cumulative limits.
2. Fence Subscription eligibility before the money return when required. An
   approval, pending refund or provider submission does not restore consumed
   units, promotion allowance or capacity. Approved corrections are separate
   linked owner actions; the original financial and usage histories survive.
3. Persist the stable original refund/provider identity and fingerprint before
   external submission. Use only the genuine documented, explicitly authorized
   non-money path during acceptance. Real payment/refund needs its applicable
   separate authority; no live operation is implied by this document.
4. On uncertain submission, crash or lost reply, query/reconcile the original
   merchant/environment/native operation before any retry that might repeat
   money movement. Retry only under accepted provider finality/idempotency and
   durable fenced-noncommit rules; never replace the operation with a new key.
5. UNKNOWN retains its refund allowance after TTL, revocation, lease expiry or
   restore. Current authority determines who may inquire/act; revocation cannot
   erase previously established credit or independently prove noncommit.
6. Confirm a return only from authenticated authoritative provider/bank evidence
   or approved cash-disbursement evidence bound to the original payment and
   exact Money. Record linked immutable reversal/receipt and allowance once.
   A proof image or transfer submission is not confirmation. Wrong merchant/
   unverified evidence does not establish eligible credit/return for this obligation
   or definitive noncommit. Retain UNKNOWN until authoritative evidence resolves
   it; preserve genuine mismatched effects separately from disputed allocation
   and settlement, including actual movement to an unintended recipient.
7. Late credit stays financial truth. C alone handles current Booking/capacity
   and approved compensation; payment cannot reopen expired capacity. Require
   current pricing/catalogue/capacity for a separately authorized rebooking.

## Wallet, Subscription and promotion reconciliation

1. Query approved holder/purpose partitions through real Wallet and Billing
   providers: actual funding/backing, movement/refund/posting references and
   available/held/claimed/UNKNOWN exposure. Wallet is not a second revenue ledger.
2. Repair a missing eligible movement only through the accepted original command
   and genuine Billing effect once. Command-bound spend/capture claims remain
   unavailable beyond TTL/revocation until authoritative original-outcome resolution
   or definitive fenced noncommit. A linked reversal/correction requires an actually
   committed Billing effect reconciled with the original exposure; approval alone
   cannot release uncertainty. Never fabricate references for no-effect release.
3. Compare Subscription purchase allocation, independently valid terms, renewal
   attempts, reservations/claims/consumption/expiry and linked corrections.
   Unknown renewal does not erase an earlier independently valid term. Last-unit
   capture/release is fenced and unique; cancellation requires accepted policy.
4. Compare Pricing held/claimed/used promotion exposure and budget counters.
   UNKNOWN never restores coupon headroom. Old quotes remain immutable; newly
   priced rebooking uses current accepted owners and a distinct authorized C
   intent. Report source gaps, lost backing and unit/counter differences rather
   than adjusting totals from a dashboard or replaying money commands.

## Migration recovery, restore and escalation

1. E selects an authorized isolated destination and compatible retained source,
   images/configuration/schema/roles. Data owners supply genuine protected
   exports, checksums/coverage, source-derived mappings and approved opening
   balances. Missing exports do not establish historical absence. Demo paid
   flags cannot produce money; approved fixtures remain explicitly fixtures.
2. Receiving B owners preview and execute only accepted idempotent procedures
   under their migration identity and current authority. Preserve original bytes,
   permanent economic identity and visible rejection/quarantine records. Repeat
   against the same admitted facts to prove unchanged history/counts/benefits;
   new batch/checksum/mapping order cannot create a duplicate economic effect.
3. With E, retain independent pre-restore totals/exposure and agreed owner cuts,
   then restore only allocated resources using the accepted compatible plan.
   Preserve journals, receipts, native/original operation IDs, dedup/inbox/outbox
   history, pending refunds/holds, custody and benefits. No shared reset/cleanup.
4. Apply current revocation/privacy/task/object authority and an accepted fresh
   restore-incarnation fence before disclosure/workers/replay. Reject surviving
   old-worker finalization even with repeated labels/counters. Reconcile external
   original operations before retry, then owner totals and bounded event gaps;
   compare actual outcomes to the independent pre-fault record, not themselves.
5. Classify pending states using actual source, approved policy/deadline/monitor,
   named owner and next permitted inquiry. Legitimate lifecycle pending is
   distinct from unexplained money differences, missing functionality or missing
   acceptance. Without those inputs, retain unclassified/BLOCKED rather than
   labeling unknown exposure safe. Alert budgets/escalation contacts are pending.
6. Retain a bounded incident receipt: exact candidate/environment, original refs,
   sanitized discrepancy/coverage, preserved exposure, failed gate, current
   authority, assigned actor, approved action/fence and audit/evidence links.
   Route to the responsible B/E/C/D/provider/data owner through the established
   authorized incident process. No notice or external message is sent here.

Operational acceptance requires real three-app journeys, genuine authorized
provider flows, DB/broker/current-access/concurrency/restart/restore evidence,
eligible independent review and exact resulting-target/image acceptance. Any
changed source/tree/configuration invalidates applicable prior evidence. Missing
required provider, decision or feature keeps full launch NO_GO. E and named
owners must populate assignments/configuration/commands and agree the tested
instructions; the authorized user/maintainer decides merge/deployment separately.
