-- PostgreSQL grants new functions EXECUTE to PUBLIC by default. Remove the
-- inherited grant without changing the already-recorded service-zone migration.
-- The owning migration identity retains EXECUTE. Existing trigger invocation
-- does not require an application-role EXECUTE grant.
-- Idempotent; no table, data, geometry or schema-mirror change.
-- Rollback: retain this security restriction when rolling back the application.
REVOKE ALL ON FUNCTION "app"."audit_entry_append_only"() FROM PUBLIC;
