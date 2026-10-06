# W08-A — customer hardening entry

Task **W08-A**, lane **A**. Phase **ENTRY_PROPOSAL**. Parent **NOT_STARTED /
ENTRY_BLOCKED**, product **NOT_ACCEPTED**. This packet is reviewable source
analysis and a proposed execution sequence; it does not implement W08 or accept
W09 staging.

Analysis source: `f0b76221c1a1991ba78327c019f0b4a0a7c53dff`, tree
`1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d`. This is observed main, **not
BASE_W08**. At the initial 2026-10-06T19:41:59Z observation there were no open
PRs. W07-A #74 and W07-E #75 were merged, but their proposal publication did
not publish an accepted product base. E's current registry still records W01
INTEGRATION_PENDING, BASE_W02:null, acceptedNextWaveContracts[] and no accepted
business-client release. E's W07 scope/target handoff expressly leaves
BASE_W07/BASE_W08 unpublished.

The supplied execution contract says: “If the base/owner registry is not
published, perform read-only analysis and lane-local proposals, then wait only
on the dependent writes.” This condition applies. Only the eight new A-local
files below are proposed; no app, service, shared contract/configuration,
locked reference, schema or migration changes are made.

## Reviewable packet

- [Source and write/cache audit](SOURCE_AUDIT.md): current implementations,
  source ownership, production transport and bundle limits.
- [Threat/race register](THREAT_AND_RACE_REGISTER.md): three reproduced local
  findings, owner boundaries, proposed fixes and missing-producer attack gates.
- [Accessibility/device plan](ACCESSIBILITY_AND_DEVICE_PLAN.md): Arabic and
  required English, focus/motion, canonical pixels, device and measured budgets.
- [W09 staging requests](W09_STAGING_HANDOFF.md): safe diagnostics, accepted
  metadata inputs, recovery scenarios and owned backup/restore evidence.
- [Acceptance specification](../../../../tests/parallel/A/W08/ACCEPTANCE_SPECIFICATIONS.md):
  52 concrete families, all **UNEXECUTED / ENTRY_BLOCKED**. A source diagnostic
  that demonstrates a defect is not a successful remediation regression.
- [Immutable observations](source-observation.json): source hashes, registry
  and package facts, real command results, compiled-asset measurements and limits.
- [Checkpoint](CHECKPOINT.md): own branch/worktree, exclusions, resources,
  verification and exact resume dependency.

## Proposed children and prerequisite order

These are requested review scopes, not automatically started sprints. E must
accept their base, manifest and producer/consumer gates before coding.

| Child | Cohesive A scope | Required predecessors / acceptance |
| --- | --- | --- |
| W08-A-LOCAL-STATE | Late geolocation intent, stale Vehicle edit target, malformed location adapter input | Accepted scope/base and error semantics; focused actual state and delayed-callback browser regressions, existing C005/C008/C009/C014 preservation. |
| W08-A-PRINCIPAL-CACHE | Authenticated/guest object views, scoped caches, principal change and response invalidation | E Identity/guest/Gateway release and real Customer/Vehicle/Geo providers first; owned HTTP authorization and shared-device browser tests. |
| W08-A-TRANSACTION-RECOVERY | Quote/slot/confirm/save/proof/cancel/entitlement and navigation races | Real B/C/D command/status/replay/compensation producers and accepted clients; real multi-user HTTP/DB/broker tests before consumer merge. |
| W08-A-AR-ACCESSIBILITY | Full implemented Arabic journeys, focus/error/dialog/touch/motion repairs | Complete affected producers and approved production states; canonical comparison plus real keyboard/screen-reader/device evidence. |
| W08-A-EN-LTR | Approved complete English translation/layout and locale handling | Product/design approval and published locale/error/presentation contracts; required English is blocked, never removed from scope. |
| W08-A-DEVICE-PRESSURE | Measured bundle/network/CPU/heap/media and slow/offline recovery | Accepted E workload/device/AT/numeric budgets and real Media/provider flows; preserve independent operation authority under cancellation. |
| W08-A-CANDIDATE | Combined required security/race/accessibility/device evidence and W09 handoff | All children and affected operator/admin consumers accepted; latest target+head, mandatory CI, eligible review, unchanged refs and E integration gate. |

No provider depends on the finished customer app to prove its narrow owned
DB/HTTP/Identity/constraint contract. The later consumer must nevertheless pass
its full affected real journey before its merge. Parent remains
INTEGRATION_PENDING after implementation starts until all 52 families and
affected cross-app gates pass on combined source.

## Entry decisions still required

E publishes the full BASE_W08 SHA/tree, frozen contract/client versions and
actual resource/gate manifest. Product/design approves complete English and
missing production/error/recovery states. Product/E approves measurable load,
latency/error/bundle/memory/media/recovery targets and a device/AT matrix.
Domain owners publish real object authority, revisions, Money/time, unknown
outcomes and idempotent recovery. The eight unresolved W07 requests
W08-A-C01..08 remain unaccepted; see [the inherited request packet](../W07/W08_CONTRACT_REQUESTS.md).

Preserve optional plate, guest booking, seven decisions and the three approved
checkout methods. Real Aleppo coverage/hours/prices, financial/privacy policies
and Paymera disposition remain actual inputs. Foundation green checks, local
build sizes, illustrative fixtures and translated fragments cannot approve them.

The English PR handoff binds final proposal head/tree, current target and CI.
This packet does not authorize merge, deployment, live money, production
destructive exercises or automatic W09 implementation.
