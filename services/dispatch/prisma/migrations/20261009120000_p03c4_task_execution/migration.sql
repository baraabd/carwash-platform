-- P03-C4: technician task execution under the current assignment, evidence
-- links to Media objects, technician notes, task history, Workforce
-- eligibility observations and the widened offer/idempotency/audit domains.
-- Applied by the migration identity (cw_dispatch_migrate) as a separate job.
--
-- Expand-only. New tables, columns and indexes; three existing CHECK
-- constraints are replaced by strictly WIDER ones (every value the previous
-- release writes is still valid), so the previous image keeps working against
-- this schema and rollback is a redeploy of that image.
--
-- Invariants enforced HERE, not only in application code:
--   * one task per accepted offer, at most one non-terminal task per assignment,
--   * a technician is in the field (EN_ROUTE..FINISHED) on at most one task,
--   * forward-only stage transitions, stage <-> timestamp consistency,
--   * ARRIVED -> IN_SERVICE needs a current BEFORE photo, IN_SERVICE ->
--     DOCUMENTING needs every required checklist item, DOCUMENTING -> FINISHED
--     needs a current AFTER photo,
--   * a CLOSED task is immutable except a single late cash declaration,
--   * a Media object is linked to at most one task slot, ever; one current
--     link per (task, phase, slot); links are append-only except removal,
--   * money as integer minor units with an explicit currency and scale.

-- Offers: two new withdraw reasons and an optional decline note.
ALTER TABLE "dispatch_offer" DROP CONSTRAINT "dispatch_offer_withdraw_ck";
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_withdraw_ck" CHECK (
    ("status" = 'WITHDRAWN') = ("withdraw_reason" IS NOT NULL)
    AND ("withdraw_reason" IS NULL OR "withdraw_reason" IN (
        'REASSIGNED', 'UNASSIGNED', 'JOB_CANCELLED', 'RELEASED_BY_TECHNICIAN', 'RESOURCE_INELIGIBLE'
    ))
);
ALTER TABLE "dispatch_offer" ADD COLUMN "decline_note" VARCHAR(500);
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_decline_note_ck" CHECK (
    "decline_note" IS NULL
    OR ("status" = 'DECLINED' AND char_length(btrim("decline_note")) BETWEEN 3 AND 500)
);
CREATE INDEX "dispatch_offer_resource_id_status_idx" ON "dispatch_offer"("resource_id", "status");

ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_result_type_ck";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_result_type_ck"
    CHECK ("result_type" IN ('ASSIGNMENT', 'OFFER', 'TASK'));

ALTER TABLE "audit_entry" DROP CONSTRAINT "audit_entry_target_type_ck";
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_target_type_ck"
    CHECK ("target_type" IN ('ASSIGNMENT', 'OFFER', 'HOLD', 'TASK', 'RESOURCE'));

-- Highest workforce.eligibility-changed.v1 revision applied per resource.
CREATE TABLE "resource_observation" (
    "resource_id" UUID NOT NULL,
    "eligibility" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_observation_pkey" PRIMARY KEY ("resource_id"),
    CONSTRAINT "resource_observation_eligibility_ck" CHECK ("eligibility" IN ('ELIGIBLE', 'INELIGIBLE')),
    CONSTRAINT "resource_observation_revision_ck" CHECK ("revision" >= 1)
);

CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "technician_subject" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "checklist_version" VARCHAR(40) NOT NULL,
    "checklist" JSONB NOT NULL,
    "condition_note" VARCHAR(800),
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "departed_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "arrival_method" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "documented_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "release_reason" VARCHAR(500),
    "attention_reason" TEXT,
    "collection_outcome" TEXT,
    "collection_currency" CHAR(3),
    "collection_scale" SMALLINT,
    "collection_amount_minor" BIGINT,
    "collection_reason" VARCHAR(500),
    "collection_declared_at" TIMESTAMPTZ(3),
    "late_amount_minor" BIGINT,
    "late_declared_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_stage_ck" CHECK ("stage" IN (
        'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED',
        'RELEASED', 'WITHDRAWN', 'CANCELLED'
    )),
    CONSTRAINT "task_version_ck" CHECK ("version" >= 1),
    CONSTRAINT "task_checklist_version_ck" CHECK ("checklist_version" = 'washgo.checklist.v1'),
    CONSTRAINT "task_checklist_shape_ck" CHECK (
        jsonb_typeof("checklist") = 'array' AND jsonb_array_length("checklist") BETWEEN 1 AND 20
    ),
    CONSTRAINT "task_condition_note_ck" CHECK (
        "condition_note" IS NULL OR char_length(btrim("condition_note")) BETWEEN 1 AND 800
    ),
    -- Progress timestamps exist exactly from the stage that sets them onwards.
    CONSTRAINT "task_departed_ck" CHECK (
        ("stage" = 'ACCEPTED' AND "departed_at" IS NULL)
        OR ("stage" = 'RELEASED' AND "departed_at" IS NULL)
        OR ("stage" IN ('EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED')
            AND "departed_at" IS NOT NULL)
        OR "stage" IN ('WITHDRAWN', 'CANCELLED')
    ),
    CONSTRAINT "task_arrived_ck" CHECK (
        ("arrived_at" IS NULL) = ("arrival_method" IS NULL)
        AND ("arrival_method" IS NULL OR "arrival_method" = 'MANUAL_CONFIRMATION')
        AND ("stage" NOT IN ('ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED')
             OR "arrived_at" IS NOT NULL)
        AND ("stage" NOT IN ('ACCEPTED', 'EN_ROUTE', 'RELEASED') OR "arrived_at" IS NULL)
    ),
    CONSTRAINT "task_started_ck" CHECK (
        ("stage" NOT IN ('IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED') OR "started_at" IS NOT NULL)
        AND ("stage" NOT IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'RELEASED') OR "started_at" IS NULL)
    ),
    CONSTRAINT "task_documented_ck" CHECK (
        ("stage" NOT IN ('DOCUMENTING', 'FINISHED', 'CLOSED') OR "documented_at" IS NOT NULL)
        AND ("stage" NOT IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'RELEASED')
             OR "documented_at" IS NULL)
    ),
    CONSTRAINT "task_finished_ck" CHECK (
        ("stage" NOT IN ('FINISHED', 'CLOSED') OR "finished_at" IS NOT NULL)
        AND ("stage" IN ('FINISHED', 'CLOSED', 'WITHDRAWN', 'CANCELLED') OR "finished_at" IS NULL)
    ),
    CONSTRAINT "task_closed_ck" CHECK (("stage" = 'CLOSED') = ("closed_at" IS NOT NULL)),
    CONSTRAINT "task_end_ck" CHECK (
        ("stage" IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')) = ("ended_at" IS NOT NULL)
        AND ("stage" IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')) = ("end_reason" IS NOT NULL)
        AND ("end_reason" IS NULL OR "end_reason" IN (
            'RELEASED_BY_TECHNICIAN', 'REASSIGNED', 'UNASSIGNED', 'RESOURCE_INELIGIBLE', 'JOB_CANCELLED'
        ))
        AND (("stage" = 'RELEASED') = ("release_reason" IS NOT NULL))
        AND ("release_reason" IS NULL OR char_length(btrim("release_reason")) BETWEEN 3 AND 500)
    ),
    CONSTRAINT "task_attention_ck" CHECK (
        "attention_reason" IS NULL OR "attention_reason" = 'RESOURCE_INELIGIBLE'
    ),
    -- The technician's handoff declaration. A declaration is not a receipt;
    -- Billing owns whether money was received. A later cash declaration is
    -- only possible after CASH_NOT_COLLECTED and fixes the currency then.
    CONSTRAINT "task_collection_ck" CHECK (
        ("stage" = 'CLOSED') = ("collection_outcome" IS NOT NULL)
        AND ("collection_outcome" IS NULL) = ("collection_declared_at" IS NULL)
        AND ("collection_outcome" IS NULL
             OR "collection_outcome" IN ('CASH_COLLECTED', 'CASH_NOT_COLLECTED', 'NOT_CASH'))
        AND ("collection_outcome" IS NOT DISTINCT FROM 'CASH_COLLECTED')
            = ("collection_amount_minor" IS NOT NULL)
        AND ("collection_amount_minor" IS NULL OR "collection_amount_minor" > 0)
        AND ("collection_outcome" IS NOT DISTINCT FROM 'CASH_NOT_COLLECTED')
            = ("collection_reason" IS NOT NULL)
        AND ("collection_reason" IS NULL OR char_length(btrim("collection_reason")) BETWEEN 3 AND 500)
        AND ("collection_amount_minor" IS NOT NULL OR "late_amount_minor" IS NOT NULL)
            = ("collection_currency" IS NOT NULL)
        AND ("collection_currency" IS NULL) = ("collection_scale" IS NULL)
        AND ("collection_currency" IS NULL
             OR ("collection_currency" IN ('SYP', 'USD') AND "collection_scale" = 2))
    ),
    CONSTRAINT "task_late_cash_ck" CHECK (
        ("late_amount_minor" IS NULL) = ("late_declared_at" IS NULL)
        AND ("late_amount_minor" IS NULL
             OR ("collection_outcome" = 'CASH_NOT_COLLECTED' AND "late_amount_minor" > 0))
    )
);

CREATE UNIQUE INDEX "task_offer_id_key" ON "task"("offer_id");
CREATE INDEX "task_assignment_id_idx" ON "task"("assignment_id");
CREATE INDEX "task_technician_subject_updated_at_idx" ON "task"("technician_subject", "updated_at");
CREATE INDEX "task_resource_id_stage_idx" ON "task"("resource_id", "stage");
CREATE UNIQUE INDEX "task_one_open_per_assignment_key" ON "task"("assignment_id")
    WHERE "stage" NOT IN ('RELEASED', 'WITHDRAWN', 'CANCELLED');
CREATE UNIQUE INDEX "task_one_in_field_per_technician_key" ON "task"("technician_subject")
    WHERE "stage" IN ('EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED');

CREATE TABLE "task_evidence" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "slot" SMALLINT NOT NULL,
    "media_object_id" UUID NOT NULL,
    "attached_at" TIMESTAMPTZ(3) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_evidence_phase_ck" CHECK ("phase" IN ('BEFORE', 'AFTER')),
    CONSTRAINT "task_evidence_slot_ck" CHECK ("slot" IN (0, 1)),
    CONSTRAINT "task_evidence_removed_ck" CHECK ("removed_at" IS NULL OR "removed_at" >= "attached_at")
);
CREATE UNIQUE INDEX "task_evidence_media_object_id_key" ON "task_evidence"("media_object_id");
CREATE UNIQUE INDEX "task_evidence_current_slot_key" ON "task_evidence"("task_id", "phase", "slot")
    WHERE "removed_at" IS NULL;
