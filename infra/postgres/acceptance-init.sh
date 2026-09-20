#!/bin/sh
# Provisions the ephemeral acceptance PostgreSQL instance.
#
# Runs ONLY on a brand-new disposable volume created by the acceptance compose
# project. This is NOT a production migration runner and must never be pointed at
# a database that holds real data.
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
-- NOINHERIT plus the absence of any grantee membership: neither implicit
-- inheritance nor an explicit SET ROLE can reach another service's identity.
CREATE ROLE :"migration_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  PASSWORD :'migration_password';
CREATE ROLE :"app_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  PASSWORD :'app_password';

CREATE DATABASE :"db" OWNER :"migration_role";

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
CREATE SCHEMA app AUTHORIZATION :"migration_role";

-- USAGE only: the application can resolve objects but cannot create them.
GRANT USAGE ON SCHEMA app TO :"app_role";
REVOKE CREATE ON SCHEMA app FROM :"app_role";

-- DML on whatever the migration role creates later, and nothing more.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
SQL

  echo "provisioned ${db} (${migration_role} / ${app_role})"
done
