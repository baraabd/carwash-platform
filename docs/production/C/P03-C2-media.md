# P03-C2 — Media provider: work-evidence objects (`media.v1`, requested)

Child of P03-C (Lane C: dispatch and the real technician job execution). One
branch, one PR from `main`; not stacked on any other child. The binding spec is
section "C2 — Media" of `P03-C-interfaces.md` (unchanged by this child). The
parent stays **INTEGRATION_PENDING** until Dispatch (C4) consumes these routes
and Lane E publishes `media.v1`.

## Responsibility boundary

Media owns evidence **bytes** and object **metadata**: who uploaded an object,
its declared and verified type, size and SHA-256, its lifecycle, and which
holder keeps it. Dispatch stores only opaque object ids and asks Media to claim
them; Media never learns tasks, bookings, customers or prices. The bucket is
private; bytes leave it only through short-lived presigned GETs that Media
issues after an authorization check.

```
transport/http       MediaController, ActorResolver, MediaHttpFilter
                     (closed bodies, per-actor budget, shared error envelope)
application          MediaService (commands, queries, purge pass), policy, authorization
domain               content rules (types, sizes, magic bytes), object state machine (pure)
ports                Clock, IdGenerator, MediaUnitOfWork/Transaction, MediaReadModel, ObjectStore
infrastructure       PrismaMediaStore (raw SQL + row locks), S3ObjectStore + SigV4 (node:crypto,
                     global fetch), IdentitySessionClient, ServiceClientAuthenticator, config
workers              purge.main (standalone process, --once / --batch / --interval-ms)
```

`node scripts/check-layers.mjs` passes: domain, application and ports import no
Nest, Prisma, pg or fetch. No dependency was added; SigV4 is implemented on
`node:crypto` and reproduces the three published AWS S3 examples byte for byte.

## State machine

```
RESERVED  -> AVAILABLE   finalize: stored bytes match length + SHA-256 + signature
RESERVED  -> REJECTED    finalize: they do not (UPLOAD_MISMATCH | UNSUPPORTED_MEDIA)
RESERVED  -> EXPIRED     worker: deadline + grace passed without finalize
AVAILABLE -> PURGED      worker: unclaimed for the retention window
```

REJECTED, EXPIRED and PURGED are terminal. Every transition is `version + 1`,
applied with `UPDATE … WHERE version = $read` on a row read `FOR UPDATE`.

## Invariants: application vs database

| Invariant | Application | Database |
| --- | --- | --- |
| status / purpose / type / size 20..10 MiB / hex digest | `declaredUpload`, types | CHECK constraints |
| each status has exactly its timestamps and reason | domain transitions | CHECKs `media_object_{reject,finalized,expired,purged,swept}_ck` |
| only the four transitions above, each `version + 1` | `mark*` functions | trigger `media_object_guard` |
| declared metadata (owner, type, size, digest, deadline) immutable | no setter | trigger `media_object_guard` |
| object rows are retained (purge is a status) | no delete path | trigger refuses DELETE |
| claim only on AVAILABLE, inside the claim window | `assertClaimable` under row lock | trigger `object_claim_guard` (AVAILABLE) |
| a claimed object is never purged | `isPurgeDue(claimed)` under row lock | trigger refuses → PURGED with claims |
| one claim per (object, claimRef); claims append-only | find-then-insert under the object lock | PK + trigger |
| one result per idempotency key | claim/complete in the command transaction | PK `(scope, idempotency_key)` |
| audit is append-only | — | trigger refuses UPDATE/DELETE |
| lost update | version read under `FOR UPDATE` | version guard |

Lock order everywhere: idempotency record → media object → claims. READ
COMMITTED with explicit row locks; deadlock/serialization failures re-run the
whole local transaction (bounded) and otherwise surface as a retryable 503.

## Upload / finalize sequence

1. `POST /uploads` (`work.execute:assigned`, `Idempotency-Key`) with
   `{purpose:'WORK_EVIDENCE', contentType, byteLength, sha256}`. One local
   transaction stores the RESERVED row (owner = caller), the audit row and the
   idempotency record. Response `201` (`200` on replay) = `ObjectView & {upload}`.
   Reservation deadline: 15 min by default (5–60 min).