CREATE INDEX "task_evidence_task_id_idx" ON "task_evidence"("task_id");

CREATE TABLE "task_note" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_note_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_note_kind_ck" CHECK ("kind" IN ('HELP', 'CASH_ISSUE', 'PAYMENT_FOLLOW_UP')),
    CONSTRAINT "task_note_text_ck" CHECK (char_length(btrim("text")) BETWEEN 3 AND 500)
);
CREATE INDEX "task_note_task_id_created_at_idx" ON "task_note"("task_id", "created_at");

-- Ordered, append-only history shown to the technician (not the audit log).
CREATE TABLE "task_event" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_event_seq_ck" CHECK ("seq" >= 1),
    CONSTRAINT "task_event_action_ck" CHECK ("action" ~ '^[a-z][a-z_.-]{1,39}$')
);
CREATE UNIQUE INDEX "task_event_task_id_seq_key" ON "task_event"("task_id", "seq");

ALTER TABLE "task" ADD CONSTRAINT "task_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "dispatch_offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_note" ADD CONSTRAINT "task_note_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stage machine and gates. Raised errors use SQLSTATE 23514 (check_violation)
-- so the adapter maps them like any other constraint failure.
CREATE FUNCTION "app"."dispatch_task_guard"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    allowed BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."stage" <> 'ACCEPTED' OR NEW."version" <> 1 THEN
            RAISE EXCEPTION 'TASK_INSERT_NOT_ACCEPTED' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."assignment_id" <> OLD."assignment_id"
        OR NEW."offer_id" <> OLD."offer_id" OR NEW."booking_id" <> OLD."booking_id"
        OR NEW."resource_id" <> OLD."resource_id"
        OR NEW."technician_subject" <> OLD."technician_subject"
        OR NEW."checklist_version" <> OLD."checklist_version"
        OR NEW."accepted_at" <> OLD."accepted_at" OR NEW."created_at" <> OLD."created_at" THEN
        RAISE EXCEPTION 'TASK_IMMUTABLE_FIELD' USING ERRCODE = '23514';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
        RAISE EXCEPTION 'TASK_VERSION_STEP' USING ERRCODE = '23514';
    END IF;
    IF OLD."stage" IN ('RELEASED', 'WITHDRAWN', 'CANCELLED') THEN
        RAISE EXCEPTION 'TASK_TERMINAL' USING ERRCODE = '23514';
    END IF;
    IF OLD."stage" = 'CLOSED' THEN
        -- Only one late cash declaration may follow a CASH_NOT_COLLECTED close.
        allowed := NEW."stage" = 'CLOSED'
            AND OLD."late_amount_minor" IS NULL AND NEW."late_amount_minor" IS NOT NULL
            AND (to_jsonb(NEW) - 'late_amount_minor' - 'late_declared_at' - 'collection_currency'
                 - 'collection_scale' - 'version' - 'updated_at')
              = (to_jsonb(OLD) - 'late_amount_minor' - 'late_declared_at' - 'collection_currency'
                 - 'collection_scale' - 'version' - 'updated_at');
        IF NOT allowed THEN
            RAISE EXCEPTION 'TASK_CLOSED_IMMUTABLE' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."stage" <> OLD."stage" THEN
        allowed := (OLD."stage", NEW."stage") IN (
            ('ACCEPTED', 'EN_ROUTE'), ('EN_ROUTE', 'ARRIVED'), ('ARRIVED', 'IN_SERVICE'),
            ('IN_SERVICE', 'DOCUMENTING'), ('DOCUMENTING', 'FINISHED'), ('FINISHED', 'CLOSED'),
            ('ACCEPTED', 'RELEASED')
        ) OR NEW."stage" IN ('WITHDRAWN', 'CANCELLED');
        IF NOT allowed THEN
            RAISE EXCEPTION 'TASK_INVALID_TRANSITION' USING ERRCODE = '23514';
        END IF;
        IF NEW."stage" = 'IN_SERVICE' AND NOT EXISTS (
            SELECT 1 FROM "app"."task_evidence" e
             WHERE e."task_id" = NEW."id" AND e."phase" = 'BEFORE' AND e."removed_at" IS NULL
        ) THEN
            RAISE EXCEPTION 'TASK_BEFORE_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
        END IF;
        IF NEW."stage" = 'DOCUMENTING' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(NEW."checklist") item
             WHERE (item ->> 'required')::boolean AND NOT (item ->> 'checked')::boolean
        ) THEN
            RAISE EXCEPTION 'TASK_CHECKLIST_INCOMPLETE' USING ERRCODE = '23514';
        END IF;
        IF NEW."stage" = 'FINISHED' AND NOT EXISTS (
            SELECT 1 FROM "app"."task_evidence" e
             WHERE e."task_id" = NEW."id" AND e."phase" = 'AFTER' AND e."removed_at" IS NULL
        ) THEN
            RAISE EXCEPTION 'TASK_AFTER_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "task_guard_insert" BEFORE INSERT ON "task"
    FOR EACH ROW EXECUTE FUNCTION "app"."dispatch_task_guard"();
