-- DESIGN EXAMPLE ONLY. Not a migration and not executed in delivered tests.
-- The final owner-local Prisma mirror and migration must be reviewed together.
-- Reserve team AND van rows in ONE booking-service database transaction.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE app.resource_reservations (
 id uuid PRIMARY KEY,
 booking_id uuid NOT NULL,
 resource_kind text NOT NULL CHECK (resource_kind IN ('TEAM','VAN')),
 resource_id uuid NOT NULL,
 occupied tstzrange NOT NULL,
 state text NOT NULL CHECK (state IN ('HELD','CONFIRMED','RELEASED','EXPIRED')),
 hold_expires_at timestamptz,
 CHECK (NOT isempty(occupied) AND NOT lower_inf(occupied) AND NOT upper_inf(occupied)
        AND lower_inc(occupied) AND NOT upper_inc(occupied)),
 CHECK (state <> 'HELD' OR hold_expires_at IS NOT NULL),
 EXCLUDE USING gist (resource_kind WITH =, resource_id WITH =, occupied WITH &&)
   WHERE (state IN ('HELD','CONFIRMED'))
);
-- Expiration is an explicit transaction that changes HELD to EXPIRED using DB time.
-- Do NOT put now() in the partial constraint predicate.
-- Expired holds remain blocking until explicitly expired/released; a delayed worker
-- may reduce availability but cannot silently double-book a resource.
-- The production migration must add owner-local foreign keys, query indexes,
-- duplicate-resource guards and matching Prisma representations.
