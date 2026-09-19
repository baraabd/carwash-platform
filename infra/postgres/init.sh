#!/bin/sh
# Runs ONLY on a new disposable volume. This is not a production migration runner.
set -eu
for service in identity customer catalog workforce booking billing media communications support reporting; do
  prefix=$(printf '%s' "$service" | tr '[:lower:]' '[:upper:]')
  app_password=$(printenv "${prefix}_DB_PASSWORD")
  migration_password=$(printenv "${prefix}_MIGRATION_PASSWORD")
  test -n "$app_password" && test -n "$migration_password"
  db="cw_${service}"
  app_role="${db}_app"
  migration_role="${db}_migrate"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v db="$db" -v app_role="$app_role" -v migration_role="$migration_role" \
    -v app_password="$app_password" -v migration_password="$migration_password" <<'SQL'
CREATE ROLE :"migration_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migration_password';
CREATE ROLE :"app_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE :"db" OWNER :"migration_role";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_role";
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -v app_role="$app_role" -v migration_role="$migration_role" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA app AUTHORIZATION :"migration_role";
GRANT USAGE ON SCHEMA app TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
SQL
done
