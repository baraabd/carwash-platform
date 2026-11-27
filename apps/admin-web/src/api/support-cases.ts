import {
  parseOpenCaseRequestV1,
  parseDecideCaseRequestV1,
  parseApproveDecisionRequestV1,
  parseCaseDetailV1,
  parseCasePageV1,
  parseCaseSubjectCurrentV1,
  type OpenCaseRequestV1,
  type DecideCaseRequestV1,
  type ApproveDecisionRequestV1,
  type CaseV1,
  type CaseDetailV1,
} from '@carwash/contracts/support-v1';
import { request, type Result } from './http';

export function supportCases(
  query: { readonly kind?: string; readonly status?: string; readonly cursor?: string } = {},
) {
  return request('/admin/support', {
    query: { ...query, limit: '30' },
    read: (raw) => {
      const page = parseCasePageV1(raw);
      if (new Set(page.items.map((item) => item.caseId)).size !== page.items.length)
        throw new Error('duplicate support case');
      return page;
    },
  });
}
function caseReader(caseId: string) {
  return (raw: unknown): CaseDetailV1 => {
    const value = parseCaseDetailV1(raw);
    if (value.case.caseId !== caseId) throw new Error('support case context');
    return value;
  };
}
export const supportCase = (caseId: string) =>
  request(`/admin/support/${encodeURIComponent(caseId)}`, { read: caseReader(caseId) });
export function supportCaseCurrent(record: CaseV1) {
  return request(`/admin/support/${encodeURIComponent(record.caseId)}/current`, {
    read: (raw) => {
      const value = parseCaseSubjectCurrentV1(raw);
      if (value.current.owner === 'booking') {
        if (
          record.subject.type !== 'booking' ||
          value.current.booking.bookingId !== record.subject.id
        )
          throw new Error('support booking context');
      } else if (
        record.subject.type === 'booking' ||
        value.current.obligation.obligationId !== (record.subject.parentId ?? record.subject.id)
      )
        throw new Error('support obligation context');
      return value;
    },
  });
}
export function openSupportCase(
  value: OpenCaseRequestV1,
  key: string,
): Promise<Result<CaseDetailV1>> {
  // The opening request omits parentId for a non-attempt subject (owner command shape).
  const subject =
    value.subject.type === 'billing.payment-attempt'
      ? value.subject
      : { type: value.subject.type, id: value.subject.id };
  const body = parseOpenCaseRequestV1({ ...value, subject });
  return request('/admin/support', {
    method: 'POST',
    body: { ...body, subject },
    idempotencyKey: key,
    read: (raw) => {
      const value = parseCaseDetailV1(raw);
      if (
        value.case.kind !== body.kind ||
        value.case.subject.id !== body.subject.id ||
        value.case.subject.parentId !== body.subject.parentId
      )
        throw new Error('new support case context');
      return value;
    },
  });
}
export function decideSupportCase(caseId: string, body: DecideCaseRequestV1, key: string) {
  return request(`/admin/support/${encodeURIComponent(caseId)}/decisions`, {
    method: 'POST',
    body: parseDecideCaseRequestV1(body),
    idempotencyKey: key,
    read: caseReader(caseId),
  });
}
export function approveSupportDecision(
  caseId: string,
  decisionNo: number,
  body: ApproveDecisionRequestV1,
  key: string,
) {
  return request(`/admin/support/${encodeURIComponent(caseId)}/decisions/${decisionNo}/approval`, {
    method: 'POST',
    body: parseApproveDecisionRequestV1(body),
    idempotencyKey: key,
    read: caseReader(caseId),
  });
}
export function resendSupportDecision(caseId: string, decisionNo: number, key: string) {
  // Support retrieves the previously frozen owner command. The browser does not reconstruct it.
  return request(`/admin/support/${encodeURIComponent(caseId)}/decisions/${decisionNo}/execution`, {
    method: 'POST',
    body: {},
    idempotencyKey: key,
    read: caseReader(caseId),
  });
}
