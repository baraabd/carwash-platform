# P01-D3: Versioned configuration with review metadata and safe reads

Parent task: P01-D. Status of the parent: **INTEGRATION_PENDING**.
`BUSINESS_READY` stays `false`: the API enforces `configuration.read` and
`configuration.write`, which Identity does not grant to any role yet
(CR-D-P01-01 in `P01_CONTRACT_REQUESTS_TO_E.md`, merged with P01-D1). Until E
publishes them, every real caller is denied (deny by default). No unrelated
permission is borrowed.

## Model

| Table | Rule |
| --- | --- |
| `config_revision` | Append-only. A typed value (`boolean`, `integer`, `decimal` as exact text with at most 6 fraction digits, `string`, `duration-ms`), author, reason (10–500 characters), value hash and request hash. Revision numbers are unique per scope `(namespace, key, environment, tenant_scope)` and allocated under a per-scope advisory transaction lock. `(author_subject, idempotency_key)` makes retries replay |
| `config_review` | One decision per revision (the primary key). The reviewer must differ from the author (four-eyes rule) |
| `config_pointer` | The active approved revision per scope, plus an optimistic `version`. Activation is compare-and-set on `expectedVersion` (0 = no pointer yet) and never moves to an older or equal revision; a rollback is a new reviewed revision |
| `config_audit` | Append-only `PROPOSED`/`APPROVED`/`REJECTED`/`ACTIVATED` with actor, correlation id and value hash, never the value |

The migration revokes UPDATE, DELETE and TRUNCATE on revision, review and audit
from every non-owner grantee. It discovers grantees rather than naming them.
The provisioning replay and post-migration hardening reassert those revokes for
the runtime role, while keeping the active pointer writable for activation.
Keys that look like secrets (`secret`, `password`, `token`, `credential`,
`api-key`, `private-key`) are refused: secrets belong in a secret manager.

**Safe reads.** The effective value is the tenant's active revision, otherwise the
environment-wide one, otherwise `NOT_CONFIGURED`. No default is invented. The
tenant pointer, environment pointer and their revisions are read in one repeatable-read snapshot, and a
persisted value is re-validated before it is served.

## HTTP (`/internal/v1/configuration`)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /values/{namespace}/{key}?environment&tenantId` | `configuration.read` | Effective value with its revision and source |
| `GET /values/{namespace}/{key}/revisions?environment&tenantId&limit≤50` | `configuration.read` | Newest first |
| `POST /revisions` (requires `Idempotency-Key`) | `configuration.write` | 201; a replay returns `replayed: true`; same key with a different request returns 409 |
| `POST /revisions/{id}/review` `{decision, note}` | `configuration.write` | Self-review 403; a second decision 409 |
| `POST /revisions/{id}/activate` `{expectedVersion}` | `configuration.write` | Not approved / not newer / version conflict: 409 |

Authentication: the bearer token is verified by **Identity** through
`GET /internal/v1/identity/session` (2s deadline, bounded body). Identity
unreachable, 5xx or a malformed answer gives 503 `AUTH_UNAVAILABLE` (fail closed). A
gateway-forwarded `x-auth-subject` that disagrees with Identity gives 401. Errors use
service-kit's envelope with a correlation id; internal messages are redacted.
Requires `IDENTITY_ORIGIN` (HTTPS, or HTTP only on loopback or an internal
single-label service name).

## Evidence

| Family | Command | Result on this branch |
| --- | --- | --- |
| Domain and Nest specs | `node --test services/configuration/dist-tests/test/*.spec.js` | see PR |
| Real HTTP + PostgreSQL | `node scripts/production/D/run-real-infra.mjs --suite configuration` | see PR |
| Guards | layers, boundaries, append-only migrations, design reference, prettier, eslint | see PR |

Real versus stubbed: the Nest HTTP application, PostgreSQL and the runtime role
are real. Identity is a loopback stub serving the published session shape,
because the real Identity cannot yet grant the requested permissions. The
`tok-staff` session (real roles, no configuration permission) shows the only
outcome a real caller gets today: 403.

H6 found a real defect during development. Optimistic `max+1` allocation with
bounded retries returned 500 for 4 of 10 concurrent proposals. It was replaced by
a per-scope advisory lock, and 10 of 10 now succeed with gap-free numbers.

## Pending

- Main now contains E's `configuration.v1` market-scoped draft/approve/publish
  contract. This implementation's environment/tenant revision model still
  diverges (CR-D-P01-06). These fixes do not resolve that product contract
  decision or expose the implementation through the gateway.

- `configuration.revision-activated.v1` event and its Outbox relay need an E
  event contract, topology and the `platform-messaging` dependency
  (CR-D-P01-03/04). Activation is audited, but no event is emitted.
- Gateway routes (CR-D-P01-05) and the admin UI for this API (blocked on
  CR-D-P01-02, plus a reviewed design, since admin screens are not designed).
