# W01-D — Admin surface and supporting-domain freeze proposal

Status: **PROPOSAL_READY; WAVE_ACCEPTANCE_BLOCKED**. This is the bounded Lane D planning packet, not an implemented admin application or permission to start W02.

The immutable observation source is `main@69d81a83a3409d0693272efeb19ebeb9805750f5`, tree `1988caa3f882bc0c6007ae830950b7f34f53d294`. Lane E has not published an accepted `BASE_W01`, owner/contract registry, bootstrap lease, gate manifest or resource allocations in that source. The observation SHA must not be renamed `BASE_W01`. The task explicitly permits read-only analysis and lane-local proposals while dependent writes wait.

## Reviewable deliverables

| File | Purpose |
| --- | --- |
| [ADMIN_SURFACE_MATRIX.md](ADMIN_SURFACE_MATRIX.md) | Complete 17-screen inventory, global controls, five modal forms, action owners, source/design anchors and missing states |
| [CONTRACT_PROPOSALS.md](CONTRACT_PROPOSALS.md) | Unaccepted versioned Identity, Configuration and supporting-domain proposals and cross-lane producer requests |
| [DECISIONS.md](DECISIONS.md) | Explicit unresolved product, privacy, finance, authorization and design decisions |
| [ACCEPTANCE_SPEC.md](../../../../tests/parallel/D/W01/ACCEPTANCE_SPEC.md) | Declarative future tests; runtime/browser/database/broker cases are NOT_RUN |
| [SOURCE_AUDIT.md](SOURCE_AUDIT.md) | Current source, contract registry, reference integrity and actual local command evidence |
| [BASE_CI_OBSERVATION.json](BASE_CI_OBSERVATION.json) | Twenty successful workflow runs on the observed main SHA only |
| [HANDOFF.md](HANDOFF.md) | E/A/B/C handoff, dependency sequence and resumable checkpoint |

All prose/contracts/handoffs in this packet are English; Arabic strings quote approved reference copy. Only `docs/parallel/D/**` and declarative `tests/parallel/D/**` are changed. No app/service source, package, lockfile, schema, migration, design reference, CI or infrastructure is modified.

## Acceptance boundary

The source inventory and proposals can be reviewed now. Parent W01-D is not DONE: E must accept the wave base and publication requests, decision owners must resolve required scope/design/business choices, and independent review plus the latest-target candidate gate must pass. This draft does not self-approve, merge, deploy, run live money or start another wave. Local reference guards verify unchanged bytes; they do not establish admin React parity or production readiness.
