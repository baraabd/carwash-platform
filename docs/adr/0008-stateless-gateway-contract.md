# ADR 0008 — Stateless Gateway/BFF contract boundary (F007)

Status: implemented; acceptance is tied to final-source gate evidence, not this heading.

## Canonical ownership and dependencies

The catalog's gateway is `apps/api-gateway`, package `@carwash/api-gateway`.
The brief's `services/gateway-service` is a logical name, not permission to create a
second workspace. Identity stays at `services/identity`. F007 depends on the accepted
F006 source and introduces an isolated NestJS 12.0.3 gateway without upgrading the
NestJS 11 service fleet. Each has its own package boundary and independent build.

## Authentication and browser transport

Gateway verifies RS256/kid/issuer/audience/expiry through Identity's public JWKS using
`@carwash/security-kit`, then calls Identity's live session contract on every protected
request. Current account status, session revocation and permissions cannot be inferred
from an old token. A changed subject/session/version in introspection is rejected.
Gateway possesses no credential database, user signing key, OTP key or CSRF secret.

The smallest additional Identity hook is `POST /internal/v1/identity/authorize`: an
empty-body, read-only session authorization operation with Identity-owned signed CSRF
verification. Cookie-authenticated commands call it before their domain owner. Bearer
API commands call live session verification. An invalid Origin or cross-site browser
write is rejected before forwarding. Same-origin deployment is the supported browser
model; no permissive CORS middleware is installed.

Only explicitly named Identity cookies, Authorization, Origin, Fetch-Site and CSRF
headers reach Identity. No arbitrary client identity, service, forwarded IP, hop-by-hop
or baggage headers are copied. Domain services receive the original verified Bearer
credential, server-derived subject/session/version, request/correlation and trace IDs;
never refresh cookies or CSRF tokens. Derived headers are metadata, NOT a substitute
for a service independently verifying the token and owning resource authorization.
The gateway does not accept signing keys or external user-ID headers as configuration.

Identity currently observes the gateway's socket IP for its network abuse dimension.
It does not trust arbitrary forwarded IPs. Authenticated ingress provenance/edge IP
budgets require a separate deployment trust policy; they are not silently enabled here.

## Explicit routing and compositions

`@carwash/contracts` defines method, public path, owner, internal path, granular
permission and idempotency policy. Runtime origins are a separate deployment config.
No open proxy, request-supplied URL, generic wildcard upstream, redirect following,
encoded traversal, arbitrary query forwarding or unknown method is allowed.
Pagination/filter contracts are not invented; uncontracted query strings fail closed.

Customer overview composes Customer and Catalog; technician overview composes Workforce
and Booking; admin overview requires both Billing and Support read permissions. Every
component uses GET. Failure of one owner yields a safe failure, not fabricated partial
business data. A finance role alone cannot obtain a support read by using an admin URL.
All business endpoints are prospective owner contracts tested with named HTTP stubs;
this sprint does not implement those business services or claim their production readiness.

`/api/v1/contracts` and `docs/contracts/gateway.openapi.json` expose routing discovery,
not private origins or authoritative business schemas. The check command compares a
reviewed artifact without regenerating it. Domain schemas remain with their owners.

## Commands, deadlines, errors and compensation

Business writes require a validated `Idempotency-Key` and forward it unchanged. Keys
are not stored in Gateway; payload fingerprints, replay/conflict and compensation belong
to the owning service transaction. No call is retried automatically, including 503,
connection loss or timeout. A timeout is an unknown command outcome, not rollback or
permission to issue a fresh command. Clients query/replay through the owner's contract
with the SAME key. Authentication challenge/rotation semantics remain owned by Identity.

Per-attempt timeout includes headers and response-body consumption. Response bytes and
incoming JSON body size are capped. Non-JSON, oversized, redirected or failed upstream
responses cannot leak raw exceptions, SQL, stacks or tokens through error envelopes.
Validation errors map to public fixed codes/messages; internal free-text messages are
never reflected. IDs are generated or syntax-validated, and raw bodies are not logged.

## Health and limits

Liveness means the gateway process is serving. Readiness reports currently configured
owner health; it never sets businessReady=true or claims an unconfigured business owner
exists. All remote production origins require HTTPS; plaintext is allowed only for
explicit loopback test/developer endpoints. Production termination/ingress/mTLS settings
and HA/load testing are not established by this sprint.

## Verification

`pnpm test:gateway` exercises the built Nest 12 process and real HTTP stubs, public-key
tamper detection, spoof stripping, missing/forbidden authentication, strict paths,
error mapping, body deadlines/limits, no retries and read-only compositions. This is
not PostgreSQL evidence. `pnpm acceptance:gateway` provisions real PostgreSQL and Redis,
runs all F006 API/Chromium checks plus real Identity-to-Gateway contract tests with
separate domain test servers. It uses the owning Identity fixture only in test code.
All F001–F005 gates are retained. Approved HTML bytes are untouched.
