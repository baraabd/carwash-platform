-- Separate owner observations prevent a technician's declaration from changing Billing state.
CREATE TABLE "ops_owner_observation" (
  event_type VARCHAR(80) NOT NULL, aggregate_id UUID NOT NULL,
  source VARCHAR(16) NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  fingerprint CHAR(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  source_event_id UUID NOT NULL, occurred_at TIMESTAMPTZ(3) NOT NULL,
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT ops_owner_observation_pkey PRIMARY KEY (event_type, aggregate_id),
  CONSTRAINT ops_owner_observation_source_ck CHECK (
    (source='booking' AND event_type IN ('booking.cancelled.v1','booking.rescheduled.v1','booking.lifecycle-progressed.v1')) OR
    (source='dispatch' AND event_type='dispatch.cash-declared.v1') OR
    (source='workforce' AND event_type='workforce.shift-updated.v1'))
);
