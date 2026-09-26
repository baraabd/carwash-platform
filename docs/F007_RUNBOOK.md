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

## Final-source and post-merge verification

The dedicated F007 workflow runs on `main`, `develop`, `feat/F007-*`, pull requests
and manual dispatches. A successful feature-branch run does not establish the
post-merge source: verify the workflow's checked-out SHA again after merging.
The F001 comparison uses the PR base or the push's previous SHA; initial branch
pushes and manual dispatches resolve a real merge base against the default branch.
No hardcoded F006 ancestor substitutes for the source being reviewed.

Gateway tests cover both the security contract and discovery consistency:
BFF composition requires **all** component permissions before contacting either
owner; live Identity subject/session/version must match the verified JWT; failed
reads return the safe error envelope rather than fabricated partial business data.
A nonempty upstream body must use `application/json` (optional media parameters
are allowed). Similar-looking types such as `application/jsonp` are refused.

OpenAPI defines one closed `GatewayErrorEnvelope`, correlation/trace headers,
command idempotency policy and explicit authentication for all three BFF reads.
The generated document deliberately does not invent business response schemas.
For an intentional gateway-contract change only, build the gateway, author the
new discovery artifact with `node scripts/gateway-openapi.mjs --write`, inspect
the exact diff and rerun `pnpm check:gateway-contract`. Never do this for approved
HTML or to hide an unexplained contract difference.
