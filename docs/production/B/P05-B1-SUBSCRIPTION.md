# P05-B1 — Subscription: plans, subscriptions and entitlement reservations

**Status: review required.**

- **Parent P05-B:** INTEGRATION_PENDING.
- **Not:** production-ready, deployed or integrated. No money is collected by Subscription.
- **Not called by any consumer yet:** no Booking saga, Gateway route or UI calls it.

| | |
| --- | --- |
| Base | `main` `3e1ab23bff450235858ea13e049f8fb373df393f`, refreshed 2026-10-11. The audited `f875d31` and the first refresh `66aa752` were stale. |
| Scope | `services/subscription/**`, `scripts/production/B/postgres-acceptance.mjs`, `docs/production/B/**` |
| Migration | `20261011100000_p05b_subscription_entitlements` (expand-only on top of the W01 marker) |
| Contracts | None consumed or changed in shared packages. Requests are in `CONTRACT_REQUEST_E_SUBSCRIPTION.md` (CR-B-10.1–.6). |
| Evidence | `docs/production/B/evidence/subscription-postgres-ac271ba8c3c5.json` (code commit `ac271ba8c3c592c5631eb1fa8b3b91a8d5db101b`, tree `d60f96866e24a3a12b10432c39fe55ae180d0a4b`, clean) (real PostgreSQL 16.10, runtime role) |

## Design

**Plans.** A plan is a stable code (`^[a-z][a-z0-9-]{2,40}$`) with one linear chain of immutable revisions.

- **Each revision states, as data published by staff:** display name, exact price (`SYP`/`USD`, scale 2), wash units per period, period length in days, covered catalog packages, and `available`.
- **No value is a code default.** Owner decision B-09 is recorded by publishing a revision, and nothing can be bought before one exists.
- **Effective times strictly increase**, with optimistic `expectedRevision`. A database guard enforces the chain.

**Subscriptions.** A customer (an account, never a guest) requests the plan revision in force. The request snapshots its terms; a database guard keeps the snapshot equal to the referenced revision.

- **Activation and renewal.**
  - Staff activate after verifying payment in Billing. The opaque Billing reference funds **exactly one period** (unique constraint).
  - Renewal starts the next period only after the current one has ended, on the revision in force at renewal.
  - Periods never overlap, and unused units are not carried over, because no rollover policy is approved.
- **Freeze** blocks new reservations only.
- **Cancel:** staff may cancel any open subscription. A customer may withdraw only their own request that was never activated; refunding a paid plan is Billing/B-06.
- **EXPIRED is derived:** a current period that has ended.
- **There is no automatic renewal or debit.**

**Entitlements.** A period grants N units. Units move by append-only movements:

| Movement | reserved | consumed |
| --- | --- | --- |
| GRANT | — | — (adds the grant) |
| RESERVE | +1 | |
| COMMIT | −1 | +1 |
| RELEASE | −1 | |
| REVERSE | | −1 |

- **Invariant**, checked in the domain, by CHECK constraints and by a COMMIT-time assertion:
  - `0 ≤ reserved`, `0 ≤ consumed`;
  - `reserved + consumed ≤ granted`;
  - each counter equals the sum of the period's movements;
  - each reservation's movements exactly match its status.
- **Every movement has a total order** (`seq`), so the ledger reconciles deterministically even when timestamps tie.

**Booking saga** (service credential `x-service-client`/`x-service-token` through the P04-E3 `ServiceClientAuthenticator`, deny by default).

- **Reserve** `{subscriptionId, bookingId, customerSubject, packageId, scheduledFor}`.
  - It succeeds only when:
    - the subscription is active;
    - the period has not ended;
    - `scheduledFor` falls inside the period;
    - the package is covered;
    - a unit is available.
  - **Idempotent on (subscription, booking):** a retry returns the same reservation and can never take a second unit.
  - **A booking holds at most one live unit across all subscriptions.**
  - **Booking acts for one customer:** another customer's subscription is `404`.
- **Commit** when the wash is delivered; **release** on any cancellation or failure (compensation). Repeating a settlement already done is a replay.
- **Settling after cancellation:** reservations made before the subscription was cancelled can still be committed or released, so in-flight bookings are not stranded.
- **Staff reversal** returns a consumed unit. It is audited, receipt-idempotent, and never allowed on the reviewer's own subscription.

**Concurrency.**
- **Reservations serialise on the subscription row lock.** The last unit can be reserved once only, and the database refuses an over-grant even without the application.
- **When the store cannot start a transaction in time**, the answer is `503 SERVICE_BUSY`: nothing was changed and the same request can be retried. A timeout is never turned into success.

