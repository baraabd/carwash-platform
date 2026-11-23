# CR-P03-C5 — operator-web gateway routes, session flow and CSP

Status: **REQUESTED** (Lane C → Lane E; items 5–7 also to the named producers).
Requester: P03-C5 operator-web. Base: `main@a14997a20b85341a24f17e7878d2a188eea3fe36`.
Nothing here is published. The browser client and the test harness
(`tests/production/C/support/operator-gateway.mjs`) implement the *requested*
shape so the routes can be verified unchanged when Lane E publishes them.

## 1. Publish the `/api/operator/*` gateway routes (C5 table)

Same-origin, cookie session, JSON only. Exact mapping used by the client:

| Browser | Method | Upstream (owner) | Permission |
| --- | --- | --- | --- |
| `/api/operator/session` | GET | identity `/internal/v1/identity/session` | authenticated |
| `/api/operator/availability` | GET, PUT | workforce `/internal/v1/workforce/me/availability` | `work.read:assigned` / `work.execute:assigned` |
| `/api/operator/jobs` | GET | dispatch `/internal/v1/dispatch/me/jobs` | `work.read:assigned` |
| `/api/operator/tasks/:id` | GET | dispatch `/internal/v1/dispatch/me/tasks/:id` | `work.read:assigned` |
| `/api/operator/offers/:id/(accept\|decline)` | POST | dispatch `/internal/v1/dispatch/offers/:id/…` | `work.execute:assigned` |
| `/api/operator/tasks/:id/(depart\|arrive\|start\|document\|finish\|close\|cash-collection\|release\|notes)` | POST | dispatch `/internal/v1/dispatch/tasks/:id/…` | `work.execute:assigned` |
| `/api/operator/tasks/:id/(condition-note\|checklist/:code)` | PUT | dispatch | `work.execute:assigned` |
| `/api/operator/tasks/:id/evidence/(BEFORE\|AFTER)/(0\|1)` | PUT, DELETE | dispatch | `work.execute:assigned` |
| `/api/operator/bookings/:id` | GET | booking `/internal/v1/booking/bookings/:id/technician-view` | `work.read:assigned` |
| `/api/operator/media/uploads` | POST | media `/internal/v1/media/uploads` | `work.execute:assigned` |
| `/api/operator/media/objects/:id/(upload-url\|finalize\|read-url)` | POST | media `/internal/v1/media/objects/:id/…` | owner |

Requirements the client relies on:

- Forward `Idempotency-Key`, `x-correlation-id`, `content-type`; inject the
  access token from the session cookie; never forward the cookie upstream.
- Pass the producer's shared error envelope through unchanged
  (`{error:{code,reason,message,requestId,correlationId,retryable,retryAfterMs,issues}}`).
  The client branches on `code` + `reason`, never on status alone
  (Dispatch `412 REVISION_CONFLICT`; Workforce `409 CONFLICT/REVISION_CONFLICT`;
  `TASK_NOT_FOUND`, `TASK_CLOSED`, `BOOKING_NOT_FOUND`, `ASSIGNMENT_UNVERIFIED`, …).
- Unsafe methods: JSON object body (DELETE carries `{expectedRevision}`), same
  Origin, `sec-fetch-site` not cross-site, `x-csrf-token` accepted when the
  Identity CSRF cookie is readable.
- No caching (`cache-control: no-store`) on every `/api/operator/*` response.
- Never a redirect: the client uses `redirect: 'error'`.

## 2. Operator session / login flow (TI-D02)

No approved technician login, invitation or onboarding screen exists. The
client reads `/api/operator/session`; without a session it shows only a
minimal pending status line and renders no job. Lane E/Identity must decide:
where the technician signs in (shared Identity page or a new approved
screen), logout, session expiry/renewal behaviour and the cookie names on the
operator origin (`__Host-wg_access` assumed; the harness uses loopback `wg_access`).
Any new screen requires owner design approval.

