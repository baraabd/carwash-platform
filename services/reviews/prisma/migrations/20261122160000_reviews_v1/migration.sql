-- Reviews v1: expand-only owner schema. Apply as migration identity, never at runtime.
-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_revision" INTEGER NOT NULL,
    "booking_verified_at" TIMESTAMPTZ(3) NOT NULL,
    "author_kind" VARCHAR(7) NOT NULL,
    "author_subject" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" VARCHAR(1000),
    "publication_consent" BOOLEAN NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "moderation_reason" VARCHAR(32),
    "revision" INTEGER NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_audit" (
    "review_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "event_id" UUID NOT NULL,
    "actor_kind" VARCHAR(7) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "action" VARCHAR(8) NOT NULL,
    "previous_status" VARCHAR(24),
    "status" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(32),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "review_audit_pkey" PRIMARY KEY ("review_id","revision")
);

-- CreateTable
CREATE TABLE "review_command_receipt" (
    "actor_kind" VARCHAR(7) NOT NULL,
    "actor_subject" UUID NOT NULL,
    "operation" VARCHAR(8) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "review_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "review_command_receipt_pkey" PRIMARY KEY ("actor_kind","actor_subject","operation","key")
);

-- CreateTable
CREATE TABLE "outbox_message" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "review_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "correlation_id" UUID NOT NULL,
    "trace_parent" VARCHAR(55),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_by" TEXT,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "dead_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_booking_id_key" ON "review"("booking_id");

