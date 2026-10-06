# W07-A — Customer, Vehicle and Geo provider entry

**PROPOSED / BASE_W07_AND_BUSINESS_FOUNDATIONS_MISSING.** No endpoint, domain
model, migration or permission is added by this packet. Source:
`f01e87f4619414960e9e39c65e523a3250fbcbaf`.

Customer/Vehicle/Geo each have only ServiceMarker, health/Prisma composition and
BUSINESS_READY=false, no product controller. Customer's existing migration is
`20260920000000_sprint_02_foundation`; Vehicle/Geo each have
`20261005060000_w01_foundation`. New migrations added: **none**.

The authoritative F001 catalog assigns customers/addresses/preferences/consents
to Customer, vehicles/ownerships to Vehicle, and service zones/geocoding/travel
estimates to Geo. D owns admin-web and Configuration, E owns credentials and
Gateway. Administrator UI does not own or write A databases. Historical grouping
and illustrative admin tables do not override the catalog.

## Carry-forward schemas and exact gates

The full candidate request/response shapes, minimized views, bound page cursors,
role/purpose `serverScopeTicket`, expected revisions, operation/effect guards,
Geo validation receipt and version/publication/retirement shapes are in
[A/W06/W07_CONTRACT_REQUESTS.md](../W06/W07_CONTRACT_REQUESTS.md).
They are unaccepted. No default administrative role or bypass permission is
created. E/A/D must publish exact current grants and fields before implementation.

| Required A operation               | Inputs and owned acceptance                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer scoped search/list/detail | Current verified role + object set + purpose, bounded approved search keys, minimum/masked fields, stable deterministic ordering and cursor bound to actor/filter/scope/snapshot. Never enumerate unrestricted contacts or reuse a revoked cursor. Empty is separate from denied/unavailable.                                  |
| Customer approved update/archive   | Exact allowlisted fields and current expected revision; local audit/business mutation/idempotency outcome in one owned transaction. Archive semantics, retained data, reason and effect on new commands need policy approval. No Identity credential mutation, owner transfer, financial action or historical Booking rewrite. |
| Vehicle scoped search/list/detail  | Current Vehicle ownership and role/object/purpose grant; optional plate, approved masking and minimal detail. Customer car is distinct from Workforce fleet. No foreign object disclosure via list/detail/search/cursor.                                                                                                       |
| Vehicle approved update/archive    | Current expected revision + canonical command fingerprint, recorded audit and protected replay. Concurrent edits conflict; retirement stops eligible new use according to policy while existing Booking vehicle/plate snapshots remain unchanged. No guessed hard-delete or reactivation policy.                               |
| Geo list/detail/create/edit draft  | Actual approved Aleppo inputs/provenance, coordinate system/precision/geometry vocabulary, current role/object scope and revision. Reject unsupported/malformed/oversized geometry and outside-scope objects. No approximate prototype GPS coordinates promoted as serviceability.                                             |
| Geo validate/version/publish       | Exact immutable content hash/revision, authentic validation receipt and pending/current B/C readiness required by the accepted publication protocol. Invalid/stale/mismatched validation cannot publish. Draft edits do not change published coverage. No provider depends on final admin screen to validate a narrow version. |
| Geo retire/coverage history        | Current role/revision, audited publication/retirement and dated history/cursors. Concurrent publish/retire resolves by accepted lifecycle fence. Preserve old Booking zone/quote versions; revalidate current new/repeat bookings. Retirement does not silently cancel active Work or recalculate old price.                   |

Masked Customer contact/Vehicle plate **WITHHELD means null**; null unknown
preferences do not invent locale/motion. Geo WITHHELD/UNAVAILABLE geometry must
be null; AVAILABLE must have actual authorized geometry and provenance. Shape
validation cannot substitute for current authorization or content validity.

## Cross-owner decisions that block implementation

- E/A/D: exact role/object/purpose scope ticket issuer/verification/revocation,
  searchable fields/minimization/masking/page limits and audit access. A browser
  claimed role or ordinary admin login grants no blanket customer access.
- A/product/D: approved Customer/Vehicle update/archive fields, consequences,
  retention and exact design/copy for D management states. Reconcile W06 privacy
  fulfillment with archive; archive is not all-owner deletion.
- A/B/C/D/E: immutable Geo versus Configuration zone reference and actual
  version authority. Geo owns its geometry; Configuration may reference it,
  never maintain a contradictory second geometry authority. B/C validate their
  real current business readiness through accepted public contracts before a
  zone publication dependent on them.
- A/product: actual Aleppo geometry/hours/provider provenance and geocoding/
  routing/privacy policy. Reference-local illustrated map and distance checks
  are not deployable zone input or provider authority.
- E/owners: bounded Gateway queries/cursors/conditional revision transport,
  route/client errors and timeout/original-operation lookup; approved schema,
  idempotency scope/fingerprint/replay/lifetime, separate cross-key business
  deduplication, audit/outbox/inbox and version event compatibility.

Use append-only A-local migrations and real DB upgrade/drift/constraints,
current Identity/object HTTP authorization, transaction crash/replay and audit
tests in E-allocated isolated namespaces. Narrow A provider acceptance can merge
first through E's authorized process; D's final admin-to-owner browser and all
affected customer/operator flows must pass before the respective consumer merge.
The parent full-scope acceptance remains blocked until combined-source parity
and historical/current behavior have real evidence.
