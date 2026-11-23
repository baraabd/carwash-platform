# CR-P03-C2 — Media v1 contract and platform prerequisites (request to Lane E)

Requester: Lane C (P03-C / C2). Implementation: `services/media`.
Spec: section "C2 — Media" of `docs/production/C/P03-C-interfaces.md`.
Lane C does not edit shared packages, lockfiles, CI, infra or architecture; each
item is a request for Lane E to review, version and publish. Until then the
items below are **provider-pending** and nothing in Media claims them as
published. `/health/ready` stays 503 (`BUSINESS_READY = false`).

## 1. HTTP contract `media.v1` (owner: Media, lane C)

Prefix `/internal/v1/media`. Implemented exactly as listed in the spec table:

| Method | Path | Caller | Success |
| --- | --- | --- | --- |
| POST | `/uploads` | user `work.execute:assigned`, `Idempotency-Key` | `201` new, `200` replay: `ObjectView & {upload}` |
| POST | `/objects/:id/upload-url` | owner (`work.execute:assigned`), RESERVED and open | `200` `ObjectView & {upload}` |
| POST | `/objects/:id/finalize` | owner (`work.execute:assigned`), `Idempotency-Key` | `200` `ObjectView` (AVAILABLE or REJECTED) |
| GET | `/objects/:id` | owner (`work.read:assigned` or `work.execute:assigned`), or service `media.object.read` | `200` `ObjectView` |
| POST | `/objects/:id/read-url` | same as GET; AVAILABLE only | `200` `{method:'GET', url, headers:{}, expiresAt}` |
| POST | `/objects/:id/claims` | service `media.object.claim` | `201` new, `200` repeat: `ObjectView & {claim:{claimRef, holder, claimedAt}}` |

Bodies are closed (unknown fields → `400 REQUEST_INVALID`); commands without
input accept no body or `{}`.

`ObjectView` exactly as the spec: `{objectId, revision, status, purpose,
contentType, byteLength, sha256, ownerSubjectId, rejectReason, claimed,
createdAt, finalizedAt, expiresAt}`. `expiresAt` is the reservation deadline
while `status = RESERVED`, otherwise `null`. No `scan` field (see §5).

`upload = {method:'PUT', url, headers, expiresAt}` with exactly the signed
headers `content-type`, `content-length` (set by the browser) and
`x-amz-checksum-sha256` (base64 of the declared SHA-256). `upload` is `null`
on a replay whose reservation is no longer open.

Reasons requested for the owner allowlist: `OBJECT_NOT_FOUND` (404, also for
another owner's object), `OBJECT_NOT_AVAILABLE` (409), `UPLOAD_MISSING` (409),
`STORAGE_UNAVAILABLE` (503, under `DEPENDENCY_UNAVAILABLE`, retryable),
`IDENTITY_UNAVAILABLE`, `STORE_BUSY`, `CONCURRENT_UPDATE`. `IDEMPOTENCY_CONFLICT`
and `IDEMPOTENCY_KEY_REQUIRED` are shared codes. `UPLOAD_MISMATCH` and
`UNSUPPORTED_MEDIA` are values of `ObjectView.rejectReason`, returned with
`200` by finalize: the rejection is a durable, replayable outcome, not a
transient error. The spec lists `REVISION_CONFLICT`; no media.v1 route takes a
revision, so it is never produced. Please confirm or amend these two
interpretations when publishing.

Idempotency: scope = caller + operation (`reserve`, `finalize`); fingerprint =
canonical JSON of the declared upload / of the object id; retention 7 days
(purged by the worker). A refused finalize (`UPLOAD_MISSING`,
`STORAGE_UNAVAILABLE`, `OBJECT_NOT_AVAILABLE`) leaves no record, so the same key
can be retried.

Requested package additions (lockfile is Lane E's): `@carwash/contracts:
workspace:*` in `services/media/package.json` to import the error envelope
instead of the local closed subset in `transport/http/http-errors.ts` (today
verified against the published `parseApiErrorEnvelope` by
`tests/production/C/media-s3.test.mjs`). Requested scripts: `start:purge`
(`node dist/workers/purge.main.js`), `test:unit`, `test:integration`.

## 2. Service-to-service identity and scopes

Interim: `x-service-client` / `x-service-token`, SHA-256 digests in
`MEDIA_SERVICE_CLIENTS`. Requested grants for **Dispatch** under the platform
workload identity: `media.object.read` (verify owner/purpose/status before
attaching, issue read URLs for operator views) and `media.object.claim`
(record the evidence slot as holder `dispatch.task-evidence`). Same request as
CR-P02-C3 §4 for the identity mechanism itself.

## 3. Gateway routes (consumer: operator-web, C5)

Same-origin browser paths, session-authenticated by the gateway and forwarded
with the user's bearer token:

| Browser path | Upstream |
| --- | --- |
| `POST /api/operator/media/uploads` | `POST /internal/v1/media/uploads` (forward `Idempotency-Key`) |
| `POST /api/operator/media/objects/:id/upload-url` | `POST /internal/v1/media/objects/:id/upload-url` |
| `POST /api/operator/media/objects/:id/finalize` | `POST /internal/v1/media/objects/:id/finalize` (forward `Idempotency-Key`) |
| `POST /api/operator/media/objects/:id/read-url` | `POST /internal/v1/media/objects/:id/read-url` |

The gateway must not log or cache response bodies of these routes (they carry
presigned URLs). The upload itself goes from the browser to the object store,
not through the gateway.

## 4. Production object store

A private bucket (no public ACL/policy), encryption at rest (KMS-managed key),
TLS endpoint, a lifecycle rule as a backstop for `uploads/` (e.g. delete after
2 days), versioning/object-lock decision, backup/replication decision, and a
least-privilege credential for Media limited to `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject` on `arn:…:<bucket>/objects/*` and `…/uploads/*`. CORS on the
bucket for the operator-web origin: `PUT` with headers `content-type`,
`x-amz-checksum-sha256`; `GET`. Media needs the endpoint, region, bucket and
credential through its secret store (`MEDIA_S3_*`). Bucket creation is not done
by the service.

## 5. Scanning and image processing

No malware scanner exists; Media verifies only exact length, SHA-256 and the
JPEG/PNG/WebP signature. Requested: a scanning provider decision (and whether
an object must be `SCANNED_CLEAN` before AVAILABLE, which would add a state and
a `scan` field to `ObjectView`), and an owner decision on server-side image
re-encoding / EXIF-GPS stripping before evidence is shown to customers.