2. `upload = {method:'PUT', url, headers, expiresAt}`; the URL targets the
   **staging** key `uploads/<objectId>` and signs `host`, `content-type`,
   `content-length` and `x-amz-checksum-sha256` (base64 of the declared digest).
   Its lifetime is `min(upload TTL (5 min default), reservation deadline)`. The
   client sends exactly those headers (the browser sets `content-length`).
   Measured on SeaweedFS: a different length or type is `403
   SignatureDoesNotMatch`, different bytes are `400 BadDigest`, an expired URL is
   `403 AccessDenied`, an unsigned GET is `403`. Media does **not** rely on the
   checksum enforcement (another store may not do it).
3. `POST /objects/:id/upload-url` re-issues a URL while the reservation is open
   (the retry path after a failed or expired upload).
4. `POST /objects/:id/finalize` (owner, `Idempotency-Key`):
   - network I/O first, **outside any transaction**: read at most
     `byteLength + 1` bytes of the staging key (signed GET), compute SHA-256,
     sniff the first 12 bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`,
     WebP `RIFF….WEBP`). If accepted, the server writes the bytes it verified to
     `objects/<objectId>` with a signed payload digest and the checksum header;
   - then one transaction: idempotency claim, `SELECT … FOR UPDATE`, re-check
     (still RESERVED and before the deadline), transition, audit, complete;
   - after commit, best effort: delete the staging key, and for REJECTED also
     the final key. The sweep (below) repeats this once no URL can be valid.
5. Readers: `GET /objects/:id` and `POST /objects/:id/read-url` (owner with a
   work permission, or a service with `media.object.read`). The read URL is a
   presigned GET of `objects/<id>`, TTL 120 s by default (60–300), AVAILABLE only.

Why a staging key: the presigned PUT stays valid for minutes after finalize.
If the client could PUT straight to the final key, it could replace verified
bytes after AVAILABLE. Only the server writes `objects/<id>`, so the bytes a
reader gets are always the ones that were verified. (The spec's "bytes live
under `objects/<objectId>`" holds for every AVAILABLE object.)

### Failure, retry and UNKNOWN handling

| Situation | Answer | State | Retry |
| --- | --- | --- | --- |
| nothing uploaded yet | `409 CONFLICT` reason `UPLOAD_MISSING` | unchanged, no idempotency record | same request, same key, after uploading |
| S3 timeout, refused connection, 5xx, 403, unexpected answer | `503 DEPENDENCY_UNAVAILABLE` reason `STORAGE_UNAVAILABLE`, `retryable:true` | unchanged (never success) | same key |
| bytes differ (length or digest) | `200`, `status:'REJECTED'`, `rejectReason:'UPLOAD_MISMATCH'` | REJECTED, bytes deleted | new reservation |
| bytes are not the declared format | `200`, `REJECTED`, `UNSUPPORTED_MEDIA` | REJECTED, bytes deleted | new reservation |
| already AVAILABLE/REJECTED | `200` with the stored outcome | unchanged | — |
| reservation past its deadline / EXPIRED / PURGED | `409 CONFLICT` reason `OBJECT_NOT_AVAILABLE` | unchanged | new reservation |
| client timeout / crash after commit (UNKNOWN to the client) | — | committed once | same key returns the committed result |
| API killed between write of final key and commit | — | RESERVED; final key may exist | same key re-verifies; or the worker deletes both keys at expiry |
| two finalizes at once | both `200` with the same outcome | one transition, one audit row | — |

`UPLOAD_MISSING` is "retryable" in the spec's sense (retry after uploading);
the shared envelope's `retryable` flag stays `false` for `CONFLICT`, as the
published `API_ERROR_RETRYABLE` table requires. The same idempotency key is
still usable because a refused finalize commits nothing.

## Claims and the saga direction with Dispatch

`POST /objects/:id/claims` (service scope `media.object.claim`) with
`{claimRef:uuid, holder:'dispatch.task-evidence'}` records that a holder keeps
the object. Idempotent per `(object, claimRef)`: the first call is `201`,
repeats are `200` with the same claim. Only AVAILABLE objects inside their claim
window (`finalizedAt + retention − guard`, guard 1 h by default) can be claimed.

Intended Dispatch sequence (C4): check the object (`GET`, owner/purpose/status)
→ claim in Media with a `claimRef` derived from the evidence slot write → commit
the slot in Dispatch. If Dispatch's commit fails after the claim, Media keeps an
extra claim: the evidence is retained longer than necessary. That is the
**safe direction** (no data loss, no dangling link to deleted bytes); a claim is
never released by Media. Retrying with the same `claimRef` is a no-op. The
opposite order (commit link, then claim) could leave a link to bytes the purge
deletes, and is not supported. Release of claims (with retention policy for
replaced evidence) is future work for the owner policy.

### Purge versus claim

The claim window closes `guard` before purge eligibility starts
(`claimDeadline = finalizedAt + retention − guard`, purge at
`finalizedAt + retention`). A purge that already deleted the bytes can therefore
never be followed by a successful claim, even across replicas whose clocks
disagree by less than the guard, and even if the worker crashed between the
delete and its commit. A unit test checks that the two windows never overlap.

## Purge worker

`node dist/workers/purge.main.js [--once] [--batch N] [--interval-ms N]`, any
number of replicas. Each pass, bounded by `--batch`:

1. RESERVED with `deadline + grace (2 min)` passed → delete both keys → EXPIRED;
2. unclaimed AVAILABLE with `finalizedAt + retention (24 h default, 2 h–30 d)`
   passed → delete both keys → PURGED;
3. finalized objects whose URLs have all expired → delete residual keys (staging
   upload; final key of a REJECTED object), set `storage_swept_at` (no new revision);
4. idempotency records older than 7 days, deleted in bounded batches.

Each object is handled in its own transaction under `FOR UPDATE SKIP LOCKED`
with eligibility re-checked under the lock; the bytes are deleted **before** the
transition commits, so a crash leaves the row for the next pass (deletes are
idempotent). The worker holds one row lock across at most two bounded deletes
(`MEDIA_S3_TIMEOUT_MS` ≤ 10 s); its pool uses `idle_in_transaction_session_timeout`
= 25 s, the API's = 5 s (API transactions never wait on the network).

## Configuration (validated at start; the process exits 1 naming the variable)

`DATABASE_URL` (runtime role), `IDENTITY_URL`, `IDENTITY_TIMEOUT_MS`,
`MEDIA_SERVICE_CLIENTS` (JSON of `{id, tokenSha256, scopes}`),
`MEDIA_S3_ENDPOINT` (origin only; `https`, or `http` to loopback, or with
`MEDIA_S3_ALLOW_PLAINTEXT=true`), `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`,
`MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, `MEDIA_S3_TIMEOUT_MS`
(100–10000), `MEDIA_S3_MAX_CONCURRENT_READS` (1–32; bounds memory, each read
≤ 10 MiB + 1), `MEDIA_RESERVATION_TTL_SECONDS`, `MEDIA_UPLOAD_URL_TTL_SECONDS`,
`MEDIA_READ_URL_TTL_SECONDS`, `MEDIA_UNCLAIMED_RETENTION_SECONDS`,
`MEDIA_CLAIM_GUARD_SECONDS`, `MEDIA_EXPIRY_GRACE_SECONDS`,
`MEDIA_USER_REQUESTS_PER_MINUTE`, `MEDIA_SERVICE_REQUESTS_PER_MINUTE`. The API
and the worker must share the retention settings. A module composed without
any `MEDIA_S3_*` value (the pre-existing compile test) gets a store that refuses
every call; the entry points never start that way.

