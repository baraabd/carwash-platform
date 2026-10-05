# W01-C — Technician scope and operational contract packet

Phase: `PROPOSAL_REVIEW_PENDING`. Parent: `BASE_W01_UNPUBLISHED / NOT_WAVE_ACCEPTED`.

This packet implements the authorized **design/domain proposal and declarative specification** slice of W01-C. It does not implement operations. E's immutable wave/owner/contracts/bootstrap/resource registry was not present in inspected source or observed W01 branches/PRs. Under the prompt's explicit proposal exception, the packet is prepared on an isolated branch from inspected main rather than inventing an accepted BASE_W01. E must establish the common base and accepted contracts before dependent code/runtime work.

| Packet | Purpose |
| --- | --- |
| [TECHNICIAN_INVENTORY.md](TECHNICIAN_INVENTORY.md) | Source-derived views, sheets, actions, eight local states/six phases, prototype vs production, design gaps |
| [OPERATIONS_BLUEPRINT.md](OPERATIONS_BLUEPRINT.md) | Independent owner facts, operation/state/authorization/revision/idempotency matrix, cash journey and durable compensation |
| [CONTRACT_REQUESTS.md](CONTRACT_REQUESTS.md) | Proposed W02 Media/Workforce/operator/location contracts and producer-first W03/W04 roadmap |
| [DEPENDENCIES.md](DEPENDENCIES.md) | Named unresolved decisions, E/A/B/D handoff requests and conditional milestones |
| [acceptance-specifications.md](../../../../tests/parallel/C/W01/acceptance-specifications.md) | Declarative positive/negative domain, DB/HTTP/broker and future browser evidence requirements; none counted as run |
| [contract-examples.md](../../../../tests/parallel/C/W01/contract-examples.md) | Explicit synthetic proposed request sketches and negative/replay variants; no provider success claimed |
| [CHECKPOINT.md](CHECKPOINT.md) | Resumable English handoff, observed refs, commands/results, environment limits and next action |

## Inspected truth

- Inspected target/source: `main@69d81a83a3409d0693272efeb19ebeb9805750f5`, tree `1988caa3f882bc0c6007ae830950b7f34f53d294`.
- PR [#41](https://github.com/baraabd/carwash-platform/pull/41) C014 merged at `2026-10-05T01:49:15Z`; its head was `04b7577097d7767e0d0cd1bf43de84ea92c02671`, and the resulting target tree equals its head tree. C014 remains explicit session demo only.
- GitHub push workflow inventory for the inspected resulting main: 20 workflows, all completed/success when read. This is remote workflow evidence for that source, not W01-C's future delivery head, E wave acceptance or independent approval. Relevant examples: [F009](https://github.com/baraabd/carwash-platform/actions/runs/37252929542), [Sprint 0.2](https://github.com/baraabd/carwash-platform/actions/runs/37252929487), [F010](https://github.com/baraabd/carwash-platform/actions/runs/37252929495), [Reference guard](https://github.com/baraabd/carwash-platform/actions/runs/37252929549), [C014](https://github.com/baraabd/carwash-platform/actions/runs/37252929464).
- Initial `pulls?state=open&per_page=100` was empty; W01 branch query returned no branches. Initial clean source worktree had no pre-existing user edits. The local `--no-checkout` clone's apparent deleted files were its unmaterialized checkout, not another writer's deleted source.
- Permanent technician app path is `apps/operator-web`. It and admin are source skeletons; Media/Workforce/Booking schemas contain foundation markers. Root build/typecheck does not prove all three frontend experiences.
- Catalog schema version 2 and package versions `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1` are observed. Registry contains `identity.v1` foundation and `gateway.v1` routing only; business APIs remain unpublished. `booking.confirmed.v1` is contract-only; foundation probe event is foundation-runtime. None is an E W01 contract acceptance record.
- F010 `washgo-three-apps-v1` registers approved Arabic technician/admin/customer HTML. No full technician English design exists. The customer and technician electronic-payment execution prerequisite differs; Aleppo geography, privacy fulfillment and custody actor/purpose remain decisions.

## Acceptance boundary

Proposal documents and test specifications are ready for review. Parent W01-C is not marked DONE/WAVE_ACCEPTED: accepted base/contracts, external decisions and required independent review are pending. Operational cases are future blocked specifications, not skipped successes. The 5–7-day target authorizes no test bypass, self-approval, merge, auto-merge, live financial operation or deployment.

Only Lane C docs/specifications are changed. No new app/service implementation, contract package, manifest, infrastructure, migration or reference change is made. The draft PR is the review boundary; stop here until E's verified base and next task prompt.
