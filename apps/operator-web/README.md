# operator-web — technician app (P03-C5 port)

Framework-free TypeScript port of the approved technician prototype
`design/reference/approved/washgo-technician-interactive.html`, wired to the
same-origin gateway paths `/api/operator/*` (requested from Lane E; see
`docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md`).
Port method, declared differences, pending designs and evidence:
`docs/production/C/P03-C5-operator-web.md`.

- `src/styles/*.css` are the reference `<style>` block, byte for byte. Do not reformat.
- `index.html` carries the reference SVG sprite verbatim.
- No business data is stored on the device; localStorage holds only the motion
  preference and the current filters.

Commands from the root:

- pnpm --filter @carwash/operator-web build | typecheck | test:runtime
- HOST=127.0.0.1 PORT=<port> OPERATOR_MEDIA_ORIGINS=<https://object-store-origin> pnpm --filter @carwash/operator-web start
- node scripts/production/C/operator-web-acceptance.mjs (browser suites against fixture doubles)

`server.mjs` serves only the built document and assets with a strict CSP
(`connect-src`/`img-src` add the configured object-store origins). It never
serves `/api/*`. `/health/ready` stays 503 until business readiness is accepted;
the app is not production-ready while the gateway routes, session flow and real
services are unproven.
