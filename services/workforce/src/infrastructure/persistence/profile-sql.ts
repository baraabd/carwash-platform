/**
 * SQL for the P05-C1 operator profile aggregates: service area, weekly
 * schedule, availability exceptions and equipment. Each function takes either
 * a transaction or the pooled client; the store classes delegate to them so
 * the transactional and read paths share one mapping.
 */
import {
  EQUIPMENT_ISSUES,
  EQUIPMENT_KINDS,
  EQUIPMENT_STATUSES,
  EXCEPTION_REASONS,
  type AvailabilityExceptionState,
  type EquipmentIssue,
  type EquipmentKind,
  type EquipmentState,
  type EquipmentStatus,
  type ExceptionReason,
  type ExceptionStatus,
  type ServiceAreaState,
  type WeeklyScheduleState,
} from '../../domain';
import type { InsertExceptionResult, InsertResult } from '../../ports';

export interface Sql {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

function member<T extends string>(values: readonly T[], value: string, what: string): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`${what}_UNKNOWN`);
  return found;
}

export function sqlStateOf(error: unknown): string | undefined {
  const cause = (
    error as {
      meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
    }
  ).meta?.driverAdapterError?.cause;
  const code = cause?.code ?? cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}

// ---------------------------------------------------------------------------
// Service area
// ---------------------------------------------------------------------------

interface AreaRow {
  operator_id: string;
  revision: number;
  updated_at: Date;
  zone_ids: string[];
}

const AREA_SELECT = `SELECT a.operator_id::text, a.revision, a.updated_at,
  ARRAY(SELECT z.zone_id::text FROM app.operator_service_zone z
         WHERE z.operator_id = a.operator_id ORDER BY 1) AS zone_ids
  FROM app.operator_service_area a WHERE a.operator_id = $1::uuid`;

