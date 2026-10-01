# Customer web

C002 introduces the React/Vite customer application shell on top of the immutable F010 HTML authority.

## Current executable surfaces

- React candidate shell: `pnpm --filter @carwash/customer-web dev`
- Immutable approved prototype: `prototype/index.html`

The React shell owns only layout, navigation and route mount points. Business screen contents, persistence, booking state, payment state and backend integration remain intentionally deferred to their owning customer sprints.

The approved HTML under `design/reference/approved/` and the byte-identical prototype copy remain immutable golden inputs.
