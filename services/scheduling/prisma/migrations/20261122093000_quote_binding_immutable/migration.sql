-- Quote binding is an immutable capacity-hold fact. Older v1 rows already have
-- both columns; no value is backfilled or guessed. Historical receipt upcasting
-- also relies on the original hold identity, beneficiary, zone and interval.
-- State/revision/release/booking transitions remain legitimate mutable facts.
CREATE FUNCTION app.capacity_hold_quote_binding_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.beneficiary_kind IS NOT NULL OR OLD.quote_id IS NOT NULL OR OLD.quote_revision IS NOT NULL THEN
      RAISE EXCEPTION 'CAPACITY_HOLD_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- Unconditional: a v1 -> legacy-shaped downgrade cannot disable this guard.
  -- There is no supported conversion of legacy holds into quote-bound v1 holds.
  IF NEW.quote_id IS DISTINCT FROM OLD.quote_id OR
     NEW.quote_revision IS DISTINCT FROM OLD.quote_revision THEN
    RAISE EXCEPTION 'CAPACITY_HOLD_QUOTE_BINDING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  IF (OLD.beneficiary_kind IS NOT NULL OR OLD.quote_id IS NOT NULL OR OLD.quote_revision IS NOT NULL) AND
     ROW(NEW.id, NEW.window_id, NEW.zone_id, NEW.beneficiary_kind, NEW.beneficiary_subject,
         NEW.slot_starts_at, NEW.slot_ends_at, NEW.units, NEW.created_at)
       IS DISTINCT FROM
     ROW(OLD.id, OLD.window_id, OLD.zone_id, OLD.beneficiary_kind, OLD.beneficiary_subject,
         OLD.slot_starts_at, OLD.slot_ends_at, OLD.units, OLD.created_at) THEN
    RAISE EXCEPTION 'CAPACITY_HOLD_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.capacity_hold_quote_binding_immutable() FROM PUBLIC;
CREATE TRIGGER capacity_hold_quote_binding_immutable
BEFORE UPDATE OR DELETE ON app.capacity_hold
FOR EACH ROW EXECUTE FUNCTION app.capacity_hold_quote_binding_immutable();