-- CreateIndex
CREATE INDEX "review_moderation_queue_idx" ON "review"("status", "submitted_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_audit_event_id_key" ON "review_audit"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_receipt_revision_key" ON "review_command_receipt"("review_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_event_id_key" ON "outbox_message"("event_id");

-- CreateIndex
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("published_at", "dead_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_outbox_revision_key" ON "outbox_message"("review_id", "revision");

-- AddForeignKey
ALTER TABLE "review_audit" ADD CONSTRAINT "review_audit_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "review_audit" ADD CONSTRAINT "review_audit_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbox_message"("event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "review_command_receipt" ADD CONSTRAINT "review_command_receipt_review_id_revision_fkey" FOREIGN KEY ("review_id", "revision") REFERENCES "review_audit"("review_id", "revision") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbox_message" ADD CONSTRAINT "outbox_message_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE app.review
  ADD CONSTRAINT review_author_kind CHECK (author_kind IN ('account', 'guest')),
  ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5),
  ADD CONSTRAINT review_comment_valid CHECK (comment IS NULL OR
    (char_length(comment) BETWEEN 1 AND 1000 AND comment = normalize(comment, NFC)
      AND comment !~ U&'[\0001-\0008\000B\000C\000E-\001F\007F]')),
  ADD CONSTRAINT review_revisions_positive CHECK (revision >= 1 AND booking_revision >= 1),
  ADD CONSTRAINT review_time_order CHECK (booking_verified_at <= submitted_at AND updated_at >= submitted_at),
  ADD CONSTRAINT review_status_known CHECK (status IN ('PENDING_MODERATION', 'PRIVATE', 'PUBLISHED', 'REJECTED', 'HIDDEN')),
  ADD CONSTRAINT review_explicit_consent CHECK ((status = 'PRIVATE') = (NOT publication_consent)),
  ADD CONSTRAINT review_reason_known CHECK (moderation_reason IN ('MEETS_GUIDELINES', 'PERSONAL_DATA', 'OFFENSIVE', 'SPAM', 'NOT_ABOUT_SERVICE', 'CUSTOMER_WITHDREW_CONSENT')),
  ADD CONSTRAINT review_moderation_consistent CHECK (
    (status IN ('PRIVATE', 'PENDING_MODERATION') AND moderation_reason IS NULL)
    OR (status = 'PUBLISHED' AND moderation_reason = 'MEETS_GUIDELINES')
    OR (status IN ('REJECTED', 'HIDDEN') AND moderation_reason IS NOT NULL AND moderation_reason <> 'MEETS_GUIDELINES'));

ALTER TABLE app.review_audit
  ADD CONSTRAINT review_audit_actor_kind CHECK (actor_kind IN ('account', 'guest')),
  ADD CONSTRAINT review_audit_action CHECK (action IN ('SUBMIT', 'PUBLISH', 'REJECT', 'HIDE')),
  ADD CONSTRAINT review_audit_revision CHECK (revision >= 1);

ALTER TABLE app.review_command_receipt
  ADD CONSTRAINT review_receipt_actor_kind CHECK (actor_kind IN ('account', 'guest')),
  ADD CONSTRAINT review_receipt_operation CHECK (operation IN ('SUBMIT', 'MODERATE')),
  ADD CONSTRAINT review_receipt_key CHECK (key ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT review_receipt_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$');

ALTER TABLE app.outbox_message
  ADD CONSTRAINT review_outbox_known_event CHECK (event_type = 'reviews.review-status-changed.v1' AND routing_key = event_type AND exchange = 'reviews.events'),
  ADD CONSTRAINT review_outbox_attempts CHECK (attempts >= 0),
  ADD CONSTRAINT review_outbox_private_error CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  ADD CONSTRAINT review_outbox_payload_limit CHECK (octet_length(payload) <= 4096);

CREATE FUNCTION app.reviews_guard_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REVIEW_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.status NOT IN ('PENDING_MODERATION', 'PRIVATE')
      OR NEW.moderation_reason IS NOT NULL OR NEW.updated_at <> NEW.submitted_at THEN
      RAISE EXCEPTION 'REVIEW_INITIAL_STATE' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.booking_id, NEW.booking_revision, NEW.booking_verified_at,
           NEW.author_kind, NEW.author_subject, NEW.rating, NEW.comment,
           NEW.publication_consent, NEW.submitted_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.booking_id, OLD.booking_revision, OLD.booking_verified_at,
           OLD.author_kind, OLD.author_subject, OLD.rating, OLD.comment,
           OLD.publication_consent, OLD.submitted_at) THEN
      RAISE EXCEPTION 'REVIEW_CONTENT_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    IF NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at
      OR NOT ((OLD.status = 'PENDING_MODERATION' AND NEW.status IN ('PUBLISHED', 'REJECTED'))
           OR (OLD.status = 'PUBLISHED' AND NEW.status = 'HIDDEN')) THEN
      RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.reviews_guard_review() FROM PUBLIC;
CREATE TRIGGER review_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON app.review
FOR EACH ROW EXECUTE FUNCTION app.reviews_guard_review();

CREATE FUNCTION app.reviews_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  RAISE EXCEPTION 'REVIEW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION app.reviews_append_only() FROM PUBLIC;
CREATE TRIGGER review_audit_append_only BEFORE UPDATE OR DELETE ON app.review_audit
FOR EACH ROW EXECUTE FUNCTION app.reviews_append_only();
CREATE TRIGGER review_receipt_append_only BEFORE UPDATE OR DELETE ON app.review_command_receipt
FOR EACH ROW EXECUTE FUNCTION app.reviews_append_only();

CREATE FUNCTION app.reviews_guard_outbox() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE
  r app.review%ROWTYPE;
  p jsonb;
  expected jsonb;
  previous text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REVIEW_EVENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO r FROM app.review WHERE id = NEW.review_id;
    IF NOT FOUND OR r.revision <> NEW.revision OR NEW.created_at <> r.updated_at OR NEW.trace_parent IS NOT NULL THEN
      RAISE EXCEPTION 'REVIEW_EVENT_BINDING' USING ERRCODE = '23514';
    END IF;
    p := NEW.payload::jsonb;
    IF (p->'actor'->>'kind') NOT IN ('account', 'guest')
      OR (p->'actor'->>'id') IS NULL
      OR (p->'actor'->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'REVIEW_EVENT_ACTOR' USING ERRCODE = '23514';
    END IF;
    IF NEW.revision > 1 THEN
      SELECT status INTO previous FROM app.review_audit WHERE review_id = NEW.review_id AND revision = NEW.revision - 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_EVENT_HISTORY' USING ERRCODE = '23514'; END IF;
    END IF;
    expected := jsonb_build_object(
      'eventId', NEW.event_id::text, 'eventType', 'reviews.review-status-changed.v1',
      'envelopeVersion', 2, 'producer', 'reviews',
      'occurredAt', to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'correlationId', NEW.correlation_id::text, 'causationId', NULL, 'traceparent', NULL,
      'aggregate', jsonb_build_object('type', 'review', 'id', r.id::text, 'version', NEW.revision),
      'actor', jsonb_build_object('kind', p->'actor'->>'kind', 'id', p->'actor'->>'id'),
      'data', jsonb_build_object('bookingId', r.booking_id::text, 'rating', r.rating, 'previousStatus', previous, 'status', r.status));
    IF p IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'REVIEW_EVENT_CONTRACT' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.event_id, NEW.event_type, NEW.exchange, NEW.routing_key, NEW.payload,
         NEW.review_id, NEW.revision, NEW.correlation_id, NEW.trace_parent, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.event_id, OLD.event_type, OLD.exchange, OLD.routing_key, OLD.payload,
         OLD.review_id, OLD.revision, OLD.correlation_id, OLD.trace_parent, OLD.created_at) THEN
    RAISE EXCEPTION 'REVIEW_EVENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.reviews_guard_outbox() FROM PUBLIC;
CREATE TRIGGER review_outbox_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.outbox_message
FOR EACH ROW EXECUTE FUNCTION app.reviews_guard_outbox();

-- Every revision commits together with a matching closed event, immutable audit
-- and actor-scoped replay receipt. This also rejects partial direct DML writes.
CREATE FUNCTION app.reviews_assert_effects() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE
  a app.review_audit%ROWTYPE;
  e app.outbox_message%ROWTYPE;
  c app.review_command_receipt%ROWTYPE;
  expected jsonb;
  previous text;
  expected_action text;
BEGIN
  SELECT * INTO a FROM app.review_audit WHERE review_id = NEW.id AND revision = NEW.revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_AUDIT_REQUIRED' USING ERRCODE = '23514'; END IF;
  SELECT * INTO e FROM app.outbox_message WHERE review_id = NEW.id AND revision = NEW.revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_EVENT_REQUIRED' USING ERRCODE = '23514'; END IF;
  SELECT * INTO c FROM app.review_command_receipt WHERE review_id = NEW.id AND revision = NEW.revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_RECEIPT_REQUIRED' USING ERRCODE = '23514'; END IF;
  previous := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  expected_action := CASE WHEN TG_OP = 'INSERT' THEN 'SUBMIT'
    WHEN NEW.status = 'PUBLISHED' THEN 'PUBLISH' WHEN NEW.status = 'REJECTED' THEN 'REJECT' ELSE 'HIDE' END;
  IF a.event_id <> e.event_id OR a.status <> NEW.status OR a.reason IS DISTINCT FROM NEW.moderation_reason
     OR a.previous_status IS DISTINCT FROM previous OR a.action <> expected_action
     OR a.occurred_at <> NEW.updated_at OR a.correlation_id <> e.correlation_id
     OR c.actor_kind <> a.actor_kind OR c.actor_subject <> a.actor_subject
     OR c.operation <> (CASE WHEN TG_OP = 'INSERT' THEN 'SUBMIT' ELSE 'MODERATE' END)
     OR (TG_OP = 'INSERT' AND (a.actor_kind <> NEW.author_kind OR a.actor_subject <> NEW.author_subject))
     OR (TG_OP = 'UPDATE' AND a.actor_kind <> 'account') THEN
    RAISE EXCEPTION 'REVIEW_EFFECT_BINDING' USING ERRCODE = '23514';
  END IF;
  expected := jsonb_build_object(
    'eventId', e.event_id::text, 'eventType', 'reviews.review-status-changed.v1',
    'envelopeVersion', 2, 'producer', 'reviews',
    'occurredAt', to_char(NEW.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'correlationId', e.correlation_id::text, 'causationId', NULL, 'traceparent', NULL,
    'aggregate', jsonb_build_object('type', 'review', 'id', NEW.id::text, 'version', NEW.revision),
    'actor', jsonb_build_object('kind', a.actor_kind, 'id', a.actor_subject::text),
    'data', jsonb_build_object('bookingId', NEW.booking_id::text, 'rating', NEW.rating, 'previousStatus', previous, 'status', NEW.status));
  IF e.payload::jsonb IS DISTINCT FROM expected OR e.created_at <> NEW.updated_at OR e.trace_parent IS NOT NULL THEN
    RAISE EXCEPTION 'REVIEW_EVENT_CONTRACT' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app.reviews_assert_effects() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER review_effects_required AFTER INSERT OR UPDATE ON app.review
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.reviews_assert_effects();

-- Provisioning may replay its blanket DML grants; its Reviews-specific hardening
-- preserves this reduced privilege on both historical tables afterwards.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cw_reviews_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON app.review_audit, app.review_command_receipt FROM cw_reviews_app;
  END IF;
END $$;
