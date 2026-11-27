# Customer owner integration — S03 / S08

This implementation adds a production runtime for the existing seven approved booking decisions. The parity runtime remains a separate, deterministic reference port. Passing the reference hash guard proves preservation of the canonical files; it does not establish visual parity of dynamic production data or production readiness.

## Implemented behavior

- Published Catalog definitions drive care and extras. Pricing produces the quote and exact minor-unit total. The client never submits a computed price to Booking or Billing.
- Saved Vehicle and Customer address records retain their owner IDs and revisions. Inline vehicle details and the optional plate remain supported. Existing Garage and address CRUD continue through their owners.
- A manually described address is not a geographic decision. The customer explicitly supplies a location, through the one-shot device permission flow or latitude/longitude fields, before Geo checks coverage. The returned point, decision and expiry are validated before a zoned quote is requested.
- Scheduling supplies available slots and its global earliest available day within the owner horizon. The shortcut selects that owner interval, including when it is on a different day. All hold creation and release uses the authenticated Booking façade; the browser cannot call Scheduling hold mutations. Hold identity, beneficiary, quote reference, zone, interval duration and expiry are checked before confirmation.
- Booking confirmation uses the quote and hold references, saved-record revisions, contact and method. The response remains `PENDING` until the owner reports otherwise. Contact, vehicle, address, slot, quote and money context are checked before accepting a receipt.
- A lost or unreadable mutation response stays uncertain. Retry retains the same command and idempotency key. Booking creation additionally stores only an opaque recovery key in session storage, scoped to the principal. Reload resolves that key through Booking's owner-scoped `by-request` read. A 404 read does not erase the uncertainty fence or create a second booking.
- Orders and tracking reload actual Booking records, including the durable execution projection. Cancellation shows the owner's change state and settlement separately. Polling runs while the detail page is visible, avoids overlapping refreshes and cleans up its timer/listener on exit.
- Payment reads Billing's obligation and refund views. Submitting a wallet reference requests review; it never asserts payment. A method change uses the current owner revision. Money, availability, identity and booking state stay independent.
- Accounts can select an owned subscription for a single package with no extras. The client asks Subscription to check the actual package, vehicle type and held time; it uses the returned eligibility revision in Booking creation. It never derives coverage from the latest plan or a displayed unit count. Covered creation omits a payment method, creates no direct Billing obligation, and remains pending until Booking confirms the reserved entitlement. Confirmed coverage requires a reservation ID and no direct obligation. Switching vehicle, care, address, hold or direct payment clears the selected entitlement.
- The production account sheet reads published subscription plans and their package/vehicle coverage. It requests an owner Pricing quote, reviews the exact amount, creates a prepaid purchase and follows the actual Billing obligation. A submitted wallet reference remains a claim. Subscription activates only on an owner read after verified funding. A change request is displayed as pending review unless the owner says otherwise; freeze never invents a new paid expiry, and cancellation never implies a refund or cancelled booking.
- Membership recovery stores only a principal-scoped opaque purchase key and last purchase ID. Reload reads the canonical owner-scoped purchase-by-request route; unknown/missing records do not authorize a second create. Private polling is visible-only, fenced against identity changes and newer commands, and stopped when the sheet closes.
- Account entry uses Identity's published email/password, OTP challenge, resend and verify contracts. Password and OTP are not stored in browser storage. Guest entry and the existing guest recovery remain available. Identity replacement discards private draft and late owner responses.

## Runtime surfaces

| Gateway surface | Owner fact or command |
| --- | --- |
| `GET /customer/packages` | Catalog published definitions |
| `POST /customer/quotes` | Pricing quote with server total and expiry |
| `POST /customer/serviceability` | Geo decision for explicit coordinates |
| `GET /customer/availability` | Scheduling available intervals |
| `GET /customer/availability/earliest` | Scheduling earliest available day within its horizon |
| `POST /customer/booking-holds` | Booking façade to Scheduling hold |
| `POST /customer/booking-holds/:id/release` | Booking façade to Scheduling release |
| `POST /customer/bookings` | Booking creation and its orchestration |
| `GET /customer/bookings/by-request/:key` | Recovery of an ambiguous create |
| `GET /customer/bookings[/:id]` | Persisted customer list/detail |
| `POST /customer/bookings/:id/cancellation` | Booking cancellation process |
| `GET /customer/bookings/:id/changes` | Owner change history |
| `GET /customer/bookings/:id/obligation` | Booking-scoped Billing obligation |
| `POST /customer/payments/:id/method` | Billing method selection |
| `POST /customer/payments/:id/transaction-reference` | Wallet reference review |
| `GET /customer/payments/:id/refunds` | Verified refund truth |
| `GET /customer/subscription-plans` | Owner-published immutable plan versions |
| `POST /customer/subscription-quotes` | Pricing's account-bound purchase quote |
| `POST /customer/subscription-purchases` | Durable prepaid purchase request |
| `GET /customer/subscription-purchases/:id` | Verified funding and activation state |
| `GET /customer/subscription-purchases/by-request/:key` | Owner-scoped ambiguous-purchase recovery |
| `GET /customer/subscriptions` | Account-owned units, period and state |
| `POST /customer/subscriptions/:id/eligibility` | Read-only owner coverage decision for a held time |
| `POST /customer/subscriptions/:id/changes` | Durable freeze/resume/cancel review request |

