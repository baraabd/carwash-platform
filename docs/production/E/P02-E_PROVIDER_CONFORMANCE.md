# P02-E — Provider conformance against the published contracts

Audited source: `main` at `566d2e7435dac0803d075556fff43c435f8a29a7`. Open lane PRs observed on 2026-10-08: #103 (vehicle.v1), #104 (scheduling.v1), #105 (geo.v1), #106 (billing), #107 (dispatch). They are not merged, so the table describes `main`.
Method: route, authentication and messaging inventory of every P01 provider,
compared with `@carwash/contracts` 0.1.0 / `@carwash/event-contracts` 0.1.0.
This is an observation, not a decision on the owners' behalf.

## Summary

The P01 providers are real services with their own databases, migrations and
tests. **None of them imports `@carwash/contracts`, and the wire they serve does
not match the published contracts.** The Gateway (P02-E3) routes to the
*published* paths. A combined booking journey through the Gateway therefore
cannot succeed until each owner either conforms or submits a reviewed contract
change. These are cross-lane blockers. Lane E does not edit owner services.

| Owner (lane) | Contract | Gap | Effect on the booking path |
| --- | --- | --- | --- |
| Customer (A) | `customer.v1` | Bootstrap is `POST /me` (contract `PUT /me`). `POST /address-snapshots/resolve` (`service:customer.address-snapshot.resolve`) is missing. Guests are refused (only `account` principals accepted). | Booking cannot capture a saved-address snapshot. Guests cannot use saved addresses. |
| Vehicle (A) | `vehicle.v1` | Routes are `/`, `/:vehicleId` (contract `/mine`, `/mine/:vehicleId`). `POST /vehicle-snapshots/resolve` is missing. | Booking cannot capture a saved-vehicle snapshot. Inline vehicles are unaffected. |
| Geo (A) | `geo.v1` | `POST /serviceability` is unauthenticated (contract `principal`). `POST /serviceability/validate` is missing. No zone dataset is approved, so every decision is `INDETERMINATE`. | Booking cannot re-validate a decision. No real location is ever `SERVICEABLE`. |
| Catalog (B) | `catalog.v1` | `GET /definitions` requires a session (contract `public`). Publish is `POST /definitions` with `catalog.publish`, a permission Identity does not issue. Read is by revision, not `/definitions/:definitionId`. | The public catalog through the Gateway's anonymous mode is refused. Nothing can be published by any real caller. |
| Pricing (B) | `pricing.v1` | Quote body `{catalogRevision, categoryId, packageId, addonIds}` (contract `{beneficiary, vehicleType, zoneId, selections}`). Response `{quoteId}` only. `validate` takes the customer's bearer and the selection (contract `service:pricing.quote.validate` + `{expectedRevision, beneficiary, purpose}`). `POST /prices` always returns 503 (pending catalog reader). | Booking cannot validate a quote with its own identity. No price can be published, so no quote can be issued. |
| Scheduling (C) | `scheduling.v1` | Holds are service-only (`scheduling.holds.write`, static token). The body is `{windowId, holderRef, units, ttlSeconds}` (contract `principal` + `{beneficiary, zoneId, startsAt, durationMinutes, quoteRef}`). `/confirm` instead of `/commit`; release reasons differ; `/availability/earliest` is missing. | The customer cannot hold a slot through the Gateway. Booking commits through a non-contract route. |
| Workforce (C) | `workforce.v1` | `GET /capacity-resources` is missing (eligibility is `GET /eligible`). | Scheduling capacity linkage is outside the contract. |
| Configuration (D) | `configuration.v1` | Routes are `/values/...` and `/revisions/...` (contract `/scopes/...` and `/drafts/...`). `configuration.read`/`write` are not issued by Identity. | `booking.policy.v1` cannot be read by Booking with a workload identity. |
| Booking (C) | `booking.v1` (P02-E1) | Foundation shell on main (`ServiceMarker` only, readiness 503). No provider PR was open when this was audited. | **The booking creation path does not exist on main.** |
| Billing (B) | `billing.v1` (P02-E1) | Foundation shell on main. Provider PR #106 (not merged) implements CR-B-01, which billing.v1 now publishes. The saga routes `createBookingObligation`/`voidBookingObligation` are still to be implemented. | Payment state exists only after #106 merges. |

## Platform gaps owned by Lane E

| Gap | Delivered by |
| --- | --- |
| Identity has no workload (service-to-service) identity or scope grants. Scheduling and Workforce use static per-service token digests instead. | P02-E2 |
| Identity does not issue `catalog.publish`, `pricing.prices.publish`, `configuration.*` or `billing.payments.verify`. | P02-E2: permission vocabulary and role grants |
| The Gateway route table is the foundation table, not derived from the owner contracts. | P02-E3 |
| No combined acceptance across owners. | P02-E4 |

## Messaging

- Customer, Vehicle, Geo, Scheduling and Workforce write a local outbox with a v1-style envelope of their own (`schemaVersion: 1`). It is not envelope v2.
- No relay process is started for these services. Only Catalog runs `@carwash/platform-messaging` `OutboxRelay`, and only for the foundation probe event.
- Communications is the only inbox consumer. It consumes `foundation.probe.created.v1`.
- No P01 business event is published to RabbitMQ in a deployed shape today.

## Requested owner actions (versioned, no shared-package edits by owners)

1. Lane A, Lane B, Lane C and Lane D:
   - serve the published routes;
   - parse with the published parsers by adding the `@carwash/contracts` workspace dependency. Lane E applies the lockfile change on request.
   - Or submit a contract change request where the published shape is wrong. Silent divergence is not an option.
2. Owners verify the caller through Identity:
   - `principal` routes accept account **and** guest principals;
   - `service:*` routes accept only workload tokens with that scope (P02-E2).
3. Owners register the PostgreSQL (and broker) readiness probe when `businessReady` becomes true (P01-E2 rule).
