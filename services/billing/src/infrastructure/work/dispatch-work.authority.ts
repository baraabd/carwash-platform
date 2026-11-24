import {
  WORK_STATES,
  WORK_TASK_STAGES,
  type WorkEvidence,
  type WorkState,
  type WorkTaskStage,
} from '../../domain';
import { WorkAuthorityUnavailable, type WorkAuthority } from '../../ports';
import {
  boundedText,
  isBearer,
  upstreamConfigFromEnv,
  type UpstreamConfig,
} from '../http/bounded-fetch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 2_147_483_647;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function dispatchWorkConfigFromEnv(env: NodeJS.ProcessEnv): UpstreamConfig {
  return upstreamConfigFromEnv(env, 'BILLING_DISPATCH_ORIGIN', 'BILLING_DISPATCH_TIMEOUT_MS');
}

function parseWork(value: unknown, bookingId: string): WorkEvidence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).sort().join(',') !==
    'assignmentId,assignmentRevision,bookingId,taskId,taskRevision,taskStage,technicianSubjectId,workState'
  )
    return null;
  if (
    body.bookingId !== bookingId ||
    !uuid(body.assignmentId) ||
    !positiveRevision(body.assignmentRevision) ||
    !uuid(body.technicianSubjectId) ||
    !WORK_STATES.some((state) => state === body.workState)
  )
    return null;
  const { taskId, taskStage, taskRevision } = body;
  const noTask = taskId === null && taskStage === null && taskRevision === null;
  if (
    !noTask &&
    (!uuid(taskId) ||
      !positiveRevision(taskRevision) ||
      !WORK_TASK_STAGES.some((stage) => stage === taskStage))
  )
    return null;
  const expectedState: WorkState =
    taskStage === 'CLOSED' || taskStage === 'FINISHED'
      ? 'COMPLETED'
      : taskStage === 'CANCELLED'
        ? 'CANCELLED'
        : ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING'].includes(String(taskStage))
          ? 'IN_PROGRESS'
          : 'NOT_STARTED';
  if (body.workState !== expectedState) return null;
  return {
    bookingId,
    assignmentId: body.assignmentId.toLowerCase(),
    assignmentRevision: body.assignmentRevision,
    technicianSubject: body.technicianSubjectId.toLowerCase(),
    workState: body.workState as WorkState,
    taskId: taskId === null ? null : String(taskId).toLowerCase(),
    taskStage: taskStage as WorkTaskStage | null,
    taskRevision,
  };
}

/**
 * Current assigned-work authority over Dispatch's versioned HTTP API. Forwards
 * only the technician credential and correlation id. No retries, caching,
 * redirect following or client-supplied work facts. Missing configuration,
 * denied access, malformed/oversized replies and network errors fail closed.
 */
export class DispatchWorkAuthority implements WorkAuthority {
  constructor(
    private readonly config: UpstreamConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async evidenceFor(
    bookingId: string,
    credential: string,
    correlationId: string,
  ): Promise<WorkEvidence | null> {
    if (!this.config.origin || !uuid(bookingId) || !isBearer(credential))
      throw new WorkAuthorityUnavailable();
    try {
      const response = await this.fetcher(
        new URL(`/internal/v1/dispatch/me/bookings/${bookingId}/work`, this.config.origin),
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: credential,
            'x-correlation-id': correlationId,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new WorkAuthorityUnavailable();
      }
      if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
        await response.body?.cancel();
        throw new WorkAuthorityUnavailable();
      }
      const text = await boundedText(response);
      const work = text === null ? null : parseWork(JSON.parse(text), bookingId);
      if (!work) throw new WorkAuthorityUnavailable();
      return work;
    } catch {
      throw new WorkAuthorityUnavailable();
    }
  }
}