**Events** (outbox, same transaction; relay not started until E registers them):
- `subscription.subscription-changed.v1`
- `subscription.entitlement-reserved.v1`
- `subscription.entitlement-reservation-changed.v1`

They carry no payment reference, price paid, name or phone. Each envelope is self-validated through the shared envelope v2 parser.

**Security.**
- Staff need `subscription.manage`, requested from E (CR-B-10.1); until it is granted every staff call returns 403.
- Customers use `bookings.create:self`.
- Identity is asked on every request and fails closed: 503 when unreachable, never anonymous.
- **Not exposed to customers:** the funding payment reference.
- **Non-owners** get 404 on a subscription.
- **Service tokens** are compared constant-time against SHA-256 digests. They are never logged or echoed.

## API

Routes, access and codes: `CONTRACT_REQUEST_E_SUBSCRIPTION.md` (CR-B-10.2).

## Test evidence

| Family | Result |
| --- | --- |
| Domain/unit: terms, revisions, lifecycle, reservation rules, movements, transitions, event self-validation | **PASSED** (8) |
| Nest composition: routes mounted, 401 without credential, 503 without Identity origin, 401 without configured service client, malformed client config stops startup, readiness 503 | **PASSED** (11) |
| **Real PostgreSQL 16.10**, runtime role, 2 replicas: `node scripts/production/B/postgres-acceptance.mjs --service subscription --record` | **PASSED 12/12**: see the evidence file |
| Upgrade from the W01 history (marker kept), re-provision, schema mirror drift | **PASSED** |
| typecheck, build, ESLint, Prettier, design reference and reference lock, boundaries, layers, service shells, migrations, ownership, contract docs and surface | **PASSED** |
| Real RabbitMQ | **BLOCKED**: events not registered by E (CR-B-10.3) |
| Booking saga against the real Booking | **BLOCKED**: Lane C consumer and CR-B-10.4 |
| Playwright / visual | **NOT APPLICABLE**: no UI. The subscription screens are not designed (DESIGN_LOCK §7) |

**Races proven on real PostgreSQL:**
- 8 concurrent bookings across two replicas for the last unit, 5 rounds: exactly one succeeds;
- 6 concurrent identical reserves: one reservation and one unit taken;
- a concurrent commit against a release on one reservation: exactly one wins.

**Negative cases:**
- guest, other customer, reader and unknown token;
- self-activation and self-reversal;
- a reused payment reference;
- a second open subscription;
- a stale version;
- a package not covered;
- a booking outside the period;
- an ended period;
- a frozen subscription;
- a cancelled subscription;
- an unconfigured, wrong-scope or user-token service caller;
- Booking acting for another customer.

**Direct-SQL attacks** (runtime role):
- a counter without a movement;
- an over-grant;
- a grant edit;
- an illegal reservation transition;
- a status without its movement;
- a forged extra movement;
- deleting a movement or a reservation;
- truncating audit;
- tampering with terms;
- a period jump;
- an overlapping period.

**Real vs mocked.**
- **Real:** PostgreSQL, with separate migration and runtime roles, and the shared service-credential authenticator.
- **Local HTTP double:** Identity.
- **Not used:** a broker or the Booking service.

## Rollback and compensation

- **Code:** revert the PR.
- **Schema, before any row exists:** drop the P05-B1 objects in reverse order.
- **Schema, after rows exist:** a reviewed data plan is required.
- **Business compensation:** release (booking failed or cancelled), reversal (consumed by mistake) and cancel (a request withdrawn or a payment not received).

## Blockers

| ID | Blocker | Owner |
| --- | --- | --- |
| B-P05-11 | `subscription.manage` permission and staff role grants (CR-B-10.1) | E |
| B-P05-12 | `subscription.v1` routes, Gateway aliases, event registration, relay (CR-B-10.2/.3/.5) | E |
| B-P05-13 | Booking saga integration: reserve, commit and release (CR-B-10.4) | C (after E) |
| B-P05-14 | Billing plan-purchase obligation, so activation is verified automatically (CR-B-10.6) | B + E, owner B-09 |
| B-P05-15 | Owner decision B-09: real plans, prices, units, rollover, freeze extension, refunds | Owner |
| B-P05-16 | Customer and admin subscription screens (not designed) | Owner design, then A/D |

**Next consumers:**
- the Booking saga (Lane C);
- the admin console (Lane D) after an approved design;
- Billing, for plan-purchase linkage.
