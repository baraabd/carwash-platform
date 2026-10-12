# CR-P05-C1 — Workforce operational profile (request to Lane E)

Requester: Lane C (P05-C / C1). Implementation: `services/workforce`
(`src/transport/http/operator-profile.controller.ts`).
Lane C does not edit `packages/contracts`, `packages/api-clients`, the gateway,
lockfiles or CI. Every item below is **requested / provider-implemented**; nothing
claims to be published until Lane E merges a versioned contract.

## 1. HTTP additions to `workforce.v1` (prefix `/internal/v1/workforce`)

| Operation | Method | Path | Access |
| --- | --- | --- | --- |
| `getMyProfile` | GET | `/me/profile` | `user:work.read:assigned` (own subject) |
| `setMySchedule` | PUT | `/me/schedule` | `user:work.execute:assigned` |
| `applyMySchedule` | POST | `/me/schedule/apply` | `user:work.execute:assigned` |
| `createMyAvailabilityException` | POST | `/me/availability-exceptions` | `user:work.execute:assigned`, `Idempotency-Key` |
| `cancelAvailabilityException` | POST | `/availability-exceptions/:id/cancel` | owner (`work.execute:assigned`) or `operations.dispatch` |
| `reportMyEquipment` | PUT | `/me/equipment/:kind/status` | `user:work.execute:assigned` |
| `getOperatorProfile` | GET | `/operators/:id/profile` | `user:operations.dispatch` |
| `setServiceArea` | PUT | `/operators/:id/service-area` | `user:operations.dispatch` |
| `createOperatorAvailabilityException` | POST | `/operators/:id/availability-exceptions` | `user:operations.dispatch`, `Idempotency-Key` |
| `registerEquipment` | POST | `/operators/:id/equipment` | `user:operations.dispatch` |
| `setEquipmentRequirement` | PUT | `/operators/:id/equipment/:kind` | `user:operations.dispatch` |
| `reportOperatorEquipment` | PUT | `/operators/:id/equipment/:kind/status` | `user:operations.dispatch` |

Closed wire shapes (UTC instants as `YYYY-MM-DDTHH:mm:ss.sssZ`):

```ts
type ReadinessReasonV1 = 'EMPLOYMENT_INACTIVE' | 'SUSPENDED' | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_EXPIRED' | 'NO_SKILLS' | 'EQUIPMENT_UNAVAILABLE';
interface WeeklyWindowV1 { weekday: 1|2|3|4|5|6|7; startMinute: number /*0..1439*/;
  endMinute: number /*1..1440, >= start+15*/; zoneId: Uuid }
interface WeeklyScheduleV1 { timeZone: string /*IANA*/; windows: WeeklyWindowV1[] /*<=28*/;
  revision: number /*0 = never set*/; updatedAt: UtcTimestamp | null }
interface ServiceAreaV1 { homeZoneId: Uuid; zoneIds: Uuid[] /*incl. home, <=20*/;
  revision: number; updatedAt: UtcTimestamp | null }
type ExceptionReasonV1 = 'LEAVE' | 'SICKNESS' | 'EQUIPMENT' | 'PERSONAL' | 'OTHER';
interface AvailabilityExceptionV1 { exceptionId: Uuid; startsAt: UtcTimestamp; endsAt: UtcTimestamp;
  reason: ExceptionReasonV1; status: 'ACTIVE' | 'CANCELLED'; version: number }
type EquipmentKindV1 = 'SERVICE_VEHICLE' | 'PRESSURE_WASHER' | 'WATER_SUPPLY' | 'POWER_SUPPLY'
  | 'VACUUM' | 'CLEANING_KIT';
interface EquipmentV1 { kind: EquipmentKindV1; required: boolean;
  status: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  issue: 'BREAKDOWN' | 'MAINTENANCE' | 'MISSING' | 'SUPPLIES_EMPTY' | 'OTHER' | null; // null iff READY
  revision: number; updatedAt: UtcTimestamp }
interface ShiftSlotV1 { shiftId: Uuid; zoneId: Uuid; startsAt: UtcTimestamp; endsAt: UtcTimestamp }
interface OperatorProfileV1 {
  operatorId: Uuid; displayName: string; employmentStatus: 'ACTIVE' | 'INACTIVE'; suspended: boolean;
  verification: { status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
    verifiedUntil: UtcTimestamp | null;
    latestCase: { caseId: Uuid; status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
      submittedAt: UtcTimestamp; decidedAt: UtcTimestamp | null; decisionReason: string | null } | null };
  skillCodes: string[]; readiness: { ready: boolean; reasons: ReadinessReasonV1[] };
  availability: { status: 'AVAILABLE' | 'ON_BREAK'; revision: number; updatedAt: UtcTimestamp | null };
  serviceArea: ServiceAreaV1; schedule: WeeklyScheduleV1;
  upcomingShifts: ShiftSlotV1[];             // ACTIVE, next 14 days
  exceptions: AvailabilityExceptionV1[];     // ACTIVE, overlapping the next 14 days
  equipment: EquipmentV1[]; version: number; asOf: UtcTimestamp }
```

