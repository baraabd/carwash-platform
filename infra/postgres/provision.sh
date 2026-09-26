#!/bin/sh
# Provisions the ephemeral acceptance PostgreSQL instance.
#
# Intended for a brand-new disposable volume created by the acceptance compose
# project. This is NOT a production migration runner and must never be pointed at
# a database that holds real data.
#
# IDEMPOTENT. Every statement can be replayed against an already-provisioned
# cluster without failing and without widening any privilege. That matters for
# two reasons: a container restart re-running the entrypoint must not wedge the
# stack, and a bootstrap that can only run once cannot be tested - the test would
# have to trust that a second run "would have worked".
#
# Conditional statements use `SELECT format(...) WHERE ...; \gexec` rather than a
# DO block, because psql does NOT interpolate :'variables' inside dollar-quoted
# strings: inside `$$ ... $$` they would stay literal text.
#
# The isolation model it establishes, per service:
#   cw_<svc>              own logical database, owned by the migration role
#   cw_<svc>_migrate      may create/alter/drop objects in its OWN database only
#   cw_<svc>_app          may run DML in schema "app" of its OWN database only
#
# The application role deliberately gets:
#   - no CONNECT on any other service's database
#   - no CREATE on any schema (so no DDL, no CREATE/ALTER/DROP TABLE)
#   - no ownership of anything
#   - no role membership (so SET ROLE cannot be used to escalate)
#   - no access to the migration history table
set -eu

: "${CW_SERVICES:?CW_SERVICES is required}"

for service in $CW_SERVICES; do
  prefix=$(printf '%s' "$service" | tr '[:lower:]-' '[:upper:]_')
  app_password=$(printenv "${prefix}_DB_PASSWORD")
  migration_password=$(printenv "${prefix}_MIGRATION_PASSWORD")
  test -n "$app_password"
  test -n "$migration_password"

  db="cw_${service}"
  app_role="${db}_app"
  migration_role="${db}_migrate"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v db="$db" -v app_role="$app_role" -v migration_role="$migration_role" \
    -v app_password="$app_password" -v migration_password="$migration_password" <<'SQL'
-- Roles: created only if absent.
SELECT format('CREATE ROLE %I LOGIN', :'migration_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_role');
\gexec

SELECT format('CREATE ROLE %I LOGIN', :'app_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role');
\gexec

-- Attributes are asserted unconditionally, so replaying this script REPAIRS a
-- role whose attributes were changed by hand rather than silently accepting them.
--
-- NOINHERIT plus the absence of any grantee membership means neither implicit
-- inheritance nor an explicit SET ROLE can reach another service's identity.
ALTER ROLE :"migration_role"
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  PASSWORD :'migration_password';
ALTER ROLE :"app_role"
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  PASSWORD :'app_password';

-- CREATE DATABASE cannot run inside a transaction, so it is built as a statement
-- and executed with \gexec.
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'migration_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db');
\gexec

-- Asserted separately: a database that already existed must still end up owned by
-- the migration role, never by the bootstrap superuser.
ALTER DATABASE :"db" OWNER TO :"migration_role";

-- Default-deny at the database door: only this service's two roles may connect.
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_role";
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"migration_role";
SQL

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -v app_role="$app_role" -v migration_role="$migration_role" <<'SQL'
-- The public schema is left unusable so nothing lands there by accident.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- All service objects live in "app", owned by the migration role.
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION :"migration_role";
ALTER SCHEMA app OWNER TO :"migration_role";

-- USAGE only: the application can resolve objects but cannot create them.
GRANT USAGE ON SCHEMA app TO :"app_role";
REVOKE CREATE ON SCHEMA app FROM :"app_role";

-- DML on whatever the migration role creates later, and nothing more.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- Replay repair: objects that already existed predate the default privileges
-- above, so grant on them explicitly. Still DML only - no DDL, and deliberately
-- no EXECUTE on functions, which the application does not need.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO :"app_role";

-- The migration history belongs to the migration role alone. Being unable to
-- change the schema is not enough: the application must also be unable to read or
-- rewrite the record of which migrations ran. This REVOKE comes last so it also
-- undoes the blanket grant above, and it is conditional because the table does
-- not exist until the first migration has been deployed.
SELECT format('REVOKE ALL ON TABLE app._prisma_migrations FROM %I', :'app_role')
 WHERE EXISTS (
   SELECT 1 FROM pg_tables WHERE schemaname = 'app' AND tablename = '_prisma_migrations'
 );
\gexec

-- Future migration runs must not re-grant it either.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app
  REVOKE ALL ON TABLES FROM PUBLIC;
SQL

  echo "provisioned ${db} (${migration_role} / ${app_role})"
done
