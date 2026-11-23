# W03-D — Private review and Booking operations entry packet

Task: **W03-D**. Phase: **BLOCKED_ENTRY / independent analysis and proposals**.
Parent implementation: **NOT_STARTED**. Product acceptance: **NOT_RUN**.

Observed `main`: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`, tree
`050b4b8a03be2bc671cbaa00151ea7105891e2d4`. This is an audit/proposal parent,
**not BASE_W03**. E's registry has no BASE_W03 field, retains `BASE_W02: null`,
and publishes no accepted next-wave contracts or generated clients. All five
W02 proposal PRs #46–50 are merged; their 31 changed paths are documentation or
declarative test specifications. App/service/package/registry source is unchanged
from `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`.

Merged E PR #50 explicitly ends bootstrap write permission in A–D source and
requires permanent ownership immediately. Its old conditional lease registry
is unreconciled and does **not** restore E's permission. E must publish reviewed
ownership/checker reconciliation; the eight D transition gaps in W02 remain.
Absent BASE_W03 and accepted dependencies independently block W03 product writes.
This packet edits only Lane D documents/specifications, as the task permits.

## Current truth and required producers

| Requirement | Actual source / missing acceptance | Required owner result |
| --- | --- | --- |
| Integrated W02 shell/Configuration | Admin and Operator `src/index.ts` remain `foundation-only`, `businessReady:false`; Configuration has only ServiceMarker | D W02 real shell/settings provider and consumer acceptance, then E's verified common base |
| Selected-case review | Workforce and Media schemas are marker-only; no real dossier, reviewer decision, work-grant or private-object endpoint | C binding provider, then Media private provider, then Workforce review/eligibility provider; current Identity delegation from E |
| Approved review/detail states | Registered admin HTML has static technician rows, inert review buttons and simulated add-technician modal; no dossier, document viewer, correction/rejection/approval/activation states | Baraa/design + D resolve AG-04/DEC-D-18 and reviewer policies; no new copy or approval inferred |
| Booking queue/detail | Reference has fixture rows and inert filters; no production paging/detail state. Booking remains marker-only | C bounded authorized list/detail, Scheduling capacity and Dispatch assignment facts; A allowed customer/vehicle/consent display; B separate financial reads |
| Gateway/client/scoped auth | Clients empty; Gateway lacks required lists/Media routes and rejects query strings; coarse V1 permission/session has no case/market/object delegation | E publishes versioned clients/routes/query/error/origin/CSRF policy and grants; preserve real Identity V1 |
| Reporting | ServiceMarker/InboxMessage/ProbeProjection; worker parses only Catalog foundation probe; no product checkpoint/audit/query model | Frozen C/B operational/finance events and authorized repair/snapshot sources; D owned projection provider; E ACL/topology/client release |
| Operator activation visibility | Operator remains technical boot | C real eligibility consumer after provider merge; actual activation/revocation visible in the integrated operator application |

The registry's old A-packet-unreceived observation is historical: A's W02 packet
is now present through merged #46. Receipt and merge still do not accept its
schemas, policy or runtime. B/C/D W02 packets are equally proposals.

## Authority boundaries

| Fact | Authority | Does not establish |
| --- | --- | --- |
| Submitted application/current case revision | Workforce/C | Clean documents, review approval or work eligibility |
| Object binding/classification/scan/private access | Media/C with current case-purpose authority | Identity verification or activation |
| Correction/rejection/approval decision | Workforce/C | Usable session or automatic work grant unless the accepted transition explicitly creates it |
| Activation/work grant/current eligibility | Workforce/C | Identity account status or capacity/assignment |
| Account status/session/revocation | Identity/E | Workforce qualification or authority over unrelated cases |
| Booking lifecycle/snapshots | Booking/C | Payment receipt, assignment or custody settlement |
| Capacity / assignment / Work | Scheduling / Dispatch / C's accepted Work owner (not yet published) | Financial confirmation or collected/settled cash |
| Financial payment/receipt/ledger / custody | Billing / Wallet, B | Work completion or transfer completion without authoritative evidence |
| Projection/freshness/search audit | Reporting/D | Authority to review, activate, assign, refund or read private objects |

For each future command, consult the owning service's current state/revision and
current actor/object grant. Reporting is never the command preflight authority.
Document access must be bounded to the selected case/object/revision/purpose;
no sensitive URLs, bytes or metadata enter logs, analytics or durable browser
storage. Media must define whether revocation is immediate through a live proxy
or bounded by signed-grant expiry; do not claim immediate revocation otherwise.

Active C draft #51 is a four-file capacity/recovery proposal, not a producer
runtime. It records an unresolved Booking-versus-Workforce location ownership
conflict. E/C must publish the accepted Work/location owner; D does not choose
between competing proposals or consume an unmerged branch.

## Reporting integrity prerequisite

Static finding **INT-D-01**, not a reproduced database result:
`services/reporting/src/inbox/prisma-inbox.store.ts::applyOnce` catches the whole
transaction and maps every `P2002`/`23505` to `DUPLICATE`, without identifying the
constraint or rereading the winner's payload hash. `InboxConsumer` ACKs that
outcome. A concurrent changed-payload collision or an unrelated effect-table
unique failure can therefore be incorrectly acknowledged. Existing integration
Case C2 tests an altered replay after the original, not this race.

The real race/error tests in `tests/parallel/D/W03/ACCEPTANCE_SPEC.md` are required
before Reporting provider acceptance. D must repair this owner-local path within
an accepted child; it is not waived because business projections are pending.
The same static pattern exists in Communications; record its later owner-local
regression obligation without starting Communications implementation in W03.

## Proposed child gates

1. E accepts the missing base, scoped auth/routes/clients and resource/gate policy.
   C/A/B accept concrete typed providers and production-state decisions. Contract
   publication permits implementation; real acceptance still requires runtimes.
2. C accepts independent binding → private Media → Workforce review/eligibility
   providers and Booking read providers. Their owned DB/HTTP tests do not require
   an unmerged D UI. C's operator consumer follows real eligibility acceptance.
3. **W03-D-REPORTING-PROVIDER**: frozen events/snapshots, real producers and isolated
   resources; append-only projection/checkpoint/audit migration; inbox/hash/revision/
   checkpoint atomicity, scoped HTTP, broker/restart/repair and INT-D-01 tests.
4. **W03-D-ADMIN-REVIEW-BOOKING-CONSUMER**: merged real owner providers, accepted
   designs and clients; every private review/Booking/browser case before merge.
5. E verifies the combined candidate and actual resulting target, including
   operator activation visibility. Parent stays integration-pending after a
   provider-only merge until all W03 cases pass. No child starts automatically.

## All 17 screen rows at this observation

The W01 matrix remains the full reference/action inventory. **No product route is
functional in admin-web at this target**; a technical boot is not a shell port.
The selection below preserves all rows without silently widening W03 scope.

| Reference screen ID | W03 treatment / current product status |
| --- | --- |
| dashboard | Not implemented; broader operational dashboard pending |
| bookings | Task scope; real list/detail/paging/filter/finance dependencies blocked |
| customers | Not implemented; minimal accepted references only needed by Booking |
| technicians | Task scope; real private review/correction/activation dependencies blocked |
| services | Not implemented; Catalog/Pricing consumers pending |
| fleet | Not implemented; Workforce consumers pending |
| payments | Not implemented; W03 only independently authorized financial status display |
| wallets | Not implemented; W04 custody contracts proposed, no new checkout method |
| subscriptions | Not implemented; future accepted entitlement scope |
| promotions | Not implemented; future accepted Pricing scope |
| coverage | Not implemented; Geo contracts/inputs pending |
| live | Not implemented; authorized task-location/consent contracts pending |
| reviews | Not implemented; customer Reviews moderation differs from Workforce verification |
| disputes | Not implemented; Support/Billing contracts pending |
| notifications | Not implemented; W04 Communications proposals only |
| reports | W03 initial operational projection primitives proposed; product reads blocked |
| settings | W02 real Configuration/Identity consumer still pending |

See the task-specific acceptance specification, `W04_CONTRACT_REQUESTS.md` and
`HANDOFF.md`. None accepts a policy/version/base or declares a runtime ready.
