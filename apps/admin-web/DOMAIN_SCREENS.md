# Admin owner modules — S05 / S08

These modules replace the corresponding static demonstration content with owner reads and typed commands. They reuse the approved admin shell, cards, tables, modal and field classes. The byte-frozen reference remains unchanged. Additional owner-driven forms and dynamic error states still require browser and design acceptance; this document does not declare visual parity or production readiness.

## Implemented domain flows

| Screen / module | Actual behavior | Authority and result |
| --- | --- | --- |
| Services / `catalog-coverage.ts` | Read the explicit unpublished/published owner state, create the first service from returned revision0, or edit/add definitions while preserving the complete published snapshot | Publication requires `catalog.publish`; exact receipt context is checked; an unknown result retains its original body and key |
| Service prices / `prices.ts` | Read the complete owner price book or explicit unpublished state, edit/add an exact minor-unit price, review all resulting entries before publication | Requires `pricing.prices.publish`; uses the owner's `nextExpectedPriceBookRevision`, including revision 1 for an unpublished book; no guessed currency or conversion |
| Coverage / `catalog-coverage.ts` | Read service zones, explicitly check a coordinate pair, select zone/date/duration and read actual intervals | Geo owns serviceability and Scheduling owns capacity; no fabricated map density, geometry edits or available staff count |
| Cases / `support-cases.ts` | Filter/page/lookup/open a Support case, read current owner state, enter a typed decision with evidence, review a refund independently, resend the frozen owner command | Support records decisions; Booking and Billing alone determine cancellation, reschedule, payment and refund completion |
| Wallets / `wallets.ts` | Read actual custody reconciliation, look up holder and handover, receive counted cash at treasury, reconcile a recorded handover | Treasury receipt is distinct from reconciliation; shortage/overage and currency stay explicit; current revision and original command key are preserved |
| Subscriptions / `subscriptions.ts` | Read and publish immutable plans with package/vehicle coverage, look up a funded subscription, review pending customer change requests | Requires `subscription.manage`; a manager cannot decide their own funded subscription; freeze does not extend paid expiry; no automatic refund or booking cancellation |

Arabic and English labels follow the shell locale and its RTL/LTR direction. Owner-published Arabic names retain their text when no English publication exists. Forms use concrete fields and validated amount/ID/date values, not raw JSON editors. There are no local success branches for unavailable services.

## Integration hooks

The modules export the following functions for the shell owner:

```ts
wireDomainScreens({ unauthenticated, permissions });
wireSupportScreens({ unauthenticated, permissions, subject });
wireWalletScreens({ unauthenticated, permissions });
wireSubscriptionScreens({ unauthenticated, permissions, subject });
```

The route handlers are `showServices`, `showCoverage`, `showSupportCases`, `showWallets` and `showSubscriptions`. `wire*` creates missing section containers without changing the reference artifact. Each `invalidate*Screens(false)` invalidates stale reads when navigation or locale changes. Session loss/replacement must call each `invalidate*Screens(true)` to clear private DOM and pending in-memory commands. Publication actions remain permission-gated even when the screen itself is readable.

The central router/capability policy and Gateway integration are maintained by the root integration owner. The browser suite below asserts the final routed behavior, so a module's unit test alone is not evidence that its screen is reachable.

## Required Gateway surfaces

Paths are relative to `/api/v1`; the browser never connects directly to a domain service.

| Paths | Owner contract |
| --- | --- |
| `GET /admin/catalog/current`, `GET /admin/catalog`, `POST /admin/catalog/publications` | Explicit `CurrentCatalogV1`, published-only `CatalogV1`, and `PublishCatalogRequestV1` |
| `GET /admin/price-books/current`, `POST /admin/price-books` | Pricing `CurrentPriceBookV1` / `PublishPriceBookRequestV1` / `PriceBookPublicationV1` |
| `GET /admin/service-zones`, `POST /admin/serviceability`, `GET /admin/availability` | Geo and Scheduling canonical reads |
| `GET,POST /admin/support`, `GET /admin/support/:id`, `GET /admin/support/:id/current` | Support case/list/detail/current |
| `POST /admin/support/:id/decisions`, `/:id/decisions/:no/approval`, `/:id/decisions/:no/execution` | Support durable decisions, four-eyes approval and frozen-command retry |
| `GET /admin/billing/custody/reconciliation`, `/holders/:subject`, `/handovers/:id` | Billing custody owner reads |
| `POST /admin/billing/custody/handovers/:id/treasury-receipt`, `/:id/reconciliation` | Billing treasury receive / reconciliation |
| `GET /admin/subscription-plans`, `POST /admin/subscription-plans/:planId/versions` | Canonical Subscription plans |
| `GET /admin/subscriptions/:id`, `GET /admin/subscription-changes` | Canonical subscription state and pending changes |
| `POST /admin/subscriptions/:id/changes/:changeId/decision` | Independent manager decision |

The initial Catalog revision is owner-reported: the current-state read returns `UNPUBLISHED`, `catalog:null`, and comparison revision0. A 404, owner failure or contradictory payload never becomes a bootstrap permission. Existing `CatalogV1` still requires a real published revision. The owner serializes concurrent first publications and records the losing revision conflict. Staff Geo authorization is likewise enforced by the owner. Zone geometry publication currently has a separate operational path; no unsupported HTTP mutation is invented in this UI. Custody and subscription customer-wide lists are not published owner surfaces, so lookup and the actual pending/reconciliation queues are used instead.

## Verification

On the implementation working tree using Node **24.22.3** and pnpm **10.32.1**:

```sh
pnpm --filter @carwash/admin-web typecheck
node --test apps/admin-web/test/domain-owners.test.mjs
```

All **14** domain transport tests passed. They cover explicit Catalog bootstrap, full publication and retry, malformed/foreign owner records, exact geographic query context, Support command shape and owner-pending states, receipt versus reconciliation, 18-digit exact money, price-book next revision, immutable plan coverage, and unchanged paid expiry on subscription decisions. Catalog bootstrap plus the owner/domain/provider/shared-contract/Admin focused run passed **66/66** local tests before the PostgreSQL-only scenario was added; PostgreSQL source was built but not run locally. Focused ESLint also passed for the owned modules and browser script.

`browser/domain-screens.browser.mjs` builds the actual production Vite bundle and uses Chromium with explicit synthetic HTTP owner doubles. It exercises an unpublished Catalog, first-publication response loss and same-key retry, subsequent edit from the published revision, geographic check/slots, treasury receipt without settlement, a Support decision while Booking remains confirmed, and subscription change approval without extending expiry. It records source SHA, actual browser version, screenshots, runtime errors and CSP violations; it includes desktop and mobile captures. The root release workflow invokes this script after installing the pinned browser.

The local environment has no usable Chromium binary and the download endpoint was blocked, so local unit/build/lint results do not include browser execution. The final CI browser artifacts, real owner/database integration, role acceptance, accessibility review and production credentials remain independent gates. No baseline was regenerated and no readiness flag was changed.
