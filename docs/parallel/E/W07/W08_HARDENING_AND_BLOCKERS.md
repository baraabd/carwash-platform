# W08 target freeze and release-impact handoff

**PROPOSED_HANDOFF / NO_ACCEPTED_BASE_W08.** Freeze unresolved status honestly:
no accepted numeric product load, latency/error/availability, freshness,
RPO or RTO profile was found in the observed source or referenced historical
plan. Baraa/product operations and E remain the accountable decision owners.
This is not permission to choose plausible targets or start W08 automatically.

## Numbers that must not become product approval

| Observed value                                                                                    | Source                                                                     | Accepted meaning                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 30s steady projection;120s healthy-replay convergence;60s restart readiness;180s outer fault case | docs/parallel/E/W04/PROVIDER_SEQUENCE_AND_CONVERGENCE.md                   | Provisional harness budgets only; provider/consumer acceptance or measured replacement is required. Unset/unreviewed remains BLOCKED. |
| Gateway timeout3000ms, allowed50–30000ms                                                          | apps/api-gateway/src/infrastructure/config.ts                              | Technical configuration range, not an approved latency/SLO target.                                                                    |
| Outbox lease30s/batch20/maxattempts5; publisher confirm10s; delivery ceiling3                     | packages/platform-messaging/src/outbox-relay.ts, publisher.ts, topology.ts | Foundation implementation defaults, not durable business recovery guarantees.                                                         |
| Startup30000ms/shutdown10000ms; allowed100–300000ms                                               | packages/service-kit/src/config.ts                                         | Technical lifecycle timeout configuration, not product RTO.                                                                           |
| p95 over5m query examples                                                                         | docs/F008_RUNBOOK.md                                                       | Technical observability examples, not approved production SLOs.                                                                       |
| Canonical pixels/channel8/diff0                                                                   | docs/design/f010-reference-manifest.json                                   | Approved reference comparison profile; it does not establish product performance or actual app parity.                                |

The product profile must include approved workload/journey mix, peak load,
concurrency/data size/duration, percentile latency/error/availability windows,
freshness/replay convergence, dependency fault model, RPO/RTO, realistic
environment/hardware/configuration and acceptance authority/provenance.
Measure against real complete artifacts/data after those targets exist. An
unknown target is a blocker rather than a zero, default or automatic PASS.

## Bounded defect and dependency register

