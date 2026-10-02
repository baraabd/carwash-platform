# Customer web

C002 introduces the React/Vite customer application shell on top of the immutable F010 HTML authority.
C003 ports the approved Home screen with its resume, repeat and follow-up entries.

## Current executable surfaces

- React candidate: `pnpm --filter @carwash/customer-web dev`
- Immutable approved prototype: `prototype/index.html`

The React shell owns layout, navigation and route mount points. Home is implemented against
deterministic fixtures (`#/?scenario=<id>`, see `docs/customer/C003_HOME.md`). The remaining business
screens, persistence, booking state, payment state and backend integration stay deferred to their
owning customer sprints; nothing here creates a booking or moves money.

The approved HTML under `design/reference/approved/` and the byte-identical prototype copy remain immutable golden inputs.

## Layout

- `src/app` — shell, router, session bootstrap
- `src/features/<name>` — one public entry point each; no cross-feature or app-layer imports
- `src/state` — pure session/draft model and its React provider
- `src/fixtures` — deterministic sample data, isolated from production data
- `src/shared` — presentation primitives only
