# C001 — Customer HTML behavior inventory

Status: source inventory for the approved customer prototype. This document and its machine-readable manifest do **not** claim backend or production readiness.

## Authority

- Golden customer HTML: `design/reference/approved/washgo-payments-interactive.html`
- SHA-256: `04a7c74fe7209efc7bfb31d56e27f8d22e65932c412ea20cba8a1820d54f0549`
- Registered by F010 and byte-protected by the existing reference harness.
- Language/direction: Arabic / RTL.

The C001 manifest is `docs/customer/customer-parity-manifest.json`.

## Exact customer journey

The booking flow remains seven distinct decisions in this order:

1. السيارة
2. العناية
3. المكان
4. الموعد
5. بياناتك
6. الدفع
7. التأكيد

C001 does not port these screens to React. It makes their prototype behavior explicit so C002–C050 can implement them without inventing or silently dropping states.

## Primary prototype surfaces

- home
- booking
- payment
- tracking
- orders
- garage
- account

The bottom navigation exposes الرئيسية، حجوزاتي، سياراتي، حسابي. Booking, payment and order tracking use hash routes and browser-history restoration.

## Important behavior captured

The manifest inventories:
- every literal customer action handled by the prototype;
- six rendered form instances: vehicle, address, profile, payment proof, plus the class-only Sham Cash and Syriatel Cash merchant-QR configuration forms;
- vehicle/plate preview and saved-car behavior;
- packages and add-ons;
- illustrative address map and geolocation permission path;
- date/time selection;
- contact validation;
- cash, Sham Cash and Syriatel Cash choice;
- QR presentation/copy/save and proof-review simulation;
- payment states and their safety copy;
- current/past booking filtering;
- simulated order/technician progression;
- before/after local media comparison;
- repeat booking;
- local account/address/garage controls;
- motion/reduced-motion controls;
- local export/reset.

## Production ownership mapping

The prototype is intentionally local. C001 maps each visible capability to its future owning microservice without implementing that service:

- Identity → Identity
- Profile/addresses → Customer
- Vehicles → Vehicle
- Packages → Catalog
- Authoritative quote → Pricing
- Booking lifecycle → Booking
- Capacity → Scheduling
- Assignment/travel → Dispatch
- Payment verification/refund → Billing
- Photos/payment-proof media → Media
- Notifications/chat → Communications
- Serviceability/geocoding → Geo
- Technician projection → Workforce

No later app may bypass those boundaries through direct database or service-source imports.

## Truth boundaries

The HTML itself says it makes no server calls or real orders. Therefore C001 explicitly records that:
- localStorage/IndexedDB are prototype persistence only;
- local price calculation is not authoritative production pricing;
- displayed dates/times are not authoritative capacity;
- the map/route is illustrative, not navigation or live tracking;
- QR/proof/success payment states are simulation and do not verify money movement;
- a visual technician state is not proof of real dispatch;
- visual presence of a feature is not proof that its backend exists.

## Verification

`scripts/c001/customer-behavior-manifest.mjs` fails closed when:
- the F010 reference identity drifts;
- the prototype action inventory and manifest disagree;
- the seven steps are reordered or renamed;
- form inventory changes;
- payment method/state inventory changes;
- the manifest overclaims server/payment/tracking/account/pricing/availability readiness;
- a class-only payment configuration form disappears;
- required microservice ownership disappears or a capability is reassigned to the wrong service.

The test suite includes adversarial manifest mutations. Approved HTML bytes are not changed by C001.
