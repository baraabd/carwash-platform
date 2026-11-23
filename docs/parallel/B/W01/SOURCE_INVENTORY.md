# Source-derived finance inventory

Audit source: `69d81a83a3409d0693272efeb19ebeb9805750f5`, tree
`1988caa3f882bc0c6007ae830950b7f34f53d294`. All paths below refer to this source.
Tests in this inventory were inspected, not executed as finance acceptance.

## Ownership authority

`architecture/service-catalog.json` schema version 2 and
`architecture/adr/F001-monorepo-and-data-ownership.md` override older grouping in
`docs/ARCHITECTURE_AR.md`, `docs/adr/0003-money-and-identity.md` and service READMEs.

| Owner        | Data authority                                           | Conflicting historical statement                                   |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Catalog      | Packages, add-ons, compatibility, durations              | Catalog README/older ADR assign quotes, prices and promotions here |
| Pricing      | Price versions, expiring quotes, promotions              | Historical Catalog quote helper is still in its old path           |
| Billing      | Payments, cash receipts, refunds, posted journals        | Billing README/architecture group subscriptions here               |
| Wallet       | Balances/holds/movements with Billing posting references | Older grouping collapses these into Billing                        |
| Subscription | Customer subscriptions and entitlement reservations      | Older grouping places entitlements inside Billing                  |
| Booking      | Durable booking orchestration                            | Older text also groups capacity here                               |
| Scheduling   | Capacity, reservations and expiring capacity holds       | F001 supersedes the older grouping                                 |

These discrepancies are submitted to E for source-derived aggregate/ADR updates.
W01-B does not change those reserved files or move/copy private implementations.

## Implementation, schemas and endpoints

| Service      | Actual business state                                                             | Source evidence                                                                                                           |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Catalog      | Health-only Nest shell, `BUSINESS_READY=false`; no commerce controllers/models    | `services/catalog/src/app.module.ts`; `prisma/schema.prisma` contains `ServiceMarker`, `FoundationProbe`, `OutboxMessage` |
| Billing      | Health-only Nest shell, `BUSINESS_READY=false`; no payment/refund/journal models  | `services/billing/src/app.module.ts`; `prisma/schema.prisma` contains `ServiceMarker` only                                |
| Pricing      | `export {}` TypeScript skeleton; no listener, Prisma/migrations or business tests | `services/pricing/src/index.ts`, `package.json`                                                                           |
| Wallet       | Same skeleton-only state                                                          | `services/wallet/src/index.ts`, `package.json`                                                                            |
| Subscription | Same skeleton-only state                                                          | `services/subscription/src/index.ts`, `package.json`                                                                      |

Catalog/Billing composition roots expose foundation `GET /health/live` (200) and
`GET /health/ready` (503 `FOUNDATION_NOT_READY`) through service-kit. They define
`postgresProbe()` but do not register it in the HealthModule dependencies. The
readiness surface does not prove a current DB probe. No runtime was started here.

Existing migration inventory:

- Catalog `20260920000000_sprint_02_foundation`: marker, nonfinancial probe/outbox.
- Catalog `20260927143000_f008_outbox_trace_context`: outbox trace context.
- Billing `20260920000000_sprint_02_foundation`: marker.
- Pricing/Wallet/Subscription: no migrations. This task adds none.

Catalog ProbeService/PrismaOutboxStore implement foundation probe delivery, not
commerce. `services/catalog/src/domain/quote.ts` is an unconnected integer-string
BigInt quote helper with half-up discount rounding; its rounding is not an
approved finance policy. `services/billing/src/domain/ledger.ts` checks balancing
per currency but provides no posted-journal storage, authorization, unique
business references or payment verification. Neither is production behavior.

`tests/domain.test.mjs` tests these pure helpers. Service Nest suites prove shell
compilation/HTTP/readiness with placeholder DSNs and synthetic failures.
`tests/integration/{migrations,outbox-inbox,messaging-delivery}.test.mjs` cover
real foundation DB/broker mechanisms when run, not finance business acceptance.
Their existence is not an execution result in this proposal.

## Contracts and authorization

| Surface                                | Actual status/version                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `@carwash/contracts`                   | `0.0.2`; Identity/Gateway/registry exports only                                        |
| `@carwash/event-contracts`             | `0.0.2`                                                                                |
| HTTP registry                          | `identity.v1` foundation-runtime; `gateway.v1` routing-contract-only                   |
| Event registry                         | `foundation.probe.created.v1` foundation-runtime; `booking.confirmed.v1` contract-only |
| Finance domains                        | Catalog/Pricing/Billing/Wallet/Subscription are unpublished business domains           |
| Catalog/Billing workspaces             | `0.0.2`                                                                                |
| Pricing/Wallet/Subscription workspaces | `0.0.1`                                                                                |
| Required toolchain                     | `.nvmrc` `24.21.0`, `packageManager` `pnpm@10.32.1`                                    |

Evidence: `docs/api/contract-registry.json`,
`docs/asyncapi/contract-registry.json`, package manifests and public contract source.

`packages/contracts/src/identity.ts` exposes customer, technician, operations,
finance, support, reviewer and super-admin roles. Finance has `billing.read` and
`billing.refund`; technician has assigned-work permissions. There is no guest
principal, Catalog/Pricing publication, cash-custody or settlement permission.
An existing role name is not authorization for a new financial operation.

Identity provides implemented account/session/auth-version/revocation checks.
Its webhook OTP delivery sends `channel: 'email'`; it does not prove SMS delivery.
Reuse it; request extensions from E rather than constructing separate auth.

Gateway `customer.catalog` requires `profile.read:self`; non-authTransport routes
require verified Identity. Removing a permission alone does not enable guests.
GatewayOwner excludes Pricing/Wallet/Subscription, query strings are disallowed,
and `upstreamFault` collapses business reasons to generic status-derived codes.
The contract-only BookingConfirmedV1 requires `customerId` and exact fields;
guest ownership cannot be added silently to that v1 event.

## Design scope and contradictions

F010 registers the customer, technician and admin HTML files in
`docs/design/f010-reference-manifest.json`. The canonical customer methods are
cash, ShamCash and Syriatel Cash. Seven steps, guest booking and optional plate
are frozen requirements. C014 is a session demo only.

Admin `#wallets` describes team custody/field collection; technician
`renderCollections()` says collected order values are not technician earnings.
Customer subscriptions and promotions appear in the admin inventory. They are
required scope to resolve, not marketplace/provider plans or payroll.

Canonical customer `V`, `cost(d)` and `bill(d)` preserve a category surcharge
as a separate bill line and add category duration to package/add-on duration.
`proofSheet()` / `submitProof(e)` require a transaction reference or image,
validate a present reference with the 4–64 character rule, and verify an image-only
proof still exists. Success sets awaiting-review, never paid. Candidate schemas
and scenarios preserve these shapes; their demo rate/duration values are not policy.

Customer SYP samples, admin SAR samples, Riyadh/+966 samples and the admin `Card`
row conflict. None establishes real Aleppo price/geography, supported currency,
precision, employment model or a fourth checkout method. Preserve locked
references; request exact production-state/data/copy decisions before porting.

`docs/VERIFICATION.md` is dated 2026-10-01 and its customer-prototype statement is
historical after C014. Actual React source/PR #41 supersedes it for this audit;
E should refresh the aggregate without claiming backend/payment readiness.
