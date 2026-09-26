# ADR 0006 — PostgreSQL data sovereignty: database per service, two identities each

Status: accepted in sprint F004. Extends ADR 0001, which established that each
service owns a private logical database, into the exact privilege model and the
way it is proven.

## The choice: a database per service, not a schema per service

Each of the ten services owns a **separate logical database** — `cw_identity`,
`cw_catalog`, `cw_booking` and so on — on a shared PostgreSQL host.

The alternative considered was one database with a schema per service. It was
rejected because the isolation it offers is weaker in exactly the place that
matters. With schemas, every service's role can connect to the one database, so
every cross-service denial rests on per-object `GRANT`/`REVOKE` bookkeeping being
correct for every table, sequence, function and default privilege, for ever. One
forgotten `GRANT ... ON ALL TABLES` re-opens the boundary silently.

With a database per service, the boundary is enforced one level earlier:
`CONNECT` is revoked from `PUBLIC` and granted only to the owning service's two
roles, so a foreign role cannot reach the objects at all. There is nothing to
forget per table, and `pg_hba`-level and catalogue-level denial agree.

The cost is accepted and stated: cross-service queries become impossible rather
than merely forbidden, which is the point, and the shared host remains a shared
failure domain. **A shared host is not high availability**, and nothing in this
ADR claims otherwise.

## Two identities per service

| Role | May | May not |
| --- | --- | --- |
| `cw_<svc>_migrate` | own the database and the `app` schema; create, alter and drop objects in it | connect to any other service's database; create databases or roles |
| `cw_<svc>_app` | `SELECT/INSERT/UPDATE/DELETE` in `app`; `USAGE, SELECT` on its sequences | any DDL; `TRUNCATE`; `REFERENCES`; `CREATE` on a schema; read `_prisma_migrations`; connect anywhere else |

Why the split: a runtime replica that can change a schema can also change it
*concurrently with another replica*. Schema changes are a separate job with a
separate identity so that the number of processes able to perform DDL is one, by
construction rather than by convention. Nothing in any service's startup path
runs a migration — `check-boundaries.mjs` enforces that statically.

Both roles are `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
and, importantly, **`NOINHERIT` with no role membership at all**. Attributes alone
are not enough: a role with none of those flags can still become another identity
if it was granted membership in it. `NOINHERIT` plus zero membership closes both
the implicit path (inheritance) and the explicit one (`SET ROLE`).

`TRUNCATE` and `REFERENCES` are withheld deliberately. `TRUNCATE` destroys a
table's contents with no `WHERE` clause and is not DML in any useful sense;
`REFERENCES` would let the application add a constraint, which is a schema change
wearing a DML-shaped hat.

`_prisma_migrations` is revoked from the application role explicitly, *after* the
blanket grant that the provisioning script issues for replay repair. Being unable
to change the schema is not enough — the record of which migrations ran must not
be rewritable either, and `GRANT ... ON ALL TABLES IN SCHEMA app` would otherwise
include it.

## One provisioning script, idempotent

`infra/postgres/provision.sh` is mounted by **both** `compose.dev.yml` and
`compose.acceptance.yml`. Before F004 there were two scripts, and they had already
drifted: the acceptance one created roles `NOINHERIT`, the development one did
not. Two copies of an isolation model means the environment you test is not the
one you develop against.

Every statement is replay-safe: roles are created conditionally and their
attributes then asserted with `ALTER ROLE`, so a replay *repairs* a role that was
changed by hand instead of accepting it. Conditionals use
`SELECT format(...) WHERE ...; \gexec` rather than a `DO` block, because psql does
not interpolate `:'variables'` inside dollar-quoted strings — inside `$$ ... $$`
they would remain literal text.

Idempotency is not a convenience. A bootstrap that can only run once cannot be
tested: the test would have to trust that a second run *would* have worked. With
this, `tests/integration/postgres-bootstrap.test.mjs` replays the real script in
the real container and asserts that the privilege surface is byte-identical
afterwards. Idempotent means "changes nothing", not "exits zero" — a replay that
quietly re-granted `_prisma_migrations` would exit zero and still be a regression.

## How the boundary is proven

Three suites, because they answer different questions and one of them cannot
answer all three.

1. **`postgres-isolation.test.mjs`** — attempts the forbidden thing as the real
   role and requires `42501 insufficient_privilege`. Expected-denial mutations are
   wrapped in `BEGIN; … ROLLBACK;` so that if a privilege check ever *did* succeed,
   discovering the defect cannot leave the schema mutated.

2. **`postgres-privileges.test.mjs`** (new in F004) — asks the server's own
   catalogue, via `has_table_privilege` and friends, whether any foreign role holds
   anything on this service's tables, sequences, functions, schemas or database.

   This exists because the connection-level proof, while stronger in practice, makes
   the cross-service `SELECT/INSERT/UPDATE/DELETE` case *unobservable*: the attempt
   dies at the database door before a table is ever named. Asking the catalogue
   covers those cases directly, so the two suites together show that the door is
   shut **and** that nothing is granted behind it.

   It also asserts the positive half — that the application role really does hold
   the DML it needs. Denials alone would pass just as well if a role held no
   privileges and the service were simply broken.

3. **`postgres-bootstrap.test.mjs`** (new in F004) — idempotency, as above.

Plus two static guards that a running database cannot provide, because by the time
a migration has been applied the mistake is permanent:

- **`check-migrations.mjs`** — append-only history (an applied migration must never
  be edited; Prisma checksums it, and an edit leaves that environment permanently
  failed with no later migration able to repair it), single ownership (no migration
  names another service's database, role, or grants to a role it does not own), no
  `prisma db push` anywhere, deterministic ordering, and no connection string in a
  migration file.
- **`check-boundaries.mjs`** — no shared Prisma client or schema in any shared
  package, and no migration in a service's startup path.

## Consequences

- A cross-service join or foreign key is impossible, not merely discouraged.
- Weakening isolation fails a test rather than passing quietly, in both
  directions: adding a `GRANT` trips the privilege suite, and removing one trips
  the positive assertions.
- Dev and acceptance share one isolation model, so a privilege bug cannot hide in
  the difference between them.

## What this ADR does not claim

A shared PostgreSQL host is a shared failure domain and is **not** high
availability. Nothing here addresses backup, restore, point-in-time recovery,
connection pooling, row-level security, encryption at rest, or the eventual move
to separate servers per service.

Every credential in the acceptance and development stacks is generated per run for
a disposable container. **No production database has been touched, configured or
tested**, and no statement here constitutes production readiness.
