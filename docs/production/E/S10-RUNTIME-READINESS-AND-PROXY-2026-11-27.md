# S10 runtime prerequisites and same-origin ingress

This document describes source behavior and the remaining deployment sequence. It does not assert that an environment has been deployed, that an external provider is accepted, or that S10–S12 are closed. Runtime evidence must be attached to the exact released commit and image digests.

## HTTP readiness contract

`businessReady` describes the implemented, locally configured HTTP capability set. `dependenciesReady` describes probes of the running process's own dependencies. `ready` is their conjunction. A foundation boot with absent configuration remains HTTP 503. An empty capability list or empty dependency list cannot promote an owner to readiness.

The 18 ordinary owner compositions register their actual injected Prisma client with two read-only checks: a database query, and visibility of every table declared by that owner's current Prisma schema. The schema query also requires the effective and session PostgreSQL roles to both be `cw_<owner>_app`, and the database to be `cw_<owner>`. A migration role, another owner's role/database, or a missing schema cannot satisfy readiness. Exact migration revisions, grants, constraints and data preservation remain the release migration/acceptance gate; table visibility is not a substitute for them.

Local capability checks validate required owner origins, workload credentials and scopes, and configured policy. They do not recursively call other owners' health endpoints. This avoids cycles such as Booking → Billing → Dispatch → Booking. Owner request adapters continue to authenticate callers and fail closed on actual upstream failure. Gateway checks the owners independently.

Identity keeps its existing `IDENTITY_AUTH_ENABLED=true` composition, configured signing keys, OTP connector, Postgres schema and Redis rate-limit store. Its readiness response now reports `businessReady` consistently with its actual dependency result. Its unconfigured foundation composition stays 503. Media additionally sends an authenticated, read-only S3 `HEAD` request to its configured bucket; no health probe creates a bucket or object.

Billing's currently implemented provider path is merchant statements and manual refunds. It requires configured merchant accounts for those capabilities. The health response explicitly reports `automated-provider-confirmation` as unavailable; it is not required for that manual HTTP capability set. This does not authorize automated payment confirmation or satisfy real provider/merchant acceptance. No environment variable can invent an automated adapter.

Worker activity, message delivery, projection freshness, merchant acceptance, operational staffing and a successful business journey are separate evidence. A healthy API database does not prove a relay/consumer is running. Readiness responses carry `scope: http-api` for this reason.

## Same-origin browser transport

All three existing static servers use the single `@carwash/security-kit/server-proxy` technical implementation. The repository-only infra wrapper and app wrappers point to that public package implementation. It sends only the closed `/api/v1/` and `/api/operator/` namespaces to a single deployment-configured Gateway origin. It does not call owner URLs or authenticate users itself. The standalone images copy the original package metadata, proxy module, compiled origin policy and contracts package into a conventional Node package tree. Literal imports load the same origin policy and canonical error contract in repository and packaged execution.

Each app requires:

| Setting                                        | Meaning                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WEB_PUBLIC_ORIGIN`                            | Exact HTTPS browser origin for that app; HTTP is accepted only on loopback for development/tests.                                                      |
| `WEB_GATEWAY_ORIGIN`                           | Exact Gateway origin, with no credentials, path, query or fragment. HTTPS, loopback HTTP, or an explicitly allowlisted Railway private HTTP host only. |
| `CW_PRIVATE_NETWORK=railway`                   | Explicit private transport choice when using Railway internal HTTP.                                                                                    |
| `CW_PRIVATE_HTTP_HOSTS`                        | Exact comma-separated `<service>.railway.internal` hosts; no wildcard or arbitrary internal address.                                                   |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` | Valid platform scope identifiers required by the private transport policy.                                                                             |
| `WEB_GATEWAY_TIMEOUT_MS`                       | Optional total proxy budget, 100–30000 ms, default 5000 ms.                                                                                            |
| `WEB_GATEWAY_REQUEST_LIMIT`                    | Optional request byte limit, 1024–1048576, default 262144.                                                                                             |
| `WEB_GATEWAY_RESPONSE_LIMIT`                   | Optional response byte limit, 1024–2097152, default 1048576.                                                                                           |

Gateway and Identity must both allow the exact three browser origins through their existing allowed-origin configuration. Cookies retain their original multiple `Set-Cookie` headers, `__Host-` names, Secure/HttpOnly/SameSite attributes, and Path. Cookies with a Domain attribute or an invalid security shape are refused. Browser Origin, CSRF, correlation, idempotency, revision and `x-wg-session-binding` headers are preserved. Client-provided Host, Forwarded/X-Forwarded, identity-principal and workload headers are not forwarded. The incoming Host must match the app's configured public origin.

