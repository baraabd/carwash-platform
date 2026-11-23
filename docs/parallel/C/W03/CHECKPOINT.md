# W03-C — Entry audit and resumable handoff

Task: **W03-C**, capacity and durable Booking orchestration. Phase: **ENTRY_BLOCKED / PROPOSAL_ONLY**; implementation **NOT_STARTED**, parent acceptance **INTEGRATION_PENDING**. No accepted wave base is substituted with an observed SHA.

Observed source/branch parent: `main@82e7402ed9ab6cc4f565f423441cd0655f2d627a`, tree `050b4b8a03be2bc671cbaa00151ea7105891e2d4`, on 2026-10-05 UTC. PR #47 is externally merged at `838a6096407767b451c659ffe669d7176e5ae7b2`. Initial open-PR refresh returned none. This task creates one own proposal branch/worktree, `sprint/w03-C-capacity-prework` at `/workspace/scratch/d980e1354a15/carwash-w03-c`. Submitted head/tree and exact target are pinned in the English draft PR body after creation; a file cannot record its own containing commit SHA.

## Entry verdict and source evidence

| Requirement | Current actual evidence | Exit requirement |
| --- | --- | --- |
| BASE_W03 | Not published. `docs/parallel/E/W02/ENTRY_AUDIT.json` records null; E W02 barrier is a proposal. BASE_W02 is also null in the authoritative release registry | E verifies predecessor business gates/contracts and resulting main, then publishes full accepted BASE_W03 |
| Frozen contracts and real producers | `architecture/parallel-contract-release.json`: accepted next-wave list empty. Packages remain contracts/events 0.0.2 and clients 0.0.1. New A/B/C/D/E packets are proposals | Accepted Scheduling/Booking/Pricing/Customer/Vehicle/Geo/Billing plus Identity guest/admin/delegation exports and compatible clients |
| W02 Media/Workforce | Each still has ServiceMarker only; no verification/media business implementation since the earlier source | Accepted actual W02 providers and current eligibility/resource-authority evidence |
| Scheduling/Booking | Scheduling marker migration `20261005060000_w01_foundation`; Booking marker migration `20260920000000_sprint_02_foundation`. Neither persists capacity, reservations, command receipts, Booking or sagas | Append-only provider migrations, real HTTP/Identity/DB gates and published contracts |
| Aleppo and commercial inputs | Zones, market timezone, shifts, service/add-on durations, travel buffers, money/quote-consumption/hold/payment/cancellation policies are unapproved | A/B/D/product approved revisions, not prototype data |
| Isolated resources | No C/W03 allocation or processes started | E allocates/provisions DB roles, broker, ports, outputs/browser profiles and heavy slot |

The current instruction expires E's cross-owner bootstrap permission. E W02 documentation explicitly acknowledges this; the older null-base lease registry needs reconciliation and does not restore that permission. This corrects the earlier W02-C packet's conditional lease interpretation for current work. C still cannot start product writes without accepted BASE_W03/contracts; missing acceptance is an independent blocker. No ownership policy/registry is edited here.

All 31 changed paths between inspected earlier main `3db1afdd04c6ec65a38ca83f3993c964a1bf7587` and this target are lane-local proposals/specifications. Required AGENTS/design lock/references/manifests/architecture/catalog/ADR/verification and product sources are unchanged from the previously read source. Their precedence remains effective. Source inspection confirms:

- `services/booking/src/domain/lifecycle.ts` only checks a transition table/version and half-open overlap. It explicitly excludes authorization, SQL locking, capacity and payment prerequisites. It cannot certify a Booking or concurrency.
- Scheduling application is empty; Scheduling/Booking composition registers health/Prisma, `BUSINESS_READY=false`. No product controller, local idempotency/audit/saga/outbox/inbox exists.
- Gateway route descriptions do not supply providers; shared client is empty. Current permission has `bookings.create:self`, not scoped create-on-behalf.
- B W02 asks whether quote validation is a read or exclusive reservation/consumption; the distinction must be accepted before coordinating capacity and obligations. B/C/D money vocabularies are unresolved; this packet consumes the future canonical B schema by reference.
- A W02 guest/ownership/location and D list/reviewer packets remain unaccepted. Neither frontend/demo save proves real ownership, payment or production booking.

## Packet and actual verification

- [CAPACITY_AND_RECOVERY_PROPOSAL.md](CAPACITY_AND_RECOVERY_PROPOSAL.md): narrow database provider and persisted saga design, closure questions and acceptance queue; supplements merged W02 C W03 schemas without copying them.
- [W04_CONTRACT_REQUESTS.md](W04_CONTRACT_REQUESTS.md): Dispatch/Work/custody/admin/location contract delta, unaccepted.
- [Acceptance cases](../../../../tests/parallel/C/W03/acceptance-specifications.md): all BLOCKED_NOT_RUN; required real DB/crash/browser journeys and source-bound evidence.

| Command actually run | Result / limit |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 82e7402ed9ab6cc4f565f423441cd0655f2d627a` before/after | PASS, ten frozen artifacts and exact-source comparison; not app pixels |
| `node --test tests/design/reference-lock.test.mjs` | 12 PASS, zero failures/skips/cancellations/TODOs; existing guard only |
| `node scripts/check-boundaries.mjs`; `node scripts/check-layers.mjs` | PASS, static boundaries/layers only |
| `node scripts/verify-toolchain.mjs --config-only` | PASS, 39/39; declared Node 24.21.0/pnpm 10.32.1 |
| `node scripts/verify-toolchain.mjs` | FAIL, 38/40; actual Node 24.19.0/pnpm 11.25.0. No pins changed and no approved-runtime build claim |
| `git diff --cached --check`; relative Markdown link validation | PASS, scoped text integrity |
| Base-checker `checkChangedPaths(registry,{lane:'C',paths})` against explicitly staged paths | PASS, four lane-local paths, zero findings; diagnostic only, not independent protected trust approval |

The scope diagnostic imports `../carwash/scripts/parallel/E/check-owners.mjs` from the untouched checkout at the observation source, reads its ownership JSON, and obtains paths using `git diff --cached --name-only -z`. No candidate checker/policy is approved by C. Exact final head/tree and changed paths are verified through Git objects in the PR.

No business tests, dependency install, build/typecheck, migration, PostgreSQL/broker/storage/provider/browser/Windows/device/staging or deployment ran. No production data or mock-provider acceptance was produced. Migration IDs added: none. No runtime allocation/process/container/browser handles exist; nothing shared was stopped/reset. Fixtures remain proposals. PR/candidate/target mandatory CI and independent review remain E's gate; this packet does not claim them passed.

Next action: E reconciles the new merged A intake, ownership publication and all owner packets, closes actual W02 acceptance, publishes BASE_W03/contracts/policies/resources. Then accept real Pricing validation/Billing obligation and Scheduling providers before Booking coordinator, followed by A seven-screen cash/D review/Operator consumers. Parent remains pending until every combined-source case passes. No W04 implementation, merge, auto-merge or deployment is authorized here.
