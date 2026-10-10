# P04-E2 — Gateway payment routes and provider-notification ingress

Parent: **P04-E** (parent status: **INTEGRATION_PENDING**). Lane E.
Child: P04-E2. It changes the Gateway routing contract and the Gateway runtime.
It adds no business state: the Gateway still owns no data.

## 1. Routes

### Customer payment step (`/api/v1/customer/payments/...`, owner `billing`)

| Route id | Method and path | Upstream (`/internal/v1/billing`) | Permission | Idempotency |
| --- | --- | --- | --- | --- |
| `customer.payments.create` | POST `/customer/payments` | `/obligations` | `bookings.create:self` | required |
| `customer.payments.read` | GET `/customer/payments/:id` | `/obligations/:id` | `bookings.read:self` | — |
| `customer.payments.status` | GET `/customer/payments/:id/status` | `/obligations/:id/financial-status` | `bookings.read:self` | — |
| `customer.payments.method` | POST `/customer/payments/:id/method` | `/obligations/:id/payment-intents` | `bookings.create:self` | required |
| `customer.payments.reference` | POST `/customer/payments/:id/transaction-reference` | `/obligations/:id/payment-attempts` | `bookings.create:self` | required |
| `customer.payments.refunds` | GET `/customer/payments/:id/refunds` | `/obligations/:id/refunds` | `bookings.read:self` | — |

- Guests hold `bookings.*:self`, so guest checkout works.
- Billing still checks the object owner. The Gateway never decides ownership.
- `customer.payments.create` is the P02 interim. When workload identity lands,
  the Booking saga creates the obligation through `service:billing.obligation.write`.

### Finance (`/api/v1/admin/billing/...`)

The paths follow Lane D's CR-D-P03 requests, which the admin console already calls.

| Route id | Method and path | Upstream | Permission |
| --- | --- | --- | --- |
| `admin.billing.obligation` | GET `/admin/billing/obligations/:id` | `/obligations/:id` | `billing.read` |
| `admin.billing.reconcile` | POST `/admin/billing/payment-attempts/:id/reconciliation` | `/payment-attempts/:id/reconciliation` | `billing.reconcile` |
| `admin.billing.refunds.list` | GET `/admin/billing/obligations/:id/refunds` | `/obligations/:id/refunds` | `billing.read` |
| `admin.billing.refunds.request` | POST `/admin/billing/obligations/:id/refunds` | `/obligations/:id/refunds` | `billing.refund` |
| `admin.billing.refund` | GET `/admin/billing/refunds/:id` | `/refunds/:id` | `billing.read` |
| `admin.billing.refund.outcome` | POST `/admin/billing/refunds/:id/outcome` | `/refunds/:id/outcome` | `billing.reconcile` |

- **Retired:** `admin.refund` (POST `/admin/billing/:id/refund`). It pointed at an
  upstream that never existed.
- `admin.billing` (GET `/admin/billing` → `/billing/summary`) is **kept**. It is
  part of the `admin.overview` composition, whose replacement belongs to Lane D.
  It remains a routing contract only.

### Provider-notification ingress (`providerIngress: true`)

| Route id | Path | Upstream |
| --- | --- | --- |
| `payments.provider.sham-cash` | POST `/payments/provider-notifications/sham-cash` | `/provider-notifications/sham-cash` |
| `payments.provider.syriatel-cash` | POST `/payments/provider-notifications/syriatel-cash` | `/provider-notifications/syriatel-cash` |

The Gateway authenticates nothing on these routes. The owner (Billing) verifies
the provider's signature over the exact bytes and de-duplicates by the signed
notification id. The Gateway's own guarantees are:

- **Byte-identical forwarding.** The bytes are captured by the body parser
  (`rawBody: true`) and sent without re-serialising, so a valid signature still
  verifies.
- **Allowed content types:** `application/json` and
  `application/x-www-form-urlencoded`. Anything else returns 400.
- **Size limits:** an empty body returns 400; more than 16 KiB
  (`PROVIDER_INGRESS_MAX_BYTES`) returns 413.
