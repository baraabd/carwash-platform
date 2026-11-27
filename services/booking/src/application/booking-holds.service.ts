import { schedulingV1 } from '@carwash/contracts';
import { BookingError, uuidField } from '../domain';
import type { HoldRequests, RequestMeta } from '../ports';
import { CREATE_PERMISSION, requirePrincipal } from './authorization';
import { idempotencyKey } from './commands';

/** Authenticated checkout orchestration; neither prices nor capacity are fabricated. */
export class BookingHoldsService {
  constructor(private readonly owner: HoldRequests) {}

  async create(meta: RequestMeta, key: unknown, body: unknown) {
    const principal = requirePrincipal(meta.actor, CREATE_PERMISSION);
    const input = this.parse(() => schedulingV1.parseHoldRequestV1(body));
    if (
      input.beneficiary.kind !== principal.kind ||
      input.beneficiary.subjectId !== principal.subjectId
    )
      throw new BookingError('FORBIDDEN', 'The hold must belong to the caller.');
    return this.owner.create(meta, idempotencyKey(key), input);
  }

  get(meta: RequestMeta, holdId: string) {
    requirePrincipal(meta.actor, CREATE_PERMISSION);
    return this.owner.get(meta, uuidField(holdId, 'holdId'));
  }

  release(meta: RequestMeta, holdId: string, key: unknown, body: unknown) {
    requirePrincipal(meta.actor, CREATE_PERMISSION);
    const input = this.parse(() => schedulingV1.parseReleaseHoldRequestV1(body));
    return this.owner.release(meta, uuidField(holdId, 'holdId'), idempotencyKey(key), input);
  }

  private parse<T>(work: () => T): T {
    try {
      return work();
    } catch {
      throw new BookingError('INVALID_INPUT', 'Invalid hold request.');
    }
  }
}
