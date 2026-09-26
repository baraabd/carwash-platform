# ADR 0007 — Identity-owned credentials and browser sessions

Status: implemented for F006; acceptance is reported per tested SHA, not inferred from this ADR.

## Canonical ownership

The catalog names `services/identity` and `@carwash/identity`. The sprint shorthand
`identity-service` is not a second owner or a reason to rename the service. Identity owns
password hashes, OTP challenge fingerprints, session families, refresh history, role grants,
audit records and user-token private signing material. Other services get a public JWKS only.
`@carwash/contracts` defines versioned external types; `@carwash/security-kit` contains only
technical verification, cookie/CSRF, opaque-secret and Redis budget primitives.

## Opt-in runtime

`IDENTITY_AUTH_ENABLED=true` starts the actual Identity API. Missing/false retains the existing
foundation shell and its honest 503 readiness. The enabled service fails startup without the
required key files, authenticated Redis, exact allowed origins and an HTTPS OTP delivery port.
There is no runtime fake-delivery flag, password seed endpoint or implicit super-admin account.
Tests inject their in-memory delivery port through the composition factory only.
The original ten-service foundation guards and locked HTML remain unchanged.

## Credentials and challenges

Passwords use native Argon2id v19, 64 MiB, three iterations, one lane, 32-byte hash with a fresh
salt. Verification caps stored PHC resource parameters before invoking native code; parameter
order is not significant. Successful login upgrades older hashes. Tests use the documented
minimum 19 MiB/two iterations for speed, and separately verify production hash policy.

Registration and login acknowledge a challenge with the same public shape. Existing registration,
unknown login, wrong password and suspended accounts do not reveal eligibility. Login performs
an Argon verification even for an unknown account. Six-digit OTPs have a five-minute absolute
expiry, five total attempts and a 30-second resend cooldown. Redis limits IP/account issuance
and verification before expensive protected work. Resend rotates the fingerprint generation
without resetting attempts or absolute expiry. No password, OTP or refresh value is persisted
in plaintext; OTP fingerprints are keyed and bound to challenge ID and generation.

The delivery port accepts a bounded HTTPS request, authenticates with a separately supplied
provider token and uses `challengeId:generation` as the idempotency key. No blind retry is made.
The challenge is first committed as DELIVERING, then marked READY after the port acknowledges.
Failure compensates by marking that generation INVALID. A 202 response acknowledges the request,
not successful mail/SMS delivery. Resend issues a new generation rather than recovering a stored
plaintext OTP. Provider setup and actual commercial mail/SMS delivery remain deployment tasks.

## Sessions, authorization and revocation

Access tokens are five-minute RS256 `at+jwt` tokens with issuer, audience, kid, subject, session,
auth-version, issued/expiry times and jti. RSA private keys (at least 3072 bits) exist only in
Identity. Verifiers pin the algorithm, issuer and audience, reject untrusted key URLs, and use
a configured public JWKS with bounded fetch/cache. Rotation publishes the old public key for
at least the access-token lifetime plus allowed clock skew; old private keys are not distributed.

The browser receives HttpOnly access/refresh cookies. Hardened environments require Secure,
SameSite=Strict and `__Host-` scope, Path=/ and no Domain. Tokens never enter localStorage.
Every cookie-mounted state-changing route requires an exact allowlisted Origin and a signed
double-submit token bound to the pre-auth nonce or the current refresh secret. Rotation also
rotates that binding. CORS is not authorization. Proxy-supplied identity/IP headers are untrusted.

Refresh rows store only high-entropy token digests. Rotation, old-token consumption and audit
commit together under row locks. Reusing a consumed token revokes its entire session family
and commits that denial before returning an error. Logout and logout-all revoke durable state.
Sensitive operations re-check session/account status and current permissions in Identity;
JWT verification alone does not establish that a session is still authorized. Administrative
grants/status changes increment auth-version and revoke existing sessions in the same transaction.
The seven roles have explicit permission sets, not an `isAdmin` shortcut.

## Abuse, audit and failure semantics

Redis ACLs grant only the rate namespace and commands required by one atomic fixed-window
script. Budget keys contain keyed fingerprints, not email/IP values. Offline commands are not
queued; unavailable or timed-out budgets fail closed. This version stops reconnecting after a
lost Redis connection: readiness becomes false and the operator restarts the instance after
recovery. A lost budget response may consume quota without performing the action; it may not
allow the action twice. Redis is not the credential/session owner.

Security audit records are local, durable, allowlisted transaction rows, never raw request bodies
or exception dumps. They are audit hooks for later event integration; this sprint does not claim
delivery of audit events to Reporting. Internal failures produce stable public codes without
passwords, OTPs, tokens, connection URLs, database errors or stack traces.

## Acceptance and non-goals

`pnpm acceptance:identity` provisions its own PostgreSQL/Redis project, applies the old foundation
migration, inserts a sentinel, upgrades to Identity, proves the sentinel survived, reapplies
migrations, re-hardens runtime privileges and runs real Nest/API/concurrency/Redis tests plus
HTTPS Chromium cookie/CSRF tests. It records source SHA/tool versions/image digests and always
attempts project-scoped teardown. Test credentials and TLS keys stay under ignored `.acceptance`.

Existing `pnpm acceptance:run` separately proves the ten-service PostgreSQL/RabbitMQ regression
and Prisma schema mirrors. No social login, MFA product, production SMS delivery, password-reset
feature, Redis HA, legal compliance or production readiness is claimed.