- **Forwarded headers:** only `content-type`, the three `x-provider-*` headers
  (each at most 512 bytes) and the Gateway's own request id, correlation id and
  `traceparent`.
- **Never forwarded:** cookies, `Authorization`, `x-auth-*`, `Origin`,
  `X-Forwarded-*` or an `Idempotency-Key`.
- **No CSRF/origin check.** These are server-to-server calls. A browser cannot
  send the custom `x-provider-*` headers cross-origin without a CORS preflight,
  and the Gateway answers none.
- **Owner refusals pass through:** an owner 401 becomes the Gateway's 401
  `AUTH_REQUIRED`, and an owner 204 stays 204.
- **Closed path set.** Other providers, and GET on these paths, return 404.

## 2. Error envelope

- **`reason` (additive, optional).** For 409, 412 and 422, the owner's error code
  is forwarded as `reason` **only if** it appears in that owner's **merged**
  contract `reasons` (`OWNER_CONTRACTS`).
  - Billing's reasons start flowing automatically once P04-E1 (`billing.v1`)
    merges. This PR does not depend on that branch.
  - An unpublished code, such as a database error, is never forwarded.
- **412 maps to `CONFLICT`, not 502** (CR-D-P03-08). A stale `expectedRevision`
  is a conflict the client resolves by re-reading.
- **A timeout stays 504 `UPSTREAM_TIMEOUT`**, with one attempt and no retry.
  The outcome of a payment command after a timeout is unknown. The client
  repeats it with the **same** `Idempotency-Key`.

## 3. Evidence (this head)

| Family | Command | Result |
| --- | --- | --- |
| Gateway payments and ingress: real Nest 12 Gateway, loopback test owners recording exact bytes | `node --test tests/production/E/gateway-payments.test.mjs` | PASSED 7/7 |
| Existing Gateway unit suite (F007) | `node --test tests/gateway/unit.test.mjs` | PASSED 25/25 |
| Lane E suite + registry | `node --test tests/production/E/*.test.mjs tests/unit/x003-contract-registry.test.mjs` | PASSED (103 in total, with the Gateway suite) |
| Gateway OpenAPI matches the routing contract | `node scripts/gateway-openapi.mjs` | PASSED |
| Owner contract documents and surface lock | `check:contract-docs`, `check:contract-surface` | PASSED, unchanged |
| Build, eslint, prettier | `tsc` (contracts, api-gateway), eslint, prettier | PASSED |
| Real Billing behind the Gateway (payments, refunds, notifications) | — | **Pending P04-E4.** Refund and notification routes have no provider until P04-B merges, so they answer 404 until then. |
| Real Identity + PostgreSQL Gateway acceptance (F007 `acceptance:gateway`) | CI | Not run locally: the machine had about 0.6 GB of free memory. These routes do not change that suite's paths. |

What the test owners prove, and what they do not:

- The stubs record exactly what the Gateway sends.
- One stub verifies an HMAC over the bytes it received, which proves the
  Gateway keeps a provider signature valid and that a tampered body fails.
- They are not Billing. Billing's own verification and durable de-duplication
  are P04-B's responsibility and are certified in P04-E4.

## 4. Security notes

- Separation of duties at the edge: neither `billing.read` nor `billing.refund`
  reaches reconciliation or refund outcomes. Only `billing.reconcile` does.
  Billing additionally refuses the requester and the obligation owner.
- The provider ingress is the only POST without a principal. It is closed by
  path, method, content type, size and header allowlist.
- **Gap: rate limiting.** The Gateway has no rate limiter; a POST flood on the
  ingress is bounded only by the size limit and the owner's cheap signature
  check. An edge rate limit belongs to deployment and is tracked as
  E-P04-GW-RL. It is not claimed here.

## 5. Rollback

Revert the PR:

- The new routes disappear and `admin.refund` returns. It pointed at nothing.
- Removing `rawBody` and the urlencoded parser restores the JSON-only Gateway.
- `reason` disappears from the error envelope.
