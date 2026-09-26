# F006 Identity runbook

## Build and verify

Use the exact `.nvmrc` and `packageManager` pins. After frozen install:

```sh
pnpm generate
pnpm build
pnpm typecheck
pnpm test:unit
pnpm exec playwright install --with-deps chromium
pnpm acceptance:identity
pnpm acceptance:run
```

Both acceptance commands create disposable run-scoped infrastructure, never use production
credentials, and remove only their own project volumes. Evidence under `evidence/identity`
contains redacted results, not `.acceptance` secret contexts, private keys, cookies or HAR files.
An absent/skipped/failed browser or real-service suite is a failure, not an accepted sprint.

## Runtime configuration

Identity is the owner at `services/identity`, not a new `identity-service` directory.
Apply migrations using its migration identity in a separate deployment job. Runtime credentials
must remain `cw_identity_app` and cannot run DDL or read `_prisma_migrations`.
Set `IDENTITY_AUTH_ENABLED=true`, `APP_ENV=production` or `staging`, `DATABASE_URL`,
`IDENTITY_REDIS_URL` (authenticated rediss), `IDENTITY_ISSUER`, `IDENTITY_AUDIENCE`,
`IDENTITY_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins), and `COOKIE_SECURE=true`.
Mount secret files and point these variables at their paths:

- `IDENTITY_PRIVATE_KEY_FILE`: RSA PKCS8 private key, at least 3072 bits.
- `IDENTITY_OTP_PEPPER_FILE`, `IDENTITY_CSRF_KEY_FILE`, `IDENTITY_RATE_KEY_FILE`: independent
  cryptographically generated 32–256 byte secret values, shared only among Identity replicas.
- `IDENTITY_OTP_DELIVERY_TOKEN_FILE`: the configured delivery adapter bearer token.

`IDENTITY_OTP_DELIVERY_URL` is a fixed HTTPS adapter URL. Its POST contract is
`{channel:'email',recipient,code,expiresAt}` with an Idempotency-Key bound to challenge/generation.
The provider must honor that key and must not log OTPs. Redirects and blind retries are prohibited.
Secrets are mounted, never included in source, container layers or command-line arguments.
`APP_ENV=development` permits explicitly configured loopback HTTP/insecure cookies only;
there is no automatic fallback in hardened environments. A failed Redis budget returns 503
rather than granting access; restore Redis then restart this version's Identity process.

## HTTP contract

Base path `/internal/v1/identity`. Fetch `GET /csrf` before cookie-bound writes and return the
readable CSRF cookie in `X-CSRF-Token`. `POST /register` and `/login` accept email/password and
return a challenge receipt, not authentication. `POST /challenges/resend` rotates a challenge;
`POST /challenges/verify` consumes a valid OTP and sets cookies. `POST /refresh`, `/logout`,
`/logout-all` operate on server-owned sessions. `GET /session` returns current granular grants.
`GET /.well-known/jwks.json` exposes public keys only. Account `/accounts/:id/status` and `/roles`
writes require their explicit Identity permissions and fresh authorization; clients cannot
self-register administrative roles. Provision the first super-admin through a separately audited,
offline owning-service operation, never a public registration switch.

Consumers of access tokens must verify issuer/audience/algorithm/kid/expiry and ask Identity for
current session authorization before sensitive operations. Do not trust external x-user-* headers.
The gateway must preserve each separate Set-Cookie header and exact Origin, never echo credentials.
All failures use `{error:{code,message,requestId}}`; clients handle codes, not SQL/error prose.

## Rotation, retention and recovery

Load a new private key alongside `IDENTITY_PREVIOUS_JWKS_FILE` containing old public keys only.
Publish old public keys for at least five minutes plus clock skew, then remove them. Revoke session
families after suspected compromise. Do not delete used refresh rows before their family expires:
they detect token replay. An owning-service retention job should remove expired challenges and
expired session/refresh history only after the documented security retention window; the schedule
and audit retention duration are deployment decisions, not silently enabled destructive jobs.

On delivery outage, generation INVALID is the compensating state. Retrying a new challenge request
is rate-limited; resend uses a fresh generation and never reveals the old code. On refresh response
loss, replay revokes the family intentionally: sign in again rather than weakening replay defense.
Back up Identity's database and protected key material separately; HA/backup/restore drills are not
proven by these disposable foundation tests.
