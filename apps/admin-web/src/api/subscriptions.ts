import {
  closed,
  list,
  oneOf,
  parsePage,
  parseRevision,
  parseUtc,
  uuid,
} from '@carwash/contracts/common';
import {
  parsePlanV1,
  parsePublishPlanRequestV1,
  parseSubscriptionV1,
  parseSubscriptionChangeV1,
  SUBSCRIPTION_CHANGE_ACTIONS,
  SUBSCRIPTION_CHANGE_REASONS,
  type PublishPlanRequestV1,
} from '@carwash/contracts/subscription-v1';
import { request } from './http';

export function subscriptionPlans(cursor?: string) {
  return request('/admin/subscription-plans', {
    query: { limit: '50', cursor },
    read: (raw) => parsePage(raw, '$', parsePlanV1),
  });
}
export function publishSubscriptionPlan(
  planId: string,
  command: PublishPlanRequestV1,
  key: string,
) {
  const body = parsePublishPlanRequestV1(command);
  return request(`/admin/subscription-plans/${encodeURIComponent(planId)}/versions`, {
    method: 'POST',
    body,
    idempotencyKey: key,
    read: (raw) => {
      const value = parsePlanV1(raw);
      if (
        value.planId !== planId ||
        value.version !== body.expectedRevision + 1 ||
        value.name !== body.name ||
        value.status !== body.status ||
        value.price.amountMinor !== body.price.amountMinor ||
        value.price.currency !== body.price.currency ||
        value.units !== body.units ||
        value.validityDays !== body.validityDays ||
        value.packageIds.join('|') !== body.packageIds.join('|') ||
        value.vehicleTypes.join('|') !== body.vehicleTypes.join('|')
      )
        throw new Error('published plan context');
      return value;
    },
  });
}
export function subscriptionById(subscriptionId: string) {
  return request(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    read: (raw) => {
      const value = parseSubscriptionV1(raw);
      if (value.subscriptionId !== subscriptionId) throw new Error('subscription context');
      return value;
    },
  });
}
export function pendingSubscriptionChanges() {
  return request('/admin/subscription-changes', {
    read: (raw) => {
      const value = closed(raw, '$', ['items']);
      return list(value.items, '$.items', 100, (entry, path) => {
        const item = closed(entry, path, [
          'changeId',
          'subscriptionId',
          'expectedRevision',
          'action',
          'reason',
          'requestedAt',
          'status',
        ]);
        return {
          changeId: uuid(item.changeId, `${path}.changeId`),
          subscriptionId: uuid(item.subscriptionId, `${path}.subscriptionId`),
          expectedRevision: parseRevision(item.expectedRevision, `${path}.expectedRevision`),
          action: oneOf(item.action, `${path}.action`, SUBSCRIPTION_CHANGE_ACTIONS),
          reason: oneOf(item.reason, `${path}.reason`, SUBSCRIPTION_CHANGE_REASONS),
          requestedAt: parseUtc(item.requestedAt, `${path}.requestedAt`),
          status: oneOf(item.status, `${path}.status`, ['PENDING_REVIEW'] as const),
        };
      });
    },
  });
}
export function decideSubscriptionChange(
  subscriptionId: string,
  changeId: string,
  approve: boolean,
  key: string,
) {
  return request(
    `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/changes/${encodeURIComponent(changeId)}/decision`,
    {
      method: 'POST',
      body: { approve },
      idempotencyKey: key,
      read: (raw) => {
        const value = parseSubscriptionChangeV1(raw);
        if (value.changeId !== changeId || value.subscription.subscriptionId !== subscriptionId)
          throw new Error('subscription decision context');
        return value;
      },
    },
  );
}
