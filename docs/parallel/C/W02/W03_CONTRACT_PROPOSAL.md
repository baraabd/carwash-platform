# W02-C next-wave Scheduling and Booking proposal

Status: **PROPOSED / NOT ACCEPTED / NO PRODUCT ENDPOINTS IMPLEMENTED**.
Task: W02-C; future consumer wave: W03. Inspected source:
`main@3db1afdd04c6ec65a38ca83f3993c964a1bf7587`; this is not `BASE_W02`.
This packet supplements `../W01/CONTRACT_REQUESTS.md` sections 3 and 7; it
does not start W03, publish shared exports, approve policy or replace that packet.

## Ownership and acceptance prerequisites

Scheduling owns capacity windows, holds, expiry and reservation commit/release.
Booking owns immutable booking snapshots, lifecycle, durable sagas and outcomes.
Pricing/B owns authoritative quotes, duration, money and price validation;
Billing/B owns obligations, payment conditions and financial compensation.
Customer/Vehicle/Geo/A owns beneficiary snapshots, vehicle relationships and
coverage inputs; Identity/Gateway/contracts/E owns authentication, verified guest
binding, service delegation, current scoped permissions and public transport.
Workforce/C supplies current eligibility/resource/shift facts through accepted
contracts. Gateway and admin own no business records.

E, B and A must review the beneficiary-context extension before acceptance.
E publishes exact schemas/parsers, versions, routes, clients, producer ACLs,
compatibility evidence and the next immutable common base. No moving peer branch,
private DTO, peer Prisma client or cross-owner database can satisfy this dependency.

## Common proposed vocabulary

```ts
type Ref = { owner: string; id: string; revision: number };
type UTC = string; // validated YYYY-MM-DDTHH:mm:ss.sssZ instant
type BeneficiaryContext = {
  contextId: string; revision: number;
  kind: 'CUSTOMER' | 'GUEST'; bindingRef: Ref;
};
type Operation = { operationId: string; revision: number; state:
  'PENDING' | 'SUCCEEDED' | 'REJECTED' | 'COMPENSATING' | 'RECOVERY_REQUIRED' };
```

IDs, safe positive revisions, bounded fields and exact-key parsing follow the
accepted common profile; the pseudocode above is not a current exported type.
The trusted context is resolved from current E/A authority, not a caller-written
subject, email, phone or scope. Guest conversion/expiry cannot silently transfer
ownership. Store only approved immutable snapshot fields and source revisions.
Contact and location snapshots are private; optional plate remains optional.

## Quote, capacity and hold contracts

Add a reviewed beneficiary-context reference to B's W01 quote proposal. Pricing
derives amount/currency/scale, service/add-on versions, duration, expiry and policy
refs. No client amount, discount or duration override becomes authority. Exact
money vocabulary must be reconciled with B's accepted schema, not forked here.

| Proposed operation | Request | Result and invariant |
| --- | --- | --- |
| Availability read | `{beneficiaryContextRef, quoteRef, zoneRef, interval:{startsAt,endsAt}, resourceRequirements}` | `{serverTime, expiresAt, windows:[{windowId,revision,startsAt,endsAt,capacityStatus,requirementsRef}]}`; an indication, never guaranteed capacity. |
| Create hold | `{bookingIntentId, beneficiaryContextRef, quoteRef, zoneRef, windowRef, requirementsRef}` | `{holdId,revision,state:"HELD",beneficiaryContextRef,quoteRef,startsAt,endsAt,expiresAt}`; Scheduling rechecks current quote duration, coverage and resource facts, then atomically claims capacity. |
| Commit hold | `{holdId,expectedRevision,bookingRef,sagaId}` | `{reservationId,revision,state:"COMMITTED",holdRef,bookingRef,startsAt,endsAt}`; only a valid unexpired hold for the same beneficiary/quote may commit. |
| Release hold/reservation | `{resourceRef,expectedRevision,reasonCode,sagaId}` | `{resourceRef,state:"RELEASED",releasedAt,operation}` or its recorded terminal outcome; duplicate release/expiry cannot restore capacity twice. |
| Read hold/reservation | `{resourceRef}` | Current revision, state, associated booking/context refs, authoritative expiry and any recovery operation; object authorization applies to reads and replay. |

Pricing Quote, Scheduling Hold and Booking must refer to the **same validated
beneficiary context**. For administrative creation, the admin actor remains
distinct throughout. E's accepted delegation binds initiating actor, beneficiary,
operation, resource, audience and expiry; ordinary service credentials or forged
headers are insufficient. Pricing and Scheduling independently validate the
accepted delegation and current owner relationships before issuing authority.
Same administrative actor with a different beneficiary cannot reuse a hold/quote.

Instants are UTC; presentation and local availability interpretation carry the
approved IANA timezone and policy revision. Define local interval ambiguity,
overnight normalization, precision, rounding, clock/skew and boundary rules in the
accepted contract. TTLs, business hours, capacity limits, Aleppo coverage and
freshness policies remain owner inputs; F010 capture time is not market policy.
Scheduling serializes last-slot and expiry-versus-commit races in its real DB.
An expired hold or late payment cannot resurrect capacity; acquire new authority.

