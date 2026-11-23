# CR-P04-C1: `scheduling.v1` additions for booking commitment changes

**To:** Lane E (owner of `@carwash/contracts`, `docs/asyncapi`, gateway, CI and infra).
**From:** Lane C, P04-C1 (provider implemented, PR linked from P04-C).
**Kind:** additive, backward-compatible addition to `scheduling.v1`. No existing route, field or event changes.

## 1. Routes to publish in `SCHEDULING_V1.routes`

```ts
releaseCommitment: {
  method: 'POST', path: '/bookings/:bookingId/commitment/release',
  access: 'service:scheduling.commitment.change', idempotent: true,
},
replaceCommitment: {
  method: 'POST', path: '/bookings/:bookingId/commitment/replace',
  access: 'service:scheduling.commitment.change', idempotent: true,
},
```

## 2. Types and parsers (closed objects, the same conventions as `CommitHoldRequestV1`)

```ts
export interface ReleaseCommitmentRequestV1 { readonly holdId: string }
export interface ReplaceCommitmentRequestV1 {
  readonly fromHoldId: string; readonly toHoldId: string; readonly toExpectedRevision: number;
}
export interface CommitmentReplacementV1 {
  readonly bookingId: string; readonly released: HoldV1; readonly committed: HoldV1;
}
```

**Response invariants.** `released.state === 'RELEASED'`, `released.bookingId === null`, `committed.state === 'COMMITTED'` and `committed.bookingId === bookingId`.

## 3. Reasons

Add `COMMITMENT_NOT_FOUND` (409 `CONFLICT`) to `SCHEDULING_V1.reasons`.

## 4. Workload identity

Add scope `scheduling.commitment.change`, granted to the `booking` workload only. Until workload identity is published (CR-P02-C3), the interim service-client configuration applies:

```
SCHEDULING_SERVICE_CLIENTS=[{"id":"booking","tokenSha256":"…","scopes":["scheduling.hold.commit","scheduling.commitment.change"]}]
```

## 5. Events

No new event. `scheduling.hold-changed.v1` already models the result.

- A replace emits one `RELEASED` for the old hold and one `COMMITTED` for the new hold.
- AsyncAPI should state that events of **different** holds from one change carry no relative ordering guarantee.

## 6. Gateway

None. The routes are service-to-service and must not be exposed by the gateway.
