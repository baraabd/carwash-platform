import {
  parseCustodyReconciliationReportV1,
  parseHolderPositionV1,
  parseHandoverV1,
  parseReceiveHandoverRequestV1,
  parseReconcileHandoverRequestV1,
  type HandoverV1,
  type ReceiveHandoverRequestV1,
  type ReconcileHandoverRequestV1,
} from '@carwash/contracts/billing-v1';
import { request } from './http';

export const custodyReconciliation = () =>
  request('/admin/billing/custody/reconciliation', { read: parseCustodyReconciliationReportV1 });
export const holderCustody = (subject: string) =>
  request(`/admin/billing/custody/holders/${encodeURIComponent(subject)}`, {
    read: (raw) => {
      const value = parseHolderPositionV1(raw);
      if (value.holder !== subject) throw new Error('holder context');
      return value;
    },
  });
export const handover = (handoverId: string) =>
  request(`/admin/billing/custody/handovers/${encodeURIComponent(handoverId)}`, {
    read: (raw) => {
      const value = parseHandoverV1(raw);
      if (value.handoverId !== handoverId) throw new Error('handover context');
      return value;
    },
  });
function receiptReader(record: HandoverV1) {
  return (raw: unknown): HandoverV1 => {
    const value = parseHandoverV1(raw);
    if (
      value.handoverId !== record.handoverId ||
      value.holder !== record.holder ||
      value.declared.currency !== record.declared.currency ||
      value.declared.amountMinor !== record.declared.amountMinor ||
      value.revision < record.revision
    )
      throw new Error('handover receipt context');
    return value;
  };
}
export function receiveHandover(
  record: HandoverV1,
  command: ReceiveHandoverRequestV1,
  key: string,
) {
  const body = parseReceiveHandoverRequestV1(command);
  if (
    body.expectedRevision !== record.revision ||
    body.countedAmount.currency !== record.declared.currency ||
    body.countedAmount.scale !== record.declared.scale
  )
    throw new Error('handover command context');
  return request(`/admin/billing/custody/handovers/${record.handoverId}/treasury-receipt`, {
    method: 'POST',
    body,
    idempotencyKey: key,
    read: receiptReader(record),
  });
}
export function reconcileHandover(
  record: HandoverV1,
  command: ReconcileHandoverRequestV1,
  key: string,
) {
  const body = parseReconcileHandoverRequestV1(command);
  if (body.expectedRevision !== record.revision) throw new Error('handover command context');
  return request(`/admin/billing/custody/handovers/${record.handoverId}/reconciliation`, {
    method: 'POST',
    body,
    idempotencyKey: key,
    read: receiptReader(record),
  });
}