The proxy refuses redirects, traversal/encoded separators, host injection, ambiguous security headers, oversized streamed bodies, malformed or non-JSON API responses and expired time budgets. Every proxy-generated API error uses the published `ApiErrorEnvelope`, with safe correlation identifiers. A timeout after forwarding returns `UPSTREAM_TIMEOUT`; a rejected or unreadable response returns `UPSTREAM_INVALID`. Both preserve an unknown mutation outcome in the Operator and shared browser clients, with no automatic retry. Pre-forward path, origin, host and size refusals are definite canonical 4xx errors. Responses are not cached. The existing page CSP and static-file surface remain unchanged. Operator presigned object-store traffic retains its separately configured exact `OPERATOR_MEDIA_ORIGINS` policy.

A configured static host becomes HTTP-ready only when its built entry document is readable/nonempty and Gateway returns an authenticated-by-destination health response with `service=api-gateway`, `ready=true`, and `businessReady=true`. Missing configuration preserves the original 503 foundation response. Liveness remains separate.

## Gateway coverage

The required upstream set is derived from the shipped `GATEWAY_ROUTES`, not from whichever subset happens to be configured. `GATEWAY_UPSTREAMS` must cover every routed owner. Gateway liveness reports configured routing capability without making dependency calls; readiness checks each owner's response status and exact `service`, `ready` and `businessReady` fields. A 200 response with the wrong owner, an error body or an unready flag does not pass.

Wallet and Configuration are owner services even though they are not public Gateway route owners. Their own deployment and acceptance checks remain required.

## Existing deployment inventory and sequence

Use `architecture/service-catalog.json` and `infra/runtime-processes.json` as the canonical manifests. The current source declares 23 API/web runtime artifacts (19 owners, Gateway, three web apps), 19 separate owner migration jobs, and 13 required standalone worker roles. That is 36 long-running application processes before infrastructure. The four specialized worker alternatives and two legacy consumers are not additional default replicas. Billing's cash relay and obligation relay are separate declared roles of the same owner image.

1. Establish the scoped staging infrastructure and inspect provider-side apply results. Postgres, Redis, RabbitMQ and object storage need real health/identity/ACL evidence; a staged configuration patch is not a running service.
2. Build and verify the exact source with the existing release scripts/workflows. Preserve runtime and migration image security gates, provenance, SBOM and digest binding. PR rehearsal images in the ephemeral local registry are not deployable published artifacts. Use the actual released immutable images, or a separately verified exact-source provider build; do not silently substitute an unverified image.
3. Apply all 19 migrations as one-shot jobs with each owner's migration role. `migrate-job.mjs` consumes `MIGRATION_DATABASE_URL_FILE` and rejects `DATABASE_URL`; it must not receive an API runtime DSN. Deliver each file through a verified provider file mechanism with access for the existing non-root UID 1000 process. Railway documents volume file upload; those volumes exist only at service start, not in pre-deploy containers. Keep these as dedicated one-shot owner jobs. The same file delivery prerequisite applies to Identity. Do not replace mounted files with raw-secret environment variables or weaken file/role checks.
4. Configure and start owner APIs, Gateway, the three static hosts and all 13 required worker roles. Use each worker's command, owner image, required variables and inherited-healthcheck policy from `runtime-processes.json`. Worker liveness is process supervision; progress requires queue/inbox/outbox/lease/DLQ evidence. Keep owners and worker endpoints private. The web hosts route browser API calls only through Gateway.
5. Run the full deployed journey and failure/restart/compensation proofs against that exact revision: actual Identity session and CSRF, customer/vehicle ownership, published Catalog/Pricing/Geo/capacity data, booking, assignment, evidence storage, supported payment/refund path, notifications and Billing/Wallet/Reporting effects. Use clearly scoped staging data. Readiness alone is not this proof.
6. Produce the existing source-bound release receipt, barrier, production smoke, recovery and operating-window evidence. Confirm the previous immutable runtime artifacts and database compatibility before rollout. A failed migration, health check, consumer progress check or journey must stop promotion; use the verified rollback/recovery procedures and retain the failed evidence.

No additional launch framework is introduced. Existing entry points include `scripts/production/E/release/build-release.mjs`, `release-receipt.mjs`, `release-barrier.mjs`, `production-smoke.mjs`, `operating-window.mjs` and the release/recovery helpers they import.

## Deployment facts still requiring secure access or external acceptance

