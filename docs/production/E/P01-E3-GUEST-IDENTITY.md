# P01-E3 — Guest booking identity and Gateway auth modes

Lane E, child sprint 3 of P01-E. Base `f875d31bf62b153b6d36ac7a607949f8c4e29389`.
Independent of P01-E1 (no new owner contracts are consumed here).

## Problem

Guest booking without account creation is a product requirement (seven-step
journey, plate optional, no forced sign-up). Before this change Identity only
issued sessions to email/password accounts, and the Gateway required a verified
identity on every non-auth route, including the published catalog.

## Design

**A guest is a principal, not an account with a fake email.** It is a row in
`identity_account` with `kind = 'guest'`:

| Column | account | guest |
| --- | --- | --- |
| `email`, `password_hash` | required | must be NULL |
| `roles` | assigned | must be empty |
| `recovery_digest` | NULL | SHA-256 of the recovery code, unique |
| `guest_expires_at` | NULL | absolute expiry (30 days) |

The shape is enforced by the `identity_account_kind_shape` CHECK constraint
(migration `20261007000000_guest_identity`, expand-only) and again by the store
mapper. Guests reuse the existing session/refresh/rotation/replay machinery, so
they inherit refresh rotation, replay revocation, CSRF and hardened cookies.

| Operation | Route | Behavior |
| --- | --- | --- |
| Create | `POST /internal/v1/identity/guest-sessions` (`/api/v1/auth/guest-sessions`) | CSRF required, 10 per IP per 15 min (Redis budget). Sets session cookies; returns `{session, recoveryCode, guestExpiresAt}`. The recovery code (256-bit) is returned **once**; only its digest is stored. |
| Recover | `POST …/guest-sessions/recover` `{recoveryCode}` | CSRF required, 10 per IP per 15 min. Under a row lock: rotates the code, bumps `authVersion`, revokes every earlier session, and issues a new one. Unknown, suspended and expired guests share one `AUTH_INVALID`. Concurrent use of one code yields exactly one session. |

The session view gains `principalKind: 'account' | 'guest'`. Guests carry no
roles and the fixed permission set `profile.read:self`, `profile.write:self`,
`bookings.read:self`, `bookings.create:self`. Staff role grants on a guest are
refused (`AUTH_INVALID_REQUEST`) and the database rejects them anyway. Guest
sessions never outlive `guest_expires_at`. Login never matches a guest.

**Gateway.** `GatewayRoute.public` forwards only request/correlation/trace
headers. Cookies, bearer tokens and identity headers never reach a public owner
route, and the Identity origin is not contacted. `customer.catalog` is public,
so guests can browse before any identity exists. Authenticated forwarding adds
`x-auth-principal-kind`. A session view that lacks a valid principal kind, or a
guest view with roles, is rejected as `UPSTREAM_INVALID`.

## Open product decisions (not taken here)

- **Guest lifetime and retention.** 30 days is an engineering default. It needs
  the owner's retention decision.
- **Claiming a guest into an account** (merging bookings). Not implemented. A
  matching phone, name or email never links records.
- **Recovery delivery channel.** Showing the code, or sending it by SMS through
  Communications, is a UX decision. The approved prototype has no screen for it,
  so no UI is added here.

## Not in this PR

- Gateway routes and service-to-service scopes for the P01-E1 owner contracts.
  These are P01-E5, which consumes E1 only after it is merged.
- An Identity **image** boot check. The image needs Redis and key material; see
  P01-E2. That gap remains open.

## Rollback

Revert the application. The migration is expand-only. The previous release
never selects guests by email, and it maps a guest to zero permissions. The
migration is not reversed; a contraction needs its own reviewed data plan.
