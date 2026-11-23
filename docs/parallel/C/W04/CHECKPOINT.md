# W04-C — Cash-cycle entry and resumable checkpoint

Task: **W04-C**, complete real cash service cycle. Phase **ENTRY_BLOCKED / PROPOSAL_ONLY**; product implementation **NOT_STARTED**; parent **INTEGRATION_PENDING**. Day 3 is conditional, not achieved by this packet.

Observed main/branch parent: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`, tree `9f04d674056041bbc810a62e4cc7f275c32581b8`, on 2026-10-05 UTC. C W03 PR #51 externally merged at `7c9e2fb0ef049af303497c2a75b1e3f56b000fc2`; initial open-PR refresh returned none. Own branch/worktree: `sprint/w04-C-cash-cycle-prework`, `/workspace/scratch/d980e1354a15/carwash-w04-c`. This is an observation-based lane-local proposal exception, never a product branch from invented BASE_W04. Exact submitted head/tree are pinned in the English draft PR body after publication.

## Current source and missing entry

| Requirement | Actual source fact | Needed before dependent implementation |
| --- | --- | --- |
| BASE_W04 / contracts | No published BASE_W04; E W03 entry audit says false. BASE_W02 still null in release registry; accepted next-wave contracts empty | E verifies predecessor waves and publishes full common base/exact versions/reviews |
| Real W03 quote/booking/capacity | Pricing/Scheduling/Booking are health/marker-only for business data; historical Booking pure helper has no HTTP/DB/orchestration | Actual accepted A/B/C/E providers and conformance/current ownership |
| Dispatch/Work/Media/Workforce | Dispatch ServiceMarker only, migration `20261005060000_w01_foundation`; Booking/Media/Workforce each retain marker-only `20260920000000_sprint_02_foundation`; business-ready false | Owned append-only migrations and real persisted assignment/Work/media/eligibility providers |
| Cash/Wallet and settlement | B W03 and D W03 proposals remain unaccepted; no actual cash/treasury/custody provider exists | Canonical Money/revisions, receipt/state/posting semantics, independent treasury scopes/holder policy and real B providers |
| Three apps and coordinated scenario | Operator technical boot has no real task/execution/collection consumers; no coordinated C/W04 run allocated or agreed | E-provisioned run and serialized A/B/C/D actual-app drill with shared authoritative IDs |
| Operational/design inputs | Required policies, actual Aleppo routing/data, production failure states/English approvals missing | Explicit accepted policy/reference revisions; no prototype values promoted |

New source since the previously inspected target adds lane-local proposals/specifications, not product capability. Mandatory AGENTS/design authorities/catalog/ADR/verification and approved references retain their previously read precedence. No historical successful foundation count certifies the cash cycle.

Read B's [W04 finance packet](../../B/W03/W04_CONTRACT_PACKET.md) and D's [operations/settlement request](../../D/W03/W04_CONTRACT_REQUESTS.md): Billing owns immutable receipt/postings and treasury evidence; Wallet is Billing-backed custody coordination, not a second ledger. Pending handover is not settled. Distinct current treasury authority and reconciled Billing settlement refs are required; missing/disputed money remains pending. Money/principal/revision/state/error differences must be reconciled by E/provider/consumer publication, never copied privately.

**Location ownership update:** this task explicitly confirms Workforce-owned foreground task-scoped technician location. Follow that owner and supersede C's earlier provisional Booking-location proposal; no duplicate location history is requested. Exact policy/delegation/schemas are still unpublished. Bootstrap permission for E outside permanent ownership is expired under the current instruction; old registry condition requires reconciliation, not revived permission. Missing BASE_W04/contracts independently blocks product writes.

## Packet and actual scoped verification

- [CASH_CYCLE_PREWORK.md](CASH_CYCLE_PREWORK.md): phase/authority mapping, sensitive races, real provider queue and coordinated drill request.
- [W05_CONTRACT_REQUESTS.md](W05_CONTRACT_REQUESTS.md): proposed cancellation/reschedule/expiry/refund/compensation precedence, no W05 implementation.
- [Required drill and cases](../../../../tests/parallel/C/W04/acceptance-specifications.md): all BLOCKED_NOT_RUN, not executable tests.

| Actual command / check | Result and limit |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95` before/after | PASS, ten preserved reference artifacts; not UI pixels |
| `node --test tests/design/reference-lock.test.mjs` | 12 PASS, zero failures/skips/cancellations/TODOs; existing guard only |
| `node scripts/check-boundaries.mjs`; `node scripts/check-layers.mjs` | PASS, static source boundaries/layers |
| `node scripts/verify-toolchain.mjs --config-only` | PASS, 39/39, declared Node 24.21.0/pnpm 10.32.1 |
| `node scripts/verify-toolchain.mjs` | FAIL, 38/40, actual Node 24.19.0/pnpm 11.25.0; no pins changed/build claim |
| `git diff --cached --check`; local Markdown-link validation | PASS, scoped text integrity |
| Base `checkChangedPaths(registry,{lane:'C',paths})` diagnostic | PASS, four own paths, zero findings; no independent ownership trust approval |

Diagnostic imports untouched `../carwash/scripts/parallel/E/check-owners.mjs` at the observed target, reads ownership JSON and obtains explicitly staged paths using `git diff --cached --name-only -z`. Local/remote blob/tree equality is checked at submission. All guards ran under actual local toolchain above. Required PR/candidate/resulting-target mandatory CI/review remain E's gate, not claimed passed.

Migration IDs added: **none**. No app/service/schema/shared/CI/infra/reference changes. No install/build/typecheck or real DB/broker/storage/scanner/provider/browser/Windows/device/staging/money/deployment operation ran. No fake provider/drill result or fabricated business ID is supplied. Every business case remains blocked. Allocated environment and owned processes/containers/browser/location jobs: **none**; no shared teardown/reset/cleanup.

Next action: E reviews/publishes prerequisite contracts and actual W02/W03 acceptance before BASE_W04; B/D close financial authority/policies; E reserves the requested real A/B/C/D/E drill. Then sequence Dispatch → Work binding → Media Work purpose → Work/location → B cash/treasury/Wallet → three-app consumers and full drill. Parent remains pending through combined acceptance. No auto-merge, production operation or W05 implementation authorized.