Requests: `PUT /me/schedule {timeZone, windows, expectedRevision}`;
`POST /me/schedule/apply {startDate: 'YYYY-MM-DD' (local, today..today+56), expectedRevision >= 1}`
→ `{created: ShiftSlotV1[], existing: ShiftSlotV1[], skipped: {weekday, startMinute, zoneId,
startsAt, endsAt, reason: 'PAST'|'EXCEPTION'|'OVERLAPS'|'ZONE_OUTSIDE_SERVICE_AREA'}[]}`;
exceptions `{startsAt, endsAt, reason}` (<= 31 days, start >= now - 5 min, <= 180 days ahead);
equipment status `{status, issue, expectedRevision}`; requirement `{required, expectedRevision}`;
registration `{kind, required}`; service area `{zoneIds, expectedRevision}`.

Errors (shared envelope; domain code in `reason`):

| Case | Status | `code` / `reason` |
| --- | --- | --- |
| stale revision (schedule, area, equipment) | 409 | `CONFLICT` / `REVISION_CONFLICT` |
| zone not in service area | 409 | `CONFLICT` / `ZONE_OUTSIDE_SERVICE_AREA` |
| suspended or inactive operator declares work | 409 | `CONFLICT` / `OPERATOR_NOT_ACTIVE` |
| apply without schedule | 409 | `CONFLICT` / `SCHEDULE_NOT_SET` |
| overlapping ACTIVE exception | 409 | `CONFLICT` / `EXCEPTION_OVERLAPS` |
| cancel a cancelled/ended exception | 409 | `CONFLICT` / `EXCEPTION_NOT_ACTIVE` |
| exception of another technician / unknown | 404 | `NOT_FOUND` / `EXCEPTION_NOT_FOUND` |
| equipment kind not registered | 404 | `NOT_FOUND` / `EQUIPMENT_NOT_FOUND` |
| equipment kind already registered | 409 | `CONFLICT` / `EQUIPMENT_EXISTS` |
| reused `Idempotency-Key` with other body | 409 | `IDEMPOTENCY_CONFLICT` / `IDEMPOTENCY_KEY_REUSED` |

## 2. Semantics change of the published `workforce.v1.listCapacityResources`

No shape change. Behaviour: `shifts[]` are now the ACTIVE shifts **minus ACTIVE
availability exceptions** (a shift may be returned as two pieces). `eligibility`
gains one more input (a REQUIRED equipment item that is UNAVAILABLE ⇒ `INELIGIBLE`),
and `workforce.eligibility-changed.v1` is emitted when that input moves, exactly as
for the existing inputs. Consumers (Scheduling, Dispatch) need no change: Dispatch
already refuses an offer without a covering shift and withdraws on `INELIGIBLE`.
Lane E is asked to record this in the contract notes.

## 3. Gateway BFF routes for operator-web (extends CR-P03-C5)

| Browser route | Upstream |
| --- | --- |
| `GET /api/operator/profile` | Workforce `GET /me/profile` |
| `PUT /api/operator/schedule` | Workforce `PUT /me/schedule` |
| `POST /api/operator/schedule/apply` | Workforce `POST /me/schedule/apply` |
| `POST /api/operator/availability-exceptions` | Workforce `POST /me/availability-exceptions` (forward `Idempotency-Key`) |
| `POST /api/operator/availability-exceptions/:id/cancel` | Workforce `POST /availability-exceptions/:id/cancel` |
| `PUT /api/operator/equipment/:kind/status` | Workforce `PUT /me/equipment/:kind/status` |
| `GET /api/operator/custody` | Billing `GET /custody/holders/me` (published `billing.v1.getMyCustody`) |

## 4. Not requested here (recorded gaps)

- `workforce.capacity-changed.v1`: capacity changes from exceptions/schedules are
  visible on the next capacity read only. No push event exists; assigned work inside
  a new exception is not moved automatically (operations decide).
- A Billing "list my cash receipts" route (Lane B) for a server-side collections history.
