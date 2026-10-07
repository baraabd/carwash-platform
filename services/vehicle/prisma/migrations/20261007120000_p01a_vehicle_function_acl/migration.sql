-- Harden the existing trigger without changing an already-applied migration.
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
REVOKE ALL ON FUNCTION "audit_entry_append_only"() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "app" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
