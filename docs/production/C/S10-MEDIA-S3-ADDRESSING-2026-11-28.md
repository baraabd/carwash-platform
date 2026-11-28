# S10 Media S3 addressing — 2026-11-28

Railway's authenticated, redacted bucket metadata for this task identified
`mediaobjects-p68komqrezcu`, base endpoint `https://t3.storageapi.dev`, region
`auto`, and URL style `virtual-host`. The previous Media adapter always put the
bucket in the request path and could not express that provider contract.

[Railway's storage documentation](https://docs.railway.com/storage-buckets#url-style)
requires the style reported for the bucket; older buckets may use path style.
[Tigris's migration notice](https://www.tigrisdata.com/blog/virtual-hosted-urls)
states that its newer buckets require virtual-hosted addressing. This is an
addressing requirement, not evidence of an authenticated object operation.

## Configuration and behavior

`MEDIA_S3_URL_STYLE` accepts exactly `path` or `virtual-host`. Omitting it keeps
the existing `path` behavior for current deployments and local S3 emulators.
For this Railway bucket, both the Media API and purge worker need:

```text
MEDIA_S3_ENDPOINT=https://t3.storageapi.dev
MEDIA_S3_REGION=auto
MEDIA_S3_BUCKET=mediaobjects-p68komqrezcu
MEDIA_S3_URL_STYLE=virtual-host
```

Credentials remain protected provider references; none are included here.
The provider's existing access-key identifier includes an underscore. The
loader now accepts underscores alongside its existing ASCII alphanumeric
characters, retaining the 3–128 character bound and rejecting whitespace,
control characters and URL/header separators. Tests use only a synthetic
`tid_` identifier; no live credential is stored in source or evidence.
The endpoint is the base origin, not an already bucket-prefixed hostname.
Virtual-host configuration rejects IP/invalid DNS endpoints, invalid bucket DNS
labels and an overlong combined hostname before signing. The resulting origin
is `https://mediaobjects-p68komqrezcu.t3.storageapi.dev`, with `/` for bucket
operations and `/<key>` for objects. The chosen address is constructed before
Signature V4 is calculated, for HEAD/GET/PUT/DELETE and presigned GET/PUT alike.
No redirect fallback or unsigned retry is added. Provider errors still cannot
expose credentials, signatures or response bodies through the adapter.

Operator's `OPERATOR_MEDIA_ORIGINS` must allow that exact bucket origin; the
provider's CORS policy must allow the actual Operator web origin and upload
headers. This does not change any UI or approved reference baseline.

## Verification boundary

Focused tests check configuration rejection, path-style compatibility, all
adapter operations and the actual adapter's presigned output against AWS's
published virtual-host Signature V4 example. The existing real S3/PostgreSQL
CI suites remain mandatory for the final source. These checks do not prove
that this Railway bucket accepted a signed request, its CORS/private policy,
or upload/finalize/read/purge/restart behavior. Retain those hosted results
separately before accepting S10/S11.

## Actual provider probe — 08:58–08:59 UTC

The [sanitized provider record](evidence/S10-media-s3-provider-probe-2026-11-28.json)
records a successful execution of the compiled adapter against the existing
staging bucket. Existing credentials stayed in the probe process; no credentials
were created, rotated, printed or written to the evidence. One synthetic 68-byte
PNG was uploaded under a unique task-owned key and removed in cleanup.

- The actual provider configuration passed the repaired loader. The earlier
  alphanumeric-only identifier grammar would reject its access-key identifier.
- Virtual-host bucket HEAD, authenticated object PUT/GET and presigned PUT/GET
  succeeded; read bytes matched the fixture hash.
- Anonymous access to that existing object returned 403.
- DELETE returned 204, and the authenticated follow-up GET returned 404.
- Read-only CORS inspection returned `404 NoSuchCORSConfiguration`. Browser
  upload acceptance remains pending configuration for the actual web origins.
- The diagnostic legacy path-style bucket HEAD also returned 200. This result
  does not establish legacy object-operation compatibility, and no claim is
  made that every path-style request is rejected. Deployment selects the
  provider-reported virtual-host contract explicitly.

The probe started while the repair worktree was uncommitted, which is preserved
as `dirtyAtStart: true` in the original record. Source and compiled-file hashes
remained unchanged throughout execution. The three recorded TypeScript hashes
were then verified against commit `0bbfc921b0e85b4cf4fa4d71d5d72b224a22eb2f`
(cherry-picked from `2e52a71805d06b932aa641e82764082ee7944f40`). This binds the
observed adapter code without relabelling the run as an immutable-image or
deployed-application acceptance. The original report SHA-256 is
`a637f45ad5da8c4c6a1a547c2748349e806c62487cc53df0ed6f70260a73b002`.

No Media API, owner database, purge worker, browser journey or production
deployment was exercised by this probe. Those gates remain mandatory.
