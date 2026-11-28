# Identity service

Identity owns accounts, email/password authentication, OTP challenges, guest
recovery, sessions, refresh rotation, roles and audit records in `cw_identity`.
Its application uses the service's own database. Other services authenticate
through the published Identity contracts and never read these tables.

The production auth composition requires its real signing keys, authenticated
rate-budget Redis, OTP delivery adapter and allowed origins. A health-only shell
does not certify these dependencies or a hosted deployment. The source-bound
Identity/Gateway acceptance suite remains required for release.

## Initial administrator

The first administrator is provisioned by an explicit operator command inside
the Identity release environment. It is neither a public HTTP endpoint nor an
automatic startup/migration side effect.

1. The intended operator registers and completes the normal OTP verification/login
   against Identity. Record the account UUID returned by Identity and its email.
2. Apply migration `20261127123000_initial_administrator_receipt` through the
   separate Identity migration identity.
3. Run the compiled CLI with the Identity **runtime** `DATABASE_URL` supplied
   securely by the deployment environment, an explicit request UUID and a reason:

   ```sh
   node dist/transport/cli/bootstrap-initial-administrator.js \
     --account-id '<existing-account-uuid>' \
     --expected-email '<registered-email>' \
     --request-id '<unique-request-uuid>' \
     --reason 'Approved initial administrator provisioning for this environment'
   ```

   The workspace equivalent is `pnpm --filter @carwash/identity bootstrap:admin --account-id …`.

4. Sign in again with the normal password and OTP flow. The grant revokes all
   existing sessions and increments the account's authorization version.

The command requires an active account whose normalized email matches, an existing
`USED` registration/login challenge and its account's persisted successful login
audit. It does not create accounts, synthesize verification or mint a session.
An administrator already present in any status blocks initialization.

A short transaction lock serializes replicas and account writers. The grant,
authorization-version increment, session revocation, audit record and singleton
receipt commit together. The receipt records the request fingerprint, reason,
grant version and actual verification/audit references. Database triggers protect
the receipt and referenced evidence from runtime modification or deletion.

Repeating the identical request returns `REPLAYED` without another grant, audit
or session revocation. A different target/request is rejected. Changed content
under the same request is rejected. Removing/changing the grant or changing the
account status/version prevents replay permanently; this command is not an
administrator recovery mechanism. Use the normal authorized role-management
process after initial provisioning. Never delete the receipt to run it again.

Output contains only status and receipt identifiers. It omits email, reason,
password, OTP, tokens and connection details. Authentication and financial
permissions remain separate; this command does not approve service operations.

## Verification

`tests/identity/00-initial-administrator.pg.test.mjs` runs first on the disposable
Identity acceptance database. It uses real PostgreSQL roles, Argon2, OTP validation
and RS256 signing, with an explicitly captured OTP delivery port and rate-budget
test port. It checks rejected prerequisites, transaction rollback, concurrent
replicas, CLI replay, session invalidation, immutable evidence and refusal after
ordinary Identity role removal. It does not prove delivery by an external OTP
provider. `pnpm acceptance:identity` includes this test before the existing
HTTP/Redis/browser security suites.
