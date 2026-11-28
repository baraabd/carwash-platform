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
