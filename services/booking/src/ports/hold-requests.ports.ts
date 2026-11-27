import type { schedulingV1 } from '@carwash/contracts';
import type { RequestMeta } from './runtime.ports';

export interface HoldRequestResult {
  readonly status: number;
  readonly body: schedulingV1.HoldV1;
}

/** Scheduling remains the sole owner of temporary capacity and idempotency. */
export interface HoldRequests {
  create(
    meta: RequestMeta,
    key: string,
    body: schedulingV1.HoldRequestV1,
  ): Promise<HoldRequestResult>;
  get(meta: RequestMeta, holdId: string): Promise<HoldRequestResult>;
  release(
    meta: RequestMeta,
    holdId: string,
    key: string,
    body: schedulingV1.ReleaseHoldRequestV1,
  ): Promise<HoldRequestResult>;
}