## Migration and rollback

`services/media/prisma/migrations/20261010090000_p03c2_media_objects`:
expand-only (four new tables, CHECKs, indexes, one FK, three trigger functions
and triggers). Nothing existing is altered or dropped. Applied by
`cw_media_migrate`; the runtime role has DML only, cannot run DDL, cannot
disable the triggers and cannot read `_prisma_migrations` (asserted by tests).
`prisma migrate diff` between the migrated database and `schema.prisma` is
empty (CHECKs and triggers live in SQL only).

Rollback: redeploy the previous image; it does not use the new tables. Dropping
them (and the bucket contents) is a separate reviewed step with a backup, not
part of this change. No data is migrated.

## Security and privacy

- Deny by default. Users via Identity's session view: `work.execute:assigned`
  to reserve, re-issue and finalize; owner with `work.read:assigned` or
  `work.execute:assigned` to read. Services via interim digest credentials:
  `media.object.read`, `media.object.claim`. Services never upload; users never claim.
- Another owner's object, and an unknown id, are both `404 OBJECT_NOT_FOUND`.
- Keys are `objects/<objectId>` and `uploads/<objectId>`: no personal data in
  keys or URLs. The bucket is private (anonymous GET is `403`, tested).
- Presigned URLs, keys, signatures, credentials and subject ids never reach
  logs (the HTTP filter logs code/status/ids only; storage errors carry no URL;
  a lane test scans the API process output) or audit details (tested).
