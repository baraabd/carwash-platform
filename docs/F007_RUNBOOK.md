# F007 — Gateway verification and operation

Build from a clean source with the repository's Node/pnpm pins:

```sh
pnpm install --frozen-lockfile
pnpm generate
pnpm build
pnpm typecheck
pnpm test:gateway
pnpm check:gateway-contract
pnpm check:boundaries
pnpm acceptance:run
pnpm exec playwright install --with-deps chromium
pnpm acceptance:gateway
```

The last two acceptance commands provision/tear down their own disposable databases
and broker resources. Never point them at production. `evidence/gateway/<run>/` records
source SHA, source cleanliness, tool/image versions, TAP and sanitized phases. Failed
or skipped tests are not acceptance. Browser acceptance uses the pinned Playwright build.

Runtime inputs: `GATEWAY_UPSTREAMS` JSON keyed by catalog owner, `IDENTITY_ISSUER`,
`IDENTITY_AUDIENCE`, `GATEWAY_ALLOWED_ORIGINS` (comma-separated exact browser origins).
`GATEWAY_TIMEOUT_MS` defaults to 3000; `GATEWAY_RESPONSE_LIMIT` defaults to 262144.
TLS/secret-bearing Identity configuration belongs to Identity, not to Gateway.
Use `pnpm --filter @carwash/api-gateway start`; loopback bind is the default.
The separate `apps/api-gateway/Dockerfile` produces a non-root production dependency tree.

For browser writes preserve the signed readable CSRF cookie in `X-CSRF-Token` and use
same-origin requests. Access/refresh remain HttpOnly and are not stored in localStorage.
For service tests use the token's public verifier and live session contract, never
invent a user by setting X-User-Id. The downstream owner must authorize the resource.

A successful routing test against a named stub is not a working booking/payment feature.
No production deployment, external message delivery or business UI is included.