CREATE TRIGGER "task_guard_update" BEFORE UPDATE ON "task"
    FOR EACH ROW EXECUTE FUNCTION "app"."dispatch_task_guard"();

-- Evidence links: inserted, or marked removed once; never rewritten or deleted.
CREATE FUNCTION "app"."dispatch_task_evidence_guard"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'TASK_EVIDENCE_APPEND_ONLY' USING ERRCODE = '23514';
    END IF;
    IF OLD."removed_at" IS NOT NULL
        OR (to_jsonb(NEW) - 'removed_at') <> (to_jsonb(OLD) - 'removed_at') THEN
        RAISE EXCEPTION 'TASK_EVIDENCE_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "task_evidence_guard" BEFORE UPDATE OR DELETE ON "task_evidence"
    FOR EACH ROW EXECUTE FUNCTION "app"."dispatch_task_evidence_guard"();

-- Notes and history are append-only.
CREATE FUNCTION "app"."dispatch_append_only"() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'DISPATCH_APPEND_ONLY: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "task_note_append_only" BEFORE UPDATE OR DELETE ON "task_note"
    FOR EACH ROW EXECUTE FUNCTION "app"."dispatch_append_only"();
CREATE TRIGGER "task_event_append_only" BEFORE UPDATE OR DELETE ON "task_event"
    FOR EACH ROW EXECUTE FUNCTION "app"."dispatch_append_only"();