## 3. CSP and object-store origin

`apps/operator-web/server.mjs` now serves:
`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: <media>; connect-src 'self' <media>; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
where `<media>` is `OPERATOR_MEDIA_ORIGINS` (comma-separated exact origins,
https only except loopback). Request:

- the presigned object-store origin(s) per environment for `OPERATOR_MEDIA_ORIGINS`;
- bucket CORS allowing `PUT` and `GET` from the operator origin with request
  headers `content-type` and `x-amz-checksum-sha256` (the fixture store enforces both);
- confirmation that presigned GET URLs may be used as `<img src>` (TTL 60–300 s).

Inline style attributes are never parsed from markup: the port applies the
reference's inline declarations through the CSSOM, so `style-src 'self'` holds.

## 4. Shapes the client ASSUMES (please confirm or publish)

| Item | Assumed shape (closed parsing) |
| --- | --- |
| `GET /me/jobs` | `{offers:[{offerId,revision,status,expiresAt,taskId,job:{assignmentId,bookingId,zoneId,startsAt,endsAt,status}}], tasks:[{taskId,revision,stage,assignmentId,bookingId,acceptedAt,closedAt,endedAt,endReason,attentionReason,collection,updatedAt,zoneId,startsAt,endsAt}]}` (provider fact from the P03-C candidate) |
| task mutation responses | not relied upon; the client re-reads `GET /me/tasks/:id` |
| `read-url` response | `{method:'GET', url, expiresAt}` |
| `upload-url` response | `ObjectView & {upload}` (same as `POST /uploads`) |
| `history[].action` | `accepted, departed, arrived, evidence.(before\|after).(attached\|removed), started, check.done, documented, finished, closed, released, cash.late-declared, note.(help\|payment-follow-up\|cash-issue)`; unknown actions are not displayed |
| notes / accept / decline bodies | no `expectedRevision` (C4 rows); accept `{}`, decline `{reason:'OTHER', note}` |

## 5. Data gaps against the approved screens (to the producers)

| Gap | Producer | Request |
| --- | --- | --- |
| D1 human booking reference | Booking (C3) | add a short, non-PII `reference` to the technician view; the UI shows the first 8 hex digits of the id meanwhile |
| D2 service / add-on names | Booking (C3) + Catalog | add display titles (catalog snapshot) to `lines[]`; the UI shows the reference labels «الخدمة»/«الإضافات» meanwhile |
| D7 distance / ETA | Geo (TI-D11) | none available; illustrative numbers removed |
| D8 technician display name | Workforce/Identity | a `displayName` for the signed-in operator; the UI shows no name meanwhile |
| D9 wallet payment verification | Billing | a purpose-limited technician projection of payment status; wallets are never shown as verified meanwhile |
| D10 booking details before acceptance | Booking (C3) | allow `technician-view` for a live OFFERED offer addressed to the caller (the approved assigned screen shows car, service, address and value before «استلام المهمة») |
| Cash receipt | Billing (PR #111, unpublished) | the technician's cash is declared to Dispatch (`close` / `cash-collection`); the Billing receipt call is a pending integration, not invented here |

## 6. Acceptance for this CR

The P03-C integration candidate runs `tests/production/C/operator-web-journey.test.mjs`
with the harness upstreams pointed at the real services (no fixture), plus the
published gateway in front of the built `apps/operator-web/dist`.

## Lint configuration (merge-order blocker)

`eslint.config.mjs` (Lane E) matches `apps/operator-web/src/**/*.ts` only in a
globals block without a TypeScript parser, so `pnpm lint` (sprint-02-ci) cannot
parse the typed operator-web sources and fails. Requested change: remove
`apps/operator-web/src/**/*.ts` from that block and add it to the type-aware
block's `files` (with `apps/operator-web/tsconfig.json` reachable by the
project service). The sources were linted clean under exactly that
configuration as a temporary local config; no rule was relaxed. Merge E's
change before (or together with) this PR.
