-- No account, verification, role or bootstrap receipt is seeded by migrations.
CREATE TABLE "identity_initial_administrator" (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  account_id UUID NOT NULL,
  request_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reason VARCHAR(512) NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 512 AND reason !~ '[[:cntrl:]]'),
  granted_auth_version INTEGER NOT NULL CHECK (granted_auth_version > 1),
  granted_at TIMESTAMPTZ(3) NOT NULL,
  challenge_id UUID NOT NULL,
  login_audit_id UUID NOT NULL,
  audit_id UUID NOT NULL,
  CONSTRAINT identity_initial_administrator_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT identity_initial_administrator_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES identity_challenge(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT identity_initial_administrator_login_audit_id_fkey FOREIGN KEY (login_audit_id) REFERENCES identity_audit(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT identity_initial_administrator_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES identity_audit(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX identity_initial_administrator_account_id_key ON identity_initial_administrator(account_id);
CREATE UNIQUE INDEX identity_initial_administrator_request_id_key ON identity_initial_administrator(request_id);
CREATE UNIQUE INDEX identity_initial_administrator_challenge_id_key ON identity_initial_administrator(challenge_id);
CREATE UNIQUE INDEX identity_initial_administrator_login_audit_id_key ON identity_initial_administrator(login_audit_id);
CREATE UNIQUE INDEX identity_initial_administrator_audit_id_key ON identity_initial_administrator(audit_id);

-- Runtime DML cannot erase the singleton or rewrite its source verification/audit evidence.
CREATE FUNCTION "identity_initial_administrator_immutable"() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'identity_initial_administrator' THEN
    RAISE EXCEPTION 'IDENTITY_INITIAL_ADMINISTRATOR_IMMUTABLE' USING ERRCODE='55000';
  ELSIF TG_TABLE_NAME = 'identity_audit' THEN
    IF EXISTS (SELECT 1 FROM app.identity_initial_administrator WHERE audit_id=OLD.id OR login_audit_id=OLD.id) THEN
      RAISE EXCEPTION 'IDENTITY_INITIAL_ADMINISTRATOR_EVIDENCE_IMMUTABLE' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'identity_challenge' THEN
    IF EXISTS (SELECT 1 FROM app.identity_initial_administrator WHERE challenge_id=OLD.id) THEN
      RAISE EXCEPTION 'IDENTITY_INITIAL_ADMINISTRATOR_EVIDENCE_IMMUTABLE' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "identity_initial_administrator_immutable"() FROM PUBLIC;
CREATE TRIGGER identity_initial_administrator_immutable_write BEFORE UPDATE OR DELETE
  ON identity_initial_administrator FOR EACH ROW EXECUTE FUNCTION identity_initial_administrator_immutable();
CREATE TRIGGER identity_initial_administrator_immutable_truncate BEFORE TRUNCATE
  ON identity_initial_administrator FOR EACH STATEMENT EXECUTE FUNCTION identity_initial_administrator_immutable();
CREATE TRIGGER identity_initial_administrator_audit_evidence BEFORE UPDATE OR DELETE
  ON identity_audit FOR EACH ROW EXECUTE FUNCTION identity_initial_administrator_immutable();
CREATE TRIGGER identity_initial_administrator_challenge_evidence BEFORE UPDATE OR DELETE
  ON identity_challenge FOR EACH ROW EXECUTE FUNCTION identity_initial_administrator_immutable();