- The live Redis endpoint protocol must be verified. Identity requires `rediss://` in staging/production; the HTTP private-network flag does not silently authorize plaintext Redis. If the available endpoint is only `redis://`, provision TLS or review a separate explicit encrypted-network Redis boundary before starting Identity.
- Identity key/pepper/CSRF/rate/OTP token files and migration DSN files must be delivered securely and owner-scoped. No secret is supplied in this document.
- The real OTP/notification delivery connector, merchant account configuration and any automated merchant integration require their actual external acceptance. Source tests cannot supply those facts.
- The object-store endpoint, bucket, credentials, private access policy and exact browser CORS origins require provider verification. A successful bucket HEAD proves access, not upload/finalize/retention/restart acceptance.
- Service identities, current deployment IDs, public domains, worker supervision, approved rollout/rollback observations and operating-window evidence must be recorded from the target environment after secure access is available.

## Verification scope

`tests/production/E/web-gateway.test.mjs` exercises real local HTTP listeners for all three production static handlers, cookie/CSRF/session-binding forwarding, rejected spoofed context, redirects, traversal, streaming budgets, timeouts, readiness and standalone package/export/dependency loading. Accepted POST requests followed by timeout, oversized/malformed response, redirect or invalid cookies are exercised through the actual Operator and shared clients, and strict contract parsing verifies both ambiguous 5xx outcomes and pre-forward 4xx refusals. `gateway-readiness.test.mjs` uses the actual compiled Nest Gateway with real local owner listeners. `owner-readiness.test.mjs` checks all 18 owner policies and exact model-table coverage with explicit SQL doubles, including missing scopes/policies/schema and privileged/wrong-role refusal. The Catalog integration suite additionally uses real PostgreSQL 16, migrated by a distinct role, and the actual Nest HTTP composition. These are source/runtime tests, not hosted or provider acceptance.

## Secure platform preparation observed on 2026-11-27

A fresh read of the existing staging project still showed the same 13-change
RabbitMQ/volume/object-storage patch as `STAGED`. The connector exposed variable
names with values redacted. All 38 original owner app/migration password names
remain present on the completed database provisioner. Reuse those securely held
values or perform an explicit audited rotation: the provisioner creates missing
roles but does not reset passwords on existing roles. Never inject the bootstrap
Postgres identity into an owner API or worker.

[Railway's volume CLI](https://docs.railway.com/cli/volume.md) provides
`railway volume files --volume <volume-id> upload <protected-local-file> <remote-path>`.
Scope the command to the actual project, environment and service. Provision
file ownership and permissions for UID 1000 through controlled platform access;
do not change application execution to root. The documented
[volume mount lifecycle](https://docs.railway.com/volumes.md) and
[pre-deploy isolation](https://docs.railway.com/deployments/pre-deploy-command)
mean a migration that needs its secret volume must execute as the dedicated
job's start process. No file upload or permission change has been performed.

Migration DSNs must still use the correct owner migration role/database/schema
and a required TLS mode. Identity needs an authenticated `rediss://` endpoint
and trusted TLS, plus its five existing signing/OTP/CSRF/rate/delivery secret
files. Available variable names and the absence of a visible Redis TLS override
do not prove the actual endpoint protocol. Verify live encrypted connections
and scoped ACLs before starting Identity; private HTTP policy is unrelated.

The separate RabbitMQ acceptance bootstrap scripts are fresh, overlapping test
profiles. Do not concatenate them on a hosted vhost. The reviewed
[hosted definitions profile](../../../infra/rabbitmq/HOSTED-DEFINITIONS.md)
now provides the union of native exchanges, queue bindings and exact resource/topic
permissions for all nine broker owners. It uses private input/output files and
broker-local export/import, preserves existing matching credentials, refuses
conflicting or hidden target-vhost state and verifies the result after import.
Management-plugin support is not assumed.

The required Reporting broker family includes an isolated transport fixture for
the actual definitions import, all nine identities, owner declarations/bindings,
authorized publication and forbidden cross-owner operations. The fixture must
pass on the final source; source tests alone are not broker proof. Applying that
profile to the actual hosted broker, configuring its real protected credentials
and observing deployed native worker progress remain separate deployment gates.

Billing's supported merchant mode requires actual receiving accounts in both
`BILLING_SHAM_CASH_MERCHANT_ACCOUNTS` and
`BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS`, independent finance principals and
real statement/refund evidence. Automated-provider API settings fail startup
because that adapter is unimplemented. Identity/notification connectors likewise
need actual delivery credentials and the provider's real idempotency and recipient
namespace support. These inputs cannot be replaced by fixtures or inferred from
healthy infrastructure.
