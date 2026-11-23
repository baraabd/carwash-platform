# W09-A — proposed W10 customer evidence handoff

Packet **w09-a-w10-customer-rehearsal/0.1.0 — PROPOSED / UNACCEPTED**.
No W10 base, package/wire schema, release candidate or release authorization is
published. Carry inherited [W09-A-R01..R08](../W08/W09_STAGING_HANDOFF.md)
and unresolved [W08-A-C01..C08](../W07/W08_CONTRACT_REQUESTS.md).

## Requested accepted metadata

Proposed names below are semantic groups, not existing endpoints, event topics,
CLI flags or DTO exports. E and actual producers must review/freeze closed
schemas/versions, unknown-field rejection and compatible public clients first.

| Request | Authoritative producers / consumer | Required accepted fields and gate |
| --- | --- | --- |
| W10-A-Q01 candidate binding | E + each app/service/artifact owner → E release/D support | Accepted base, target/head/tree/candidate; clean source; exact source/configuration/package/lock/build/served hashes; repository image digests and actual pull/deploy receipts; app/worker/migration inventory, contract/client/event/policy versions. Rebuild/serve/deploy the same approved bytes; no historical badge or mutable image tag. |
| W10-A-Q02 full-scope/device verdict | A + real owner participants → E/product/design | Case/version/inventory-action-state mapping, actor/app/owner, actual physical device/OS/browser/AT/input/locale/motion/network profile, synthetic dataset ref, start/end/time origin, observed effects/metrics and evidence hashes. Missing real device/English/state is BLOCKED, not an emulated-device PASS. |
| W10-A-Q03 recovery/restore compatibility | A data owners + B/C/D/E → E operations | Current/prior schema/migration/client/worker/event/image matrix, original-operation receipts, backup coverage/cut/vector/hash, current authority/privacy masks, execution fencing, media bytes/access, permitted replay/frontiers, measured RPO/RTO/convergence and residual effects, prior-app/forward-recovery result and owned cleanup. Populated real-owner evidence required. |
| W10-A-Q04 release gaps and operational help | Actual source owner + A/D/E → E release/on-call | Approved screenshot/copy/reference bindings, tested customer help/support lookup, severity/reproduction/environment limits, fix head/tree/deployment and failed-before/passed-after artifacts, actual independent review and unresolved blockers/owners. Open required defect/feature/hardware/provider/restore row makes the applicable gate NO_GO. |

Common required semantics: current actor/guest/service/object/purpose authority,
owner-issued IDs and independent revisions; explicit UTC instants and approved
market time; exact accepted Money/currency/exponent when relevant; allowed
transitions; original operation scope/canonical fingerprint/replay/conflict/
lifetime; errors/deadlines/UNKNOWN lookup and durable compensation; current
privacy/retention/audit; backward compatibility and real provider/consumer gates.
Do not locally coerce private DTOs or invent wire enums/durations/budgets.

## Release-candidate completeness

The future manifest must enumerate all 48 W09 families and CF01..CF20/87
reference actions/six forms, required commerce/help/privacy additions and every
approved production/error/recovery state. Identify reference-only simulations
and correctly authorized operator/admin gates; never expose designer commands
as customer permissions or silently drop a required capability.

Retain canonical Linux reference/candidate/diff screenshots separately from
Windows/physical device interaction evidence. Record approval hashes and actual
hardware; blank paths or a source hash are not screenshots. Include actual
controlled provider/merchant test evidence, migration/rollback notes, restored
ownership/history/Aleppo serviceability and continued Booking outcomes.

PASS requires every applicable real assertion under accepted source/environment/
profile. Results are distinct: implementation, local source diagnostics,
combined integration, staging acceptance, release readiness, deployed and
verified operation. Missing evidence is BLOCKED/NOT_RUN, never zero/empty/PASS.
All of those product-stage outcomes remain unaccepted in this proposal.

## Actual next action

E accepts prerequisites/children, supplies the existing authorized staging
manifest and hardware/provider/data participants, then serializes real cases.
Source owners fix reproduced blockers in reviewed PRs; E redeploys each new
candidate and regenerates affected evidence. Obtain eligible independent review,
verify unchanged refs and actual resulting target before any accepted next base.
No automatic W10 implementation, merge, live money or production deployment.
