-- P05-D5 added trigger functions whose default PUBLIC EXECUTE grant also
-- reaches every other service role. Repair already-applied databases without
-- changing the P05-D5 migration. Other service identities stay isolated.
-- These functions are invoked by owner-created triggers; the runtime identity
-- does not need direct EXECUTE, and the functions keep invoker rights.
BEGIN;

REVOKE ALL ON FUNCTION "app"."config_scope_version_forward"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."config_append_only"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."config_no_delete"() FROM PUBLIC;

-- Applies to the current migration identity in this database, including a
-- shadow replay. Do not add IN SCHEMA here: schema-local default revokes cannot
-- remove PostgreSQL's global PUBLIC EXECUTE default for newly created functions.
-- Future helper functions that need runtime calls must grant them explicitly.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
