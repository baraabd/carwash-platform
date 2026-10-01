# WashGo HTTP contract registry

The machine-readable registry is `contract-registry.json`.

X003 records only contracts that already exist in source. It does **not** invent
business payloads for services whose catalog status is still
`planned-not-implemented`.

The canonical generated OpenAPI document remains
`docs/contracts/gateway.openapi.json`, verified by
`pnpm check:gateway-contract`. It is a gateway routing-discovery contract, not
proof that every owner behind every route has implemented its business API.

Consumers should prefer explicit package subpaths:

- `@carwash/contracts/identity-v1`
- `@carwash/contracts/gateway-v1`
- `@carwash/contracts/registry`

The root export remains for backward compatibility during the migration.