| ID / release impact                        | Accountable owner                    | Source evidence / required closure                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E07-B01 Required-scope NO_GO               | E + all owners                       | BASE_W07, accepted contracts/clients and real prior-wave business evidence absent. Publish narrow real providers and coordinator/app acceptance before full scope. Do not substitute current main or draft proposals.                                                                                                                                                                              |
| E07-B02 Required-scope provenance NO_GO    | Product authority + E                | Authoritative prior40 work packages missing; the historical 300-sprint plan is not that list. Reconcile exact approved package IDs/completion evidence without inventing40 entries.                                                                                                                                                                                                                |
| E07-B03 Required-business NO_GO            | A/B/C/D                              | Marker/probe data and technical shells, disconnected quote/ledger/lifecycle modules, absent complete business producers and operator/admin product UI. Source owners implement and prove all matrix rows.                                                                                                                                                                                          |
| E07-B04 Production fallback NO_GO          | A; E release gate                    | Customer main.tsx always injects initialSession fixtures with no production gate; saved objects are memory-only and checkout/tracking/history remain deferred. Remove incomplete production fallbacks through A after accepted providers and approved states; retain truthful demo evidence.                                                                                                       |
| E07-B05 Required product/design NO_GO      | Product/design authority + A/B/C/D/E | Real Money/price/Aleppo geography/hours/policies, all approved methods/Paymera disposition, wallet holders/purposes, English and unmatched production states, location authority and privacy fulfillment remain unresolved. No invented fourth method/cash-only omission.                                                                                                                          |
| E07-B06 Full event/report NO_GO            | B/C/D/E                              | Real authority/event schemas, effects/checkpoints/rebuild/export/freshness/receipts absent. ProbeNotification/ProbeProjection and contract-only Booking event cannot accept financial/reporting journeys.                                                                                                                                                                                          |
| E07-B07 Recovery correctness NO_GO         | B/D/E source owners                  | Retained W06 static hazards: final-attempt leased outbox crash, broad inbox uniqueness handling, repeated publisher listeners and worker-ID-only fencing (reused-identity hazard inferred). Accept a unique-instance/per-lease fencing invariant and independently reproduce/close relevant business recovery cases with real DB/broker evidence; do not claim reproduced failure from this audit. |
| E07-B08 Immutable candidate NO_GO          | E                                    | Local image jobs remove local artifacts; no retained published repository-digest promotion evidence. Bind exact source/tree/config/security/SBOM and actual same-artifact startup for all required deployables.                                                                                                                                                                                    |
| E07-B09 Prior-state migration NO_GO        | E + owner migrations                 | Preserve existing clean/no-op/drift and Identity marker upgrade evidence; add real populated accepted product upgrade, immutable snapshots/constraints/roles/replay state and rollback compatibility. No destructive reset.                                                                                                                                                                        |
| E07-B10 Full UI/device NO_GO               | A/C/D; E evidence gate               | Reference-to-itself F010 and narrow C014 do not cover complete candidate journeys, RTL/English/accessibility or Windows/device media/navigation. Approved references stay byte-identical.                                                                                                                                                                                                          |
| E07-B11 Existing-staging operational NO_GO | Existing environment owner + E       | Identity/access/topology/configuration evidence unverified. Obtain already-existing environment and permitted immutable promotion; no first setup or production/provider authorization inferred.                                                                                                                                                                                                   |
| E07-B12 Numeric operational target NO_GO   | Baraa/product operations + E         | No approved product load/SLO/freshness/RPO/RTO values. Preserve technical defaults as technical; approve and measure target profile before hardening acceptance.                                                                                                                                                                                                                                   |
| E07-B13 Independent review/target NO_GO    | Eligible reviewer + E                | Same-login sessions are not independent approval. Exact PR head/latest candidate/actual resulting target checks and complete real functional evidence required. No merge/base publication by this packet.                                                                                                                                                                                          |
| E07-S01 Security OPEN_REVIEW               | E + eligible security reviewer       | Four actual f01e CodeQL findings below remain nonblocking under current severity policy, with no suppression or false-positive declaration. Review and close with source-bound evidence/focused regressions as needed.                                                                                                                                                                             |
| E07-M01 Metadata correction proposal       | E/D/A owners by path                 | VERIFICATION10runtime/9skeleton and planned operator/admin prose, Identity README no-auth statement, older React-candidate-absent acceptance text and historical implementation dates/pins are stale. Update only under their owner/accepted source; never replace them with business-ready claims.                                                                                                |

## Retained security review

Actual f01e F009 run37478254150 attempt1 CodeQL record SHA256
`2b7eb805c570fc63381b26f85eced7c95c9e58fac645236e39e533fc62dd8aad`:
four warnings, zero blocking findings. These are not new W07 scan results.

| Rule / security severity    | E-owned source locations                                                         | Unchanged source blob                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| js/file-access-to-http /6.5 | scripts/ci/install-tools.mjs:22; tests/integration/rabbitmq-acl.test.mjs:255,256 | installer a0aebe88e853bfa5fe5fd8ef979fa9d419392049; ACL test da83492e4e4e7ed30208db43bf4c20c9547512c2 |
| js/http-to-file-access /6.3 | scripts/ci/install-tools.mjs:30                                                  | a0aebe88e853bfa5fe5fd8ef979fa9d419392049                                                              |

The installer uses fixed source URLs/checksums and an exclusive temporary
write; the ACL test uses ephemeral Basic credentials against loopback. Those
contexts do not dismiss findings. Review download redirects/response-size/
temporary-write boundaries and loopback authentication/redaction. A correction
requires meaningful focused regressions and fresh exact-source CodeQL. Preserve
all current mandatory scanner jobs/thresholds and full-history secret scanning.

## Handoff state

Implemented foundation, locally checked proposal, integrated foundation,
staging-accepted product, release-ready product, deployed product and verified
operation are separate states. Only the first three have bounded historical
evidence; this W07 proposal supplies no new functional integrated product.
Any required row/target/environment/review gap keeps the full candidate NO_GO.
BASE_W08, production/live-provider execution and next-wave work remain pending.