- Audit rows: `media.reserved`, `media.finalized`, `media.rejected`,
  `media.claimed`, `media.read-url.issued`, `media.expired`, `media.purged`.
- Error bodies: shared envelope, fixed messages, correlation and request ids;
  bodies are validated by the published `parseApiErrorEnvelope`. Per-actor
  budget answers `429` with `retryAfterMs` and `retry-after`.
- Content checks are signature sniffing only. `ObjectView` has no `scan` field,
  so none is reported; there is **no malware scanner** (external blocker).

## Evidence

Produced by `node scripts/production/C/verify.mjs media` on a clean tree; the
exact commit, tree, images and counts are in the PR description.

| Family | Real dependency | Doubles | Suites |
| --- | --- | --- | --- |
| unit | none | in-process stubs | `test/unit/sigv4.spec.ts` (AWS vectors), `domain.spec.ts`, `edge-security.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, two pools as replicas | in-memory ObjectStore (DB behaviour only) | `test/integration/media.pg.spec.ts` |
| http | real Nest server, PostgreSQL, SeaweedFS | Identity session endpoint | `test/integration/http.pg.spec.ts` |
| lane: S3 | compiled API/worker processes, SeaweedFS S3 (SigV4), PostgreSQL, published error parser | Identity session endpoint | `tests/production/C/media-s3.test.mjs` |
| lane: restart | compiled API/worker, SIGKILL mid-finalize/-reserve/-sweep | Identity session endpoint | `tests/production/C/media-restart.test.mjs` |

The pre-existing `test/media.nest.spec.ts` (module compile, live/ready) still passes.

## Not proven here

- No malware/AV scanning; no image decoding, re-encoding, dimension limits or
  EXIF/GPS metadata stripping (the reference's client-side re-encode is not a
  server guarantee).
- No production bucket, encryption at rest/KMS, bucket policy, lifecycle rules,
  versioning/object lock, replication or backup; no CDN.
- AWS S3 itself (only SeaweedFS and the published AWS signing examples).
- Identity token verification (Identity's own suites); the production workload
  identity for service callers.
- Gateway routes `/api/operator/media/...` and the browser upload from
  operator-web (C5), and Dispatch's claim call (C4).
- Load beyond the concurrency tests; multi-node PostgreSQL failover.

## Blockers (external to this child)

- CR-P03-C2 §1: Lane E to publish `media.v1` (HTTP contract, reasons, views);
  readiness stays 503 until then.
- CR-P03-C2 §2: scopes `media.object.read` and `media.object.claim` for Dispatch
  under the platform workload identity.
- CR-P03-C2 §3: gateway routes `/api/operator/media/uploads` and
  `/api/operator/media/objects/:id/(upload-url|finalize|read-url)`.
- CR-P03-C2 §4: production object store (private, encrypted, lifecycle) and its
  CORS rule for direct browser PUT/GET.
- CR-P03-C2 §5: a malware scanning provider and an image-processing decision
  (re-encode / EXIF strip).