Paths are relative to `/api/v1`. Runtime requests use the same-origin Gateway, cookie session and CSRF port. Public catalog/availability reads omit credentials. Owner errors have no fixture fallback. `productionBookingContracts.ts` is a strict consumer mirror of the current public Booking view, including the additive funding fields; no service implementation is imported into the browser.

## Evidence and its limits

On the implementation working tree, using Node **24.22.3** and pnpm **10.32.1**:

```sh
node --test --test-reporter=tap tests/unit/c0*.test.mjs apps/customer-web/test/*.test.mjs
pnpm --filter @carwash/customer-web typecheck
pnpm exec eslint apps/customer-web/test tests/production/A/production-journey.browser.mjs tests/unit/c008-customer-location.test.mjs
node scripts/check-design-reference.mjs
```

The combined customer/reference unit and transport suite passed **374/374**, with no skipped tests. TypeScript and the focused JavaScript lint passed. The design guard verified all **10** canonical artifacts unchanged. Transport tests cover price/beneficiary corruption, manual-address rejection, expired holds, same-key retries, lost-create recovery, foreign records, payment review, session changes, subscription quote/purchase/recovery/change states, owner eligibility revisions, global earliest selection, and mismatched booking/hold receipts. These are not database, broker or live owner integration evidence.

`tests/production/A/production-journey.browser.mjs` builds the actual production bundle into a temporary directory and exercises it in Chromium with explicit HTTP transport doubles. It records the browser version, source SHA, flow results and screenshots. It covers the seven screens, owner pending/confirmed transitions, persisted reload/orders, wallet review/owner settlement, ambiguous-create reload recovery, account OTP entry, membership purchase/payment review/owner activation, pending freeze, and eligibility-backed Booking creation. It is wired into `.github/workflows/c014-booking-confirmation.yml`, alongside the unchanged parity reference acceptance. This production browser suite has not run locally: the available Chromium launcher has no executable, and browser download access is blocked. CI must provide the browser evidence before approval.

## Remaining acceptance and external dependencies

1. Run the production browser suite and the deterministic reference/candidate/diff suites on the final commit. Inspect the production screenshots, including the explicit location capture sheet, dynamic catalog, membership account sheet, covered-payment selection, order/payment states and accessibility behavior. The membership surfaces are functional production extensions using the approved components, not an assertion that unseen subscription screens have approved pixel baselines. No baseline was regenerated.
2. Run the end-to-end journey against the deployed owner services and real databases/workers, including hold expiry, concurrent capacity, saga compensation, dispatch progression, cancellation, verified collection and refunds. HTTP doubles do not prove these integrations.
3. Wallet merchant instructions, recipient and QR are not currently published by an authenticated owner contract. The UI does not manufacture them. Reference submission is available for a transfer the customer already made; enabled payment operations need the real merchant configuration and operational verification.
4. No customer-authorized technician contact, live coordinates or before/after proof-photo contract is currently published. Tracking shows only the real lifecycle. These visible parts of the approved completion journey require their owner contract and approved data handling before they can be enabled.
5. Account password recovery is not an existing published Identity capability. Guest recovery and account OTP entry are implemented; an account password-reset flow requires an owner contract.
6. Complete production English/LTR acceptance remains open. The approved customer copy is Arabic; no English design or localized dynamic acceptance is inferred from admin's independent bilingual shell.
7. Staging, delivery credentials, merchant setup, security/performance acceptance, backup restoration and release gates remain independent deployment requirements. This document does not mark any readiness flag or approve a launch.
