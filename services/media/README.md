# media-service

**Status: implemented provider of the requested `media.v1` (work evidence);
not business-ready.** `/health/ready` answers 503 until Lane E publishes the
contract and release acceptance runs on exact source. Design and evidence:
`docs/production/C/P03-C2-media.md`; requests to Lane E:
`docs/production/C/contract-requests/CR-P03-C2-media-v1.md`.

Owns evidence bytes (private S3 bucket, keys `objects/<objectId>` and the
staging `uploads/<objectId>`) and object metadata in database `cw_media`:
`media_object`, `object_claim`, `idempotency_record`, `audit_entry`. No other
service may read or write these tables or the bucket.

## Routes (`/internal/v1/media`)

| Method | Path | Caller |
| --- | --- | --- |
| POST | `/uploads` | user `work.execute:assigned`, `Idempotency-Key` |
| POST | `/objects/:id/upload-url` | owner, while RESERVED |
| POST | `/objects/:id/finalize` | owner, `Idempotency-Key` |
| GET | `/objects/:id` | owner, or service `media.object.read` |
| POST | `/objects/:id/read-url` | owner, or service `media.object.read`; AVAILABLE only |
| POST | `/objects/:id/claims` | service `media.object.claim` |

States: `RESERVED → AVAILABLE | REJECTED | EXPIRED`, `AVAILABLE → PURGED`.

## Processes

- API: `node dist/main.js` (validates the whole configuration first, exits 1 naming the bad variable).
- Purge worker: `node dist/workers/purge.main.js [--once] [--batch N] [--interval-ms N]`.

Configuration: see "Configuration" in `docs/production/C/P03-C2-media.md`.

## Tests

```
node scripts/production/C/stack.mjs up
pnpm --filter @carwash/media run generate && pnpm --filter @carwash/media run build
node scripts/production/C/verify.mjs media      # unit, postgres, lane (S3, restart)
node scripts/production/C/stack.mjs down
```

Not provided: malware scanning, image re-encoding/EXIF stripping, production
bucket/KMS/lifecycle, CDN. Layers: domain → application → ports ← adapters ←
transport; do not import another service's source or Prisma client.
