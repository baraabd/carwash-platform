# admin-web technical bootstrap

W01 supplies a Vite/TypeScript browser entry and an independent stateless Node HTTP artifact. It does not implement any approved product screen, authentication, navigation, persisted state or business API. The technical placeholder is not an approved UI port and carries no demo business data. The approved product reference remains unchanged in design/reference/approved/.

Commands from the root:

- pnpm --filter @carwash/admin-web dev -- --port <allocated-port>
- pnpm --filter @carwash/admin-web build
- pnpm --filter @carwash/admin-web typecheck
- pnpm --filter @carwash/admin-web test:runtime
- HOST=127.0.0.1 PORT=<allocated-port> pnpm --filter @carwash/admin-web start
- docker build -f apps/admin-web/Dockerfile -t washgo/admin-web:w01 .

/health/live reports the HTTP process. /health/ready always returns 503 FOUNDATION_NOT_READY until a later owner-reviewed capability implementation. Unknown routes cannot become simulated APIs. App tests start a real HTTP listener with labeled static fixtures; they do not prove browser parity, accessibility or business integration.

This app owns no business database. E's exact bootstrap lease expires at verified BASE_W02. The permanent app owner ports the approved reference and implements future flows.