## Separate self and administrative Booking commands

The existing W01 self-create proposal derives customer/guest binding from the
authenticated self context; its request never selects another beneficiary.
Do not weaken that clause to support administrative creation. Add a distinct
proposed `booking.create-on-behalf.v1` command and E-published route/permission.

```ts
type SelfCreateRequest = {
  bookingIntentId: string; quoteRef: Ref; holdRef: Ref;
  vehicleSnapshotRef?: Ref; plate?: string; locationSnapshotRef: Ref;
  contactSnapshotRef: Ref; consentRef: Ref; paymentMethod: string;
};
type AdminCreateOnBehalfRequest = SelfCreateRequest & {
  beneficiary: { kind: 'CUSTOMER' | 'GUEST'; bindingRef: Ref };
  expectedBeneficiaryContextRevision: number;
  reason: { code: string; text: string };
};
type CreateResult = {
  bookingId: string; revision: number; lifecycleState: string;
  beneficiaryContextRef: Ref; quoteSnapshotRef: Ref;
  capacity: { reservationRef?: Ref; state: string };
  payment: { obligationRef?: Ref; state: string };
  saga: Operation; auditRef: Ref;
};
```

Booking resolves the administrative actor from current Identity authorization,
requires the accepted scoped create-on-behalf permission and records actor,
session/auth version, beneficiary context, reason, source revisions and server
time in immutable audit. No actor/token/role field is accepted from the request.
Reason codes, bounds and mandatory copy require owner policy/design acceptance.
Both commands run the same Quote/Hold/Booking validation, including current
beneficiary/vehicle/location/contact/consent authority and payment policy. Admin
cannot impersonate a beneficiary, grant itself ownership, override price, skip
guest consent or force confirmation. Support/finance role names are not authority.
Assignment, work execution, payment receipt and cash custody remain independent
facts; creation never fabricates them as successful defaults.

## Idempotency, recovery and events

Every mutation uses an accepted `Idempotency-Key`; uniqueness includes owner,
contract major, real initiating actor, operation and target/booking intent. The
canonical fingerprint includes beneficiary context, reason, expected revisions,
quote/hold and relevant policy refs; omit transport IDs, cookies and CSRF tokens.
Same key/fingerprint replays the original receipt after current authorization;
changed beneficiary/reason/payload conflicts. Exact replay/tombstone lifetimes
require policy approval; durable booking-intent uniqueness survives replay expiry.

Booking persists saga steps, deadlines, provider command identities and outcomes.
A timeout is an unknown outcome: return/discover the same operation rather than
retry as a new booking. Resume after crash by querying accepted provider receipts.
Compensate through Scheduling release and Billing obligation cancellation/refund
under B's policy; no peer DB rollback. Failed compensation remains recoverable
and visible, never a fabricated successful rejection or confirmation. Quote and
booking snapshots remain immutable; repeat/reschedule obtains current authority.

Retain reserved `scheduling.hold-created.v1` and `scheduling.hold-expired.v1`;
propose versioned reservation commit/release and Booking saga-outcome events.
Exact payloads include owner ID/revision, outcome, source refs and server time,
without private contact/document content. E must register producer/consumer ACLs
and parsers. Preserve the existing strict `booking.confirmed.v1` payload; guest
support requires a reviewed new event/version, not widening old required fields.
Owner state/audit/outbox commit together; inbox/effect commit before ACK. Duplicate
bytes are no-op; changed bytes, older revisions and gaps follow accepted recovery.

## Current gaps, required proof and downstream handoff

`packages/contracts/src/identity.ts` exports `bookings.create:self` only; no
create-on-behalf permission or fine-grained beneficiary scope exists.
`packages/contracts/src/gateway.ts` has customer Booking creation only, no admin
creation/hold routes; `packages/api-clients/src/index.ts` is a skeleton. Gateway
descriptors are not implemented owner endpoints. E must publish the prerequisite
contracts rather than C editing shared files or borrowing `operations.dispatch`.

Prove real provider DB/HTTP/Identity tests first, then Booking integration:
last-slot/expiry races, quote/beneficiary mismatch, optional plate, guest expiry,
cross-beneficiary denial, scoped/revoked admin, stale revisions, duplicate/conflict
commands, restart/unknown outcome, compensation failure, repeated events and
immutable actor-versus-beneficiary audit. Existing error envelopes remain stable;
E reviews adapters for revision/idempotency/expiry/dependency error semantics.

B payment-evidence authorization and D reviewer/roster examples from **actual
endpoints are pending** accepted Media/Workforce binding/provider implementation.
Proposed W01 examples remain contract fixtures, never real HTTP evidence. After
provider acceptance, record request/result, principal scope, denial cases and
exact source/contract versions without secrets. D's full review browser belongs
to W03; its absence does not replace W02's required real authorized review API.
The admin prototype's manual-booking modal lacks location/payment/capacity/reason
and beneficiary-selection states; D/owner must approve production behavior.