function toArea(row: AreaRow): ServiceAreaState {
  return {
    operatorId: row.operator_id,
    extraZoneIds: row.zone_ids,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export async function readServiceArea(
  sql: Sql,
  operatorId: string,
  lock: boolean,
): Promise<ServiceAreaState | null> {
  const [row] = await sql.$queryRawUnsafe<AreaRow[]>(
    `${AREA_SELECT}${lock ? ' FOR UPDATE OF a' : ''}`,
    operatorId,
  );
  return row ? toArea(row) : null;
}

/**
 * Revision 1 inserts (a concurrent first writer makes this one lose); a later
 * revision is guarded by the expected one. The zone rows are replaced whole.
 */
export async function saveServiceArea(
  sql: Sql,
  state: ServiceAreaState,
  expectedRevision: number,
): Promise<boolean> {
  const rows =
    expectedRevision === 0
      ? await sql.$queryRawUnsafe<{ operator_id: string }[]>(
          `INSERT INTO app.operator_service_area (operator_id, revision, updated_at)
           VALUES ($1::uuid, $2, $3) ON CONFLICT (operator_id) DO NOTHING
           RETURNING operator_id::text`,
          state.operatorId,
          state.revision,
          state.updatedAt,
        )
      : await sql.$queryRawUnsafe<{ operator_id: string }[]>(
          `UPDATE app.operator_service_area SET revision=$3, updated_at=$4
           WHERE operator_id=$1::uuid AND revision=$2 RETURNING operator_id::text`,
          state.operatorId,
          expectedRevision,
          state.revision,
          state.updatedAt,
        );
  if (rows.length !== 1) return false;
  await sql.$executeRawUnsafe(
    `DELETE FROM app.operator_service_zone WHERE operator_id=$1::uuid`,
    state.operatorId,
  );
  if (state.extraZoneIds.length > 0) {
    await sql.$executeRawUnsafe(
      `INSERT INTO app.operator_service_zone (operator_id, zone_id)
       SELECT $1::uuid, z FROM unnest($2::uuid[]) AS z`,
      state.operatorId,
      [...state.extraZoneIds],
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Weekly schedule
// ---------------------------------------------------------------------------

interface ScheduleRow {
  operator_id: string;
  time_zone: string;
  revision: number;
  updated_at: Date;
  /** `weekday|start|end|zone`, in weekday/start order. */
  windows: string[];
}

const SCHEDULE_SELECT = `SELECT s.operator_id::text, s.time_zone, s.revision, s.updated_at,
  ARRAY(SELECT w.weekday || '|' || w.start_minute || '|' || w.end_minute || '|' || w.zone_id::text
          FROM app.operator_weekly_window w
         WHERE w.operator_id = s.operator_id ORDER BY w.weekday, w.start_minute) AS windows
  FROM app.operator_weekly_schedule s WHERE s.operator_id = $1::uuid`;

function toSchedule(row: ScheduleRow): WeeklyScheduleState {
  return {
    operatorId: row.operator_id,
    timeZone: row.time_zone,
    revision: row.revision,
    updatedAt: row.updated_at,
    windows: row.windows.map((encoded) => {
      const [weekday, start, end, zoneId, extra] = encoded.split('|');
      if (
        weekday === undefined ||
        start === undefined ||
        end === undefined ||
        zoneId === undefined ||
        extra !== undefined
      ) {
        throw new Error('SCHEDULE_ROW_INCONSISTENT');
      }
      return {
        weekday: Number(weekday),
        startMinute: Number(start),
        endMinute: Number(end),
        zoneId,
      };
    }),
  };
}

export async function readSchedule(
  sql: Sql,
  operatorId: string,
  lock: boolean,
): Promise<WeeklyScheduleState | null> {
  const [row] = await sql.$queryRawUnsafe<ScheduleRow[]>(
    `${SCHEDULE_SELECT}${lock ? ' FOR UPDATE OF s' : ''}`,
    operatorId,
  );
  return row ? toSchedule(row) : null;
}

export async function saveSchedule(
  sql: Sql,
  state: WeeklyScheduleState,
  expectedRevision: number,
): Promise<boolean> {
  const rows =
    expectedRevision === 0
      ? await sql.$queryRawUnsafe<{ operator_id: string }[]>(
          `INSERT INTO app.operator_weekly_schedule (operator_id, time_zone, revision, updated_at)
           VALUES ($1::uuid, $2, $3, $4) ON CONFLICT (operator_id) DO NOTHING
           RETURNING operator_id::text`,
          state.operatorId,
          state.timeZone,
          state.revision,
          state.updatedAt,
        )
      : await sql.$queryRawUnsafe<{ operator_id: string }[]>(
          `UPDATE app.operator_weekly_schedule SET time_zone=$3, revision=$4, updated_at=$5
           WHERE operator_id=$1::uuid AND revision=$2 RETURNING operator_id::text`,
          state.operatorId,
          expectedRevision,
          state.timeZone,
          state.revision,
          state.updatedAt,
        );
  if (rows.length !== 1) return false;
  await sql.$executeRawUnsafe(
    `DELETE FROM app.operator_weekly_window WHERE operator_id=$1::uuid`,
    state.operatorId,
  );
  if (state.windows.length > 0) {
    await sql.$executeRawUnsafe(
      `INSERT INTO app.operator_weekly_window
         (operator_id, weekday, start_minute, end_minute, zone_id)
       SELECT $1::uuid, w.weekday, w.start_minute, w.end_minute, w.zone_id
         FROM unnest($2::smallint[], $3::smallint[], $4::smallint[], $5::uuid[])
           AS w(weekday, start_minute, end_minute, zone_id)`,
      state.operatorId,
      state.windows.map((w) => w.weekday),
      state.windows.map((w) => w.startMinute),
      state.windows.map((w) => w.endMinute),
      state.windows.map((w) => w.zoneId),
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Availability exceptions
// ---------------------------------------------------------------------------

interface ExceptionRow {
  id: string;
  operator_id: string;
  starts_at: Date;
  ends_at: Date;
  reason: string;
  status: string;
  requester: string;
  idempotency_key: string;
  request_fingerprint: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const EXCEPTION_COLUMNS = `id::text, operator_id::text, starts_at, ends_at, reason, status,
  requester, idempotency_key, request_fingerprint, version, created_at, updated_at`;

function toException(row: ExceptionRow): AvailabilityExceptionState {
  return {
    id: row.id,
    operatorId: row.operator_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: member<ExceptionReason>(EXCEPTION_REASONS, row.reason, 'EXCEPTION_REASON'),
    status: member<ExceptionStatus>(['ACTIVE', 'CANCELLED'], row.status, 'EXCEPTION_STATUS'),
    requester: row.requester,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findExceptionByIdempotency(
  sql: Sql,
  requester: string,
  key: string,
): Promise<AvailabilityExceptionState | null> {
  const [row] = await sql.$queryRawUnsafe<ExceptionRow[]>(
    `SELECT ${EXCEPTION_COLUMNS} FROM app.availability_exception
     WHERE requester=$1 AND idempotency_key=$2 LIMIT 1`,
    requester,
    key,
  );
  return row ? toException(row) : null;
}

/**
 * Serialised per operator with the same advisory lock family as shifts'
 * creation, so a replay check and the insert see one order. The exclusion
 * constraint is the final arbiter of overlap.
 */
export async function insertException(
  sql: Sql,
  state: AvailabilityExceptionState,
): Promise<InsertExceptionResult> {
  await sql.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtextextended('workforce.exception:' || $1::text,0))`,
    state.operatorId,
  );
  if (await findExceptionByIdempotency(sql, state.requester, state.idempotencyKey)) {
    return 'DUPLICATE_IDEMPOTENCY_KEY';
  }
  await sql.$executeRawUnsafe('SAVEPOINT insert_exception');
  try {
    await sql.$executeRawUnsafe(
      `INSERT INTO app.availability_exception
         (id, operator_id, starts_at, ends_at, reason, status, requester, idempotency_key,
          request_fingerprint, version, created_at, updated_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      state.id,
      state.operatorId,
      state.startsAt,
      state.endsAt,
      state.reason,
      state.status,
      state.requester,
      state.idempotencyKey,
      state.requestFingerprint,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
    await sql.$executeRawUnsafe('RELEASE SAVEPOINT insert_exception');
    return 'CREATED';
  } catch (error) {
    const code = sqlStateOf(error);
    if (code !== '23P01' && code !== '23505') throw error;
    await sql.$executeRawUnsafe('ROLLBACK TO SAVEPOINT insert_exception');
    return code === '23P01' ? 'OVERLAPS' : 'DUPLICATE_IDEMPOTENCY_KEY';
  }
}

export async function lockException(
  sql: Sql,
  id: string,
): Promise<AvailabilityExceptionState | null> {
  const [row] = await sql.$queryRawUnsafe<ExceptionRow[]>(
    `SELECT ${EXCEPTION_COLUMNS} FROM app.availability_exception WHERE id=$1::uuid FOR UPDATE`,
    id,
  );
  return row ? toException(row) : null;
}

export async function updateException(
  sql: Sql,
  state: AvailabilityExceptionState,
  expectedVersion: number,
): Promise<boolean> {
  const rows = await sql.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE app.availability_exception SET status=$3, version=$4, updated_at=$5
     WHERE id=$1::uuid AND version=$2 RETURNING id::text`,
    state.id,
    expectedVersion,
    state.status,
    state.version,
    state.updatedAt,
  );
  return rows.length === 1;
}

export async function listExceptions(
  sql: Sql,
  input: { operatorId: string; from: Date; to: Date; activeOnly: boolean },
): Promise<AvailabilityExceptionState[]> {
  const rows = await sql.$queryRawUnsafe<ExceptionRow[]>(
    `SELECT ${EXCEPTION_COLUMNS} FROM app.availability_exception
     WHERE operator_id=$1::uuid AND starts_at < $3 AND ends_at > $2
       AND ($4::boolean = false OR status = 'ACTIVE')
     ORDER BY starts_at, id LIMIT 100`,
    input.operatorId,
    input.from,
    input.to,
    input.activeOnly,
  );
  return rows.map(toException);
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

interface EquipmentRow {
  id: string;
  operator_id: string;
  kind: string;
  required: boolean;
  status: string;
  issue: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

const EQUIPMENT_COLUMNS = `id::text, operator_id::text, kind, required, status, issue, revision,
  created_at, updated_at`;

function toEquipment(row: EquipmentRow): EquipmentState {
  return {
    id: row.id,
    operatorId: row.operator_id,
    kind: member<EquipmentKind>(EQUIPMENT_KINDS, row.kind, 'EQUIPMENT_KIND'),
    required: row.required,
    status: member<EquipmentStatus>(EQUIPMENT_STATUSES, row.status, 'EQUIPMENT_STATUS'),
    issue:
      row.issue === null
        ? null
        : member<EquipmentIssue>(EQUIPMENT_ISSUES, row.issue, 'EQUIPMENT_ISSUE'),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEquipment(
  sql: Sql,
  operatorId: string,
  lock: boolean,
): Promise<EquipmentState[]> {
  const rows = await sql.$queryRawUnsafe<EquipmentRow[]>(
    `SELECT ${EQUIPMENT_COLUMNS} FROM app.operator_equipment
     WHERE operator_id=$1::uuid ORDER BY kind${lock ? ' FOR UPDATE' : ''}`,
    operatorId,
  );
  return rows.map(toEquipment);
}

export async function insertEquipment(sql: Sql, state: EquipmentState): Promise<InsertResult> {
  const rows = await sql.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO app.operator_equipment
       (id, operator_id, kind, required, status, issue, revision, created_at, updated_at)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (operator_id, kind) DO NOTHING RETURNING id::text`,
    state.id,
    state.operatorId,
    state.kind,
    state.required,
    state.status,
    state.issue,
    state.revision,
    state.createdAt,
    state.updatedAt,
  );
  return rows.length === 1 ? 'CREATED' : 'DUPLICATE';
}

export async function updateEquipment(
  sql: Sql,
  state: EquipmentState,
  expectedRevision: number,
): Promise<boolean> {
  const rows = await sql.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE app.operator_equipment SET required=$3, status=$4, issue=$5, revision=$6, updated_at=$7
     WHERE id=$1::uuid AND revision=$2 RETURNING id::text`,
    state.id,
    expectedRevision,
    state.required,
    state.status,
    state.issue,
    state.revision,
    state.updatedAt,
  );
  return rows.length === 1;
}
