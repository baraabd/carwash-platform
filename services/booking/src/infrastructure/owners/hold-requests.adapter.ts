import { schedulingV1 } from '@carwash/contracts';
import { BookingError } from '../../domain';
import type { HoldRequests, HoldRequestResult, RequestMeta } from '../../ports';
import { errorOf, type OwnerHttpClient } from '../http/owner-http.client';

const PREFIX = '/internal/v1/scheduling/holds';

export class SchedulingHoldRequests implements HoldRequests {
  constructor(private readonly http: OwnerHttpClient) {}

  async create(meta: RequestMeta, key: string, body: schedulingV1.HoldRequestV1) {
    const result = await this.call(meta, 'POST', PREFIX, key, body);
    const hold = result.body;
    if (
      hold.zoneId !== body.zoneId ||
      hold.startsAt !== body.startsAt ||
      Date.parse(hold.endsAt) - Date.parse(hold.startsAt) !== body.durationMinutes * 60_000 ||
      hold.quoteRef.quoteId !== body.quoteRef.quoteId ||
      hold.quoteRef.revision !== body.quoteRef.revision
    )
      throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Scheduling returned another hold request.');
    return result;
  }
  async get(meta: RequestMeta, holdId: string) {
    const result = await this.call(meta, 'GET', `${PREFIX}/${encodeURIComponent(holdId)}`);
    if (result.body.holdId !== holdId)
      throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Scheduling returned another hold.');
    return result;
  }
  async release(
    meta: RequestMeta,
    holdId: string,
    key: string,
    body: schedulingV1.ReleaseHoldRequestV1,
  ) {
    const result = await this.call(
      meta,
      'POST',
      `${PREFIX}/${encodeURIComponent(holdId)}/release`,
      key,
      body,
    );
    if (result.body.holdId !== holdId || !['RELEASED', 'EXPIRED'].includes(result.body.state))
      throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Scheduling release is unverified.');
    return result;
  }

  private async call(
    meta: RequestMeta,
    method: 'GET' | 'POST',
    path: string,
    key?: string,
    body?: unknown,
  ): Promise<HoldRequestResult> {
    if (!meta.credential || meta.actor.kind !== 'USER')
      throw new BookingError('FORBIDDEN', 'A principal credential is required.');
    const outcome = await this.http.call({
      method,
      path,
      credential: meta.credential,
      correlationId: meta.correlationId,
      ...(key ? { idempotencyKey: key } : {}),
      ...(body === undefined ? {} : { body }),
    });
    if (outcome.kind !== 'RESPONSE')
      throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Scheduling outcome is unknown.');
    if (outcome.status >= 200 && outcome.status < 300) {
      let hold: schedulingV1.HoldV1;
      try {
        hold = schedulingV1.parseHoldV1(outcome.body);
      } catch {
        throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Invalid Scheduling response.');
      }
      if (
        hold.beneficiary.kind !== meta.actor.principalKind ||
        hold.beneficiary.subjectId !== meta.actor.subject
      )
        throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Invalid Scheduling ownership.');
      return { status: outcome.status, body: hold };
    }
    const reason = errorOf(outcome.body);
    if (outcome.status === 403) throw new BookingError('FORBIDDEN', 'The hold is unavailable.');
    if (outcome.status === 404)
      throw new BookingError('BOOKING_NOT_FOUND', 'The hold was not found.');
    if (reason?.code === 'IDEMPOTENCY_CONFLICT')
      throw new BookingError('IDEMPOTENCY_CONFLICT', 'Hold request conflicts.');
    if (reason?.code === 'IDEMPOTENCY_IN_PROGRESS')
      throw new BookingError('IDEMPOTENCY_IN_PROGRESS', 'Hold request pending.');
    if (outcome.status === 412) throw new BookingError('REVISION_CONFLICT', 'The hold changed.');
    if (outcome.status === 400) throw new BookingError('INVALID_INPUT', 'Invalid hold request.');
    if (outcome.status === 409 || outcome.status === 422)
      throw new BookingError('HOLD_NOT_USABLE', 'The hold is unavailable.', reason?.reason ?? null);
    throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Scheduling is unavailable.');
  }
}
