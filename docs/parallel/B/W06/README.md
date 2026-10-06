# W06-B — Wallet and Subscription entry proposal

**PROPOSED_NOT_ACCEPTED. Parent: NOT_STARTED. Product writes: BLOCKED.**

This is the authorized lane-local fallback for the current W06-B task, not an
implementation or accepted contract release. Audited target:
`78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`, tree
`c5bd3137ef9d4e0ab7b70b9646e126f10e011883`. This target is the proposal parent;
it is **not BASE_W06**. E has not published BASE_W06. No service source, shared
package, architecture, manifest, CI, locked reference or migration is changed.

## Evidence and entry decisions

| Required input | Current observed evidence | Owner / consequence |
| --- | --- | --- |
| BASE_W06 and compatible released contracts | Release registry still W01/INTEGRATION_PENDING; BASE_W02 null; no BASE_W06; acceptedNextWaveContracts empty | E: publish actual immutable accepted base, review record and exact package versions before dependent writes |
| Actual W04 custody and W05 financial providers | Billing/Wallet/Subscription schemas contain ServiceMarker only; empty applications/ports; BUSINESS_READY false | B plus predecessor owners: merged W04/W05 proposal documents do not implement custody, posting, provider verification or refunds |
| Real Booking binding/commands | Booking schema ServiceMarker only; no durable business saga or new finance/benefit handlers | C: prerequisite intent/authority provider, then new reserve/capture/commit/release consumers |
| Money, holder/purpose, lifecycle and privacy policy | B-03/05/06/07/08/09/12/15 remain OPEN; applicable provider/product decisions also unresolved | Product/accounting/privacy owners + E: exact approved revisions, not invented defaults |
| Current scoped access and guest ownership | Real Identity security exists; business Wallet/Subscription/privacy grants and guest beneficiary contracts are absent | E/A/C: preserve current authentication; broad billing.read/refund or Workforce review cannot authorize these new actions |
| Shared routes, schemas, clients and topology | Contracts/event-contracts 0.0.2, api-clients 0.0.1; Identity/Gateway HTTP, foundation probe and strict contract-only booking.confirmed.v1; clients empty | E: publish actual compatible exports, routes, audiences, broker ACLs and recovery reads |
| Isolated real acceptance environment | No W06-B DB/role/port/queue/object/browser allocation; Docker unavailable locally | E: allocate run resources and actual business gate commands; current diagnostics do not prove database or integrated behavior |

`docs/VERIFICATION.md` and registry inventory prose contain historical runtime
counts. Current implementation-status self-test inventories 19 runtime services,
18 foundation shells and one Identity capability runtime. Runtime onboarding is
not business-domain implementation. Current source and F001 service catalog take
precedence over older grouping/counts.

## Scope that must be resolved, not silently removed

- Implement approved internal Wallet accounts/purpose partitions, posting-backed
  balances, holds, capture/release/expiry and recovery. Keep cash custody,
  provider settlement and customer funds distinct. Wallet is not a fourth
  checkout method; locked choices remain cash, ShamCash and Syriatel Cash.
- Customer wash subscriptions remain required inventory with unapproved exact
  plan/rate/unit/expiry/cancellation/renewal/refund rules. Funding, withdrawal,
  customer stored value, marketplace/provider plans, pause/resume/change,
  rollover/proration and recurring debits require an explicit applicable
  inventory/policy decision. Record approved inclusion or explicit exclusion;
  absence of approval is neither permission nor a silent scope reduction.
- **B-owned privacy export/anonymization/retention fulfillment is required in
  W06 by the current task.** This supersedes B/W05's historical W07 scheduling
  reservation. It does not approve B-12, a coordinator, action mapping, fields or
  retention periods. Keep this current requirement blocked until those exact
  inputs exist; W07 covers compatible evolution, not deferred W06 fulfillment.
- A/C/D must approve any missing production Wallet/plan/privacy states and copy.
  Preserve seven customer booking screens, guest cash and optional plates,
  approved visuals/Arabic/RTL/focus/motion and existing operator-web boundary.
  No new screen, demo data or client success is financial evidence.

## Packet

| File | Purpose |
| --- | --- |
| [ENTRY_CONTRACT_REQUESTS.md](ENTRY_CONTRACT_REQUESTS.md) | W06 schema deltas, unresolved compatibility and acyclic child scopes/gates for E/owners |
| [WALLET_AND_POSTING_RECOVERY.md](WALLET_AND_POSTING_RECOVERY.md) | Posting-linked accounts, atomic reservation and fenced capture/expiry recovery proposal |
| [SUBSCRIPTION_LIFECYCLE.md](SUBSCRIPTION_LIFECYCLE.md) | Purchase/activation/renewal/benefit states, ownership and real C integration proposal |
| [PRIVACY_FULFILLMENT.md](PRIVACY_FULFILLMENT.md) | Current W06 per-owner fulfillment, lawful exceptions and accurate completion proposal |
| [W07_CONTRACT_REQUESTS.md](W07_CONTRACT_REQUESTS.md) | Early Pricing administration, promotions, rebooking, adjustment/privacy/reporting requests |
| [source-observation.json](source-observation.json) | Immutable source/tree/package facts and SHA-256 observations |
| [acceptance-specifications.json](../../../../tests/parallel/B/W06/acceptance-specifications.json) | Required real DB, HTTP, broker, C journey and privacy cases; every case NOT_RUN |
| [CHECKPOINT.md](CHECKPOINT.md) | Resumable scope, diagnostic evidence and submission handoff |

The W01 closed finance schemas and W05 packets are existing **proposals**, not
accepted APIs. Preserve their shapes; request separately reviewed additions or
majors. In particular, Wallet V1 RELEASE requires nonempty Billing posting IDs:
do not send empty IDs or manufacture a journal to enable no-effect release.

## Acceptance boundary

Provider children must first prove their own real DB/upgrade/constraint/HTTP/
Identity contracts. C consumers then use merged real B providers before their
integration merge; A/C/D journeys follow. E agrees the child scopes and serializes
latest-target plus exact-head candidates, independent review and unchanged refs.
Once implementation begins, the parent remains INTEGRATION_PENDING until every
required combined-source lifecycle, recovery, privacy and journey case passes.

This proposal can be reviewed independently. Neither its merge, static guards,
foundation CI, agent review nor same-account GitHub activity accepts the business
contracts or makes the parent DONE. No merge, deployment, provider operation or
live money action is performed. Next action: owner decisions and E's accepted
release; then the explicitly sequenced W06 children, with a fresh entry audit.
