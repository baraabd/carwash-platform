import {
  CASE_KINDS,
  CASE_STATUSES,
  CASE_KIND_SUBJECT,
  EVIDENCE_KINDS,
  parseOpenCaseRequestV1,
  parseDecideCaseRequestV1,
  parseApproveDecisionRequestV1,
  type CaseKind,
  type CaseAction,
  type CaseV1,
  type CaseDetailV1,
  type CaseSubjectCurrentV1,
  type CaseReasonCode,
  type OpenCaseRequestV1,
  type DecideCaseRequestV1,
  type ApproveDecisionRequestV1,
} from '@carwash/contracts/support-v1';
import {
  supportCases,
  supportCase,
  supportCaseCurrent,
  openSupportCase,
  decideSupportCase,
  approveSupportDecision,
  resendSupportDecision,
} from '../api/support-cases';
import { readStatementCredit } from '../api/statement-credit';
import { idempotencyKey, UUID, type Result } from '../api/http';
import { shortRef } from '../domain/bookings';
import { formatMoney, parseAmount } from '../domain/finance';
import { append, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant } from './states';
import {
  ensureScreen,
  frame,
  freeze,
  input,
  invalid,
  label,
  readFailure,
  select,
  status,
  table,
  tr,
} from './domain-screen';

interface Wiring {
  readonly unauthenticated: () => void;
  readonly permissions: () => readonly string[];
  readonly subject: () => string | null;
}
let wiring: Wiring = {
  unauthenticated: () => undefined,
  permissions: () => [],
  subject: () => null,
};
let generation = 0;
let detailRequest = 0;
type Pending =
  | { kind: 'open'; body: OpenCaseRequestV1; key: string }
  | { kind: 'decide'; caseId: string; body: DecideCaseRequestV1; key: string }
  | {
      kind: 'approve';
      caseId: string;
      decisionNo: number;
      body: ApproveDecisionRequestV1;
      key: string;
    }
  | { kind: 'resend'; caseId: string; decisionNo: number; key: string };
const pending = new Map<string, Pending>();
const has = (permission: string): boolean => wiring.permissions().includes(permission);

export function wireSupportScreens(value: Wiring): void {
  wiring = value;
  ensureScreen('disputes');
}
export function invalidateSupportScreens(clearPrivate = false): void {
  generation++;
  if (clearPrivate) {
    pending.clear();
    document.getElementById('disputes')?.replaceChildren();
  }
}
const KIND: Record<CaseKind, readonly [string, string]> = {
  PAYMENT_REVIEW: ['مراجعة دفعة', 'Payment review'],
  REFUND: ['طلب استرداد', 'Refund'],
  LATE_PAYMENT: ['دفعة متأخرة', 'Late payment'],
  BOOKING_CANCELLATION: ['إلغاء حجز', 'Booking cancellation'],
  BOOKING_RESCHEDULE: ['تغيير موعد', 'Reschedule booking'],
};
const STATE: Record<string, readonly [string, string]> = {
  OPEN: ['مفتوحة', 'Open'],
  AWAITING_APPROVAL: ['بانتظار الموافقة الثانية', 'Awaiting second approval'],
  EXECUTING: ['قيد التنفيذ لدى الجهة المالكة', 'Owner execution pending'],
  OUTCOME_UNKNOWN: ['نتيجة غير محسومة', 'Outcome unknown'],
  BLOCKED_ON_OWNER: ['تعذر الوصول إلى الجهة المالكة', 'Blocked on owner'],
  OWNER_REJECTED: ['رفضت الجهة المالكة الإجراء', 'Owner rejected'],
  RESOLVED: ['محسومة', 'Resolved'],
  CLOSED: ['مغلقة', 'Closed'],
  APPLIED: ['طبّقت الجهة المالكة القرار', 'Applied by owner'],
  NO_OWNER_ACTION: ['أُغلق دون تغيير لدى الجهة المالكة', 'Closed without owner action'],
  REJECTED_BY_APPROVER: ['رفض المراجع الثاني', 'Rejected by second reviewer'],
  SUPERSEDED: ['استُبدل بقرار أحدث', 'Superseded'],
};
const ACTION: Record<CaseAction, readonly [string, string]> = {
  APPROVE_MATCH: ['اعتماد مطابقة الدفعة', 'Approve payment match'],
  REJECT_MISMATCH: ['رفض المطابقة', 'Reject mismatch'],
  MARK_UNKNOWN: ['إبقاء النتيجة غير محسومة', 'Mark outcome unknown'],
  ACCEPT_LATE_PAYMENT: ['قبول الدفعة المتأخرة', 'Accept late payment'],
  REFUND: ['طلب استرداد', 'Request refund'],
  CANCEL_BOOKING: ['طلب إلغاء الحجز', 'Request cancellation'],
  RESCHEDULE_BOOKING: ['طلب تغيير الموعد', 'Request reschedule'],
  DISMISS: ['إغلاق دون تغيير', 'Dismiss without change'],
};
const actions: Record<CaseKind, readonly CaseAction[]> = {
  PAYMENT_REVIEW: ['APPROVE_MATCH', 'REJECT_MISMATCH', 'MARK_UNKNOWN', 'DISMISS'],
  REFUND: ['REFUND', 'DISMISS'],
  LATE_PAYMENT: ['ACCEPT_LATE_PAYMENT', 'REFUND', 'DISMISS'],
  BOOKING_CANCELLATION: ['CANCEL_BOOKING', 'DISMISS'],
  BOOKING_RESCHEDULE: ['RESCHEDULE_BOOKING', 'DISMISS'],
};
const REASON: Record<CaseReasonCode, readonly [string, string]> = {
  PROVIDER_CONFIRMED: ['أكد المزود العملية', 'Provider confirmed'],
  PROVIDER_AMOUNT_DIFFERS: ['المبلغ لدى المزود مختلف', 'Provider amount differs'],
  PROVIDER_NO_RECORD: ['لا يوجد سجل لدى المزود', 'No provider record'],
  PROVIDER_UNREACHABLE: ['تعذر الوصول إلى المزود', 'Provider unreachable'],
  DUPLICATE_PAYMENT: ['دفعة مكررة', 'Duplicate payment'],
  SERVICE_NOT_DELIVERED: ['لم تُقدّم الخدمة', 'Service not delivered'],
  BOOKING_CANCELLED: ['أُلغي الحجز', 'Booking cancelled'],
  SERVICE_QUALITY: ['جودة الخدمة', 'Service quality'],
  PRICE_CORRECTION: ['تصحيح السعر', 'Price correction'],
  PAID_AFTER_CANCELLATION: ['وصلت الدفعة بعد الإلغاء', 'Paid after cancellation'],
  PAID_AFTER_DEADLINE: ['وصلت الدفعة بعد المهلة', 'Paid after deadline'],
  CUSTOMER_REQUEST: ['طلب العميل', 'Customer request'],
  TECHNICIAN_UNAVAILABLE: ['الفني غير متاح', 'Technician unavailable'],
  WEATHER_OR_SAFETY: ['الطقس أو السلامة', 'Weather or safety'],
  OPERATIONAL_ERROR: ['خطأ تشغيلي', 'Operational error'],
  ALREADY_HANDLED: ['عولجت الحالة مسبقًا', 'Already handled'],
  OTHER: ['سبب آخر موضح بالملاحظة', 'Other reason explained in note'],
};
const reasons: Record<CaseKind, readonly CaseReasonCode[]> = {
  PAYMENT_REVIEW: [
    'PROVIDER_CONFIRMED',
    'PROVIDER_AMOUNT_DIFFERS',
    'PROVIDER_NO_RECORD',
    'PROVIDER_UNREACHABLE',
    'DUPLICATE_PAYMENT',
    'ALREADY_HANDLED',
    'OTHER',
  ],
  REFUND: [
    'DUPLICATE_PAYMENT',
    'SERVICE_NOT_DELIVERED',
    'BOOKING_CANCELLED',
    'SERVICE_QUALITY',
    'PRICE_CORRECTION',
    'ALREADY_HANDLED',
    'OTHER',
  ],
  LATE_PAYMENT: [
    'PAID_AFTER_CANCELLATION',
    'PAID_AFTER_DEADLINE',
    'PROVIDER_CONFIRMED',
    'ALREADY_HANDLED',
    'OTHER',
  ],
  BOOKING_CANCELLATION: [
    'CUSTOMER_REQUEST',
    'TECHNICIAN_UNAVAILABLE',
    'WEATHER_OR_SAFETY',
    'OPERATIONAL_ERROR',
    'ALREADY_HANDLED',
    'OTHER',
  ],
  BOOKING_RESCHEDULE: [
    'CUSTOMER_REQUEST',
    'TECHNICIAN_UNAVAILABLE',
    'WEATHER_OR_SAFETY',
    'OPERATIONAL_ERROR',
    'ALREADY_HANDLED',
    'OTHER',
  ],
};
const EVIDENCE_LABEL = {
  PROVIDER_STATEMENT: ['كشف المزود', 'Provider statement'],
  BANK_STATEMENT: ['كشف البنك', 'Bank statement'],
  CUSTOMER_MESSAGE: ['رسالة العميل', 'Customer message'],
  CALL_NOTE: ['ملاحظة اتصال', 'Call note'],
  MEDIA_OBJECT: ['ملف إثبات مؤمّن', 'Secured evidence file'],
  OWNER_RECORD: ['سجل الجهة المالكة', 'Owner record'],
} as const;
const kindLabel = (value: CaseKind): string => tr(...KIND[value]);
const stateLabel = (value: string): string => (STATE[value] ? tr(...STATE[value]) : value);
const canWrite = (kind: CaseKind): boolean =>
  kind.startsWith('BOOKING_')
    ? has('operations.dispatch')
    : has(kind === 'REFUND' ? 'billing.refund' : 'billing.reconcile');
const permittedKinds = (): readonly CaseKind[] => CASE_KINDS.filter(canWrite);
function send(value: Pending): Promise<Result<CaseDetailV1>> {
  if (value.kind === 'open') return openSupportCase(value.body, value.key);
  if (value.kind === 'decide') return decideSupportCase(value.caseId, value.body, value.key);
  if (value.kind === 'approve')
    return approveSupportDecision(value.caseId, value.decisionNo, value.body, value.key);
  return resendSupportDecision(value.caseId, value.decisionNo, value.key);
}

function commandForm(
  title: string,
  id: string,
  form: HTMLFormElement,
  prepare: () => Pending,
): void {
  const current = generation;
  let active = true,
    busy = false;
  const message = h('p', { class: 'field-error', role: 'alert' });
  form.append(message);
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    pending.has(id)
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('تسجيل الطلب', 'Submit request'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });
  freeze(form, pending.has(id));
  submit.addEventListener('click', () => {
    if (busy) return;
    let intent = pending.get(id);
    try {
      intent ??= prepare();
    } catch {
      invalid(message);
      return;
    }
    pending.set(id, intent);
    freeze(form, true);
    busy = true;
    submit.disabled = true;
    void send(intent).then((result) => {
      if (!active || current !== generation) return;
      busy = false;
      submit.disabled = false;
      if (!result.ok) {
        if (result.failure === 'UNAUTHENTICATED') {
          wiring.unauthenticated();
          return;
        }
        if (result.failure !== 'UNKNOWN_OUTCOME') pending.delete(id);
        message.textContent = failureMessage(result.failure);
        freeze(form, pending.has(id));
        if (result.failure === 'CONFLICT') submit.disabled = true;
        else
          submit.textContent = pending.has(id)
            ? tr('إعادة الطلب نفسه', 'Retry the same request')
            : copy().retry;
        return;
      }
      pending.delete(id);
      closeModal();
      toast(
        tr('سُجّل الطلب. راجع حالة الجهة المالكة.', 'Request recorded. Check the owner outcome.'),
      );
      void showCase(result.value.case.caseId);
    });
  });
  openModal({
    title,
    body: [form],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}
function openNew(): void {
  const saved = pending.get('open');
  if (saved?.kind === 'open') {
    commandForm(
      tr('استعادة فتح الحالة', 'Recover case opening'),
      'open',
      h(
        'form',
        { class: 'domain-form' },
        h('p', {}, kindLabel(saved.body.kind)),
        h('p', {}, saved.body.summary),
      ),
      () => saved,
    );
    return;
  }
  const kind = select(permittedKinds().map((value) => [value, ...KIND[value]] as const));
  const subject = input(),
    parent = input(),
    summary = h('textarea', { minlength: '3', maxlength: '200', rows: '3' });
  subject.dir = parent.dir = 'ltr';
  const parentLabel = label(
    'رقم الالتزام المالي الذي تنتمي إليه الدفعة',
    'Obligation reference for this payment attempt',
    parent,
  );
  const update = (): void => {
    parentLabel.hidden = CASE_KIND_SUBJECT[kind.value as CaseKind] !== 'billing.payment-attempt';
  };
  kind.addEventListener('change', update);
  update();
  const form = h(
    'form',
    { class: 'action-form domain-form' },
    label('نوع الحالة', 'Case kind', kind),
    label(
      'الرقم الكامل للحجز أو الدفعة أو الالتزام المالي',
      'Full booking, attempt or obligation reference',
      subject,
    ),
    parentLabel,
    label('وصف الحالة', 'Case summary', summary),
  );
  commandForm(tr('فتح حالة دعم', 'Open support case'), 'open', form, () => ({
    kind: 'open',
    key: idempotencyKey(),
    body: parseOpenCaseRequestV1({
      kind: kind.value,
      subject: {
        type: CASE_KIND_SUBJECT[kind.value as CaseKind],
        id: subject.value.trim(),
        ...(parentLabel.hidden ? {} : { parentId: parent.value.trim() }),
      },
      summary: summary.value.trim(),
    }),
  }));
}

function describeCurrent(current: CaseSubjectCurrentV1): Node[] {
  if (current.owner === 'booking')
    return [
      h('p', {}, `${tr('حالة الحجز', 'Booking status')}: ${current.booking.status}`),
      h('p', {}, `${tr('التأكيد', 'Confirmation')}: ${current.booking.confirmation}`),
      h(
        'p',
        {},
        `${formatInstant(current.booking.startsAt)} — ${formatInstant(current.booking.endsAt)}`,
      ),
    ];
  return [
    h('p', {}, `${tr('حالة الدفع', 'Payment status')}: ${current.obligation.financialStatus}`),
    h('p', {}, `${tr('المبلغ', 'Amount')}: ${formatMoney(current.obligation.amount)}`),
    h('p', {}, `${tr('الموثّق', 'Verified')}: ${formatMoney(current.obligation.verified)}`),
    h('p', {}, `${tr('المتبقي', 'Outstanding')}: ${formatMoney(current.obligation.outstanding)}`),
  ];
}

function decisionForm(record: CaseV1, current: CaseSubjectCurrentV1): void {
  const saved = pending.get(record.caseId);
  if (saved) {
    commandForm(
      tr('استعادة طلب الحالة', 'Recover case request'),
      record.caseId,
      h(
        'form',
        { class: 'domain-form' },
        h(
          'p',
          {},
          tr(
            'ستُعاد نفس البيانات والمفتاح دون تغيير.',
            'The identical request and key will be replayed.',
          ),
        ),
      ),
      () => saved,
    );
    return;
  }
  const available = actions[record.kind].filter(
    (action) => action !== 'REFUND' || has('billing.refund'),
  );
  const action = select(available.map((value) => [value, ...ACTION[value]] as const));
  const reason = select(reasons[record.kind].map((value) => [value, ...REASON[value]] as const));
  const note = h('textarea', { minlength: '10', maxlength: '500', rows: '3' });
  const evidenceKind = select(
    EVIDENCE_KINDS.map((value) => [value, ...EVIDENCE_LABEL[value]] as const),
  );
  const evidenceRef = input('', 'text', 120);
  evidenceRef.dir = 'ltr';
  const amount = input();
  amount.inputMode = 'decimal';
  amount.dir = 'ltr';
  const starts = input(),
    ends = input(),
    holdId = input(),
    holdRevision = input('', 'number');
  starts.placeholder = ends.placeholder = '2026-12-01T09:00:00.000Z';
  starts.dir = ends.dir = holdId.dir = 'ltr';
  holdRevision.min = '1';
  const amountLabel = label('المبلغ من سجل المزود', 'Amount from provider record', amount);
  const scheduleFields = h(
    'div',
    { class: 'detail-section' },
    label('بداية الموعد — UTC', 'Slot start — UTC', starts),
    label('نهاية الموعد — UTC', 'Slot end — UTC', ends),
    label('رقم الحجز المؤقت الصادر عن الجدولة', 'Scheduling-issued hold reference', holdId),
    label('إصدار الحجز المؤقت', 'Hold revision', holdRevision),
  );
  const credit = h('p', { role: 'status', class: 'muted' });
  let statementCredit: { creditId: string; revision: number } | null = null;
  let creditGeneration = 0;
  const ownerCurrency = current.owner === 'billing' ? current.obligation.amount : null;
  const form = h(
    'form',
    { class: 'action-form domain-form' },
    label('الإجراء', 'Action', action),
    label('سبب القرار', 'Decision reason', reason),
    label('شرح القرار — 10 أحرف على الأقل', 'Decision note — at least 10 characters', note),
    amountLabel,
    label('نوع المرجع المؤيد', 'Evidence kind', evidenceKind),
    label(
      'مرجع الإثبات — اختياري ما لم يتطلبه الإجراء',
      'Evidence reference — required for financial decisions',
      evidenceRef,
    ),
    scheduleFields,
    credit,
    h(
      'p',
      { class: 'muted' },
      tr(
        'الموافقة على الاسترداد لا تعني إتمامه. يلزم مراجع ثانٍ وتأكيد من الجهة المالية.',
        'A refund decision requires a second reviewer and a verified owner outcome.',
      ),
    ),
  );
  const update = (): void => {
    const selectedReason = reason.value;
    const availableReasons: readonly CaseReasonCode[] =
      action.value === 'REFUND'
        ? [
            'BOOKING_CANCELLED',
            'SERVICE_NOT_DELIVERED',
            'DUPLICATE_PAYMENT',
            'SERVICE_QUALITY',
            'PRICE_CORRECTION',
          ]
        : reasons[record.kind];
    replace(
      reason,
      ...availableReasons.map((value) => h('option', { value }, tr(...REASON[value]))),
    );
    if (availableReasons.includes(selectedReason as CaseReasonCode)) reason.value = selectedReason;
    const needsAmount = [
      'APPROVE_MATCH',
      'REJECT_MISMATCH',
      'ACCEPT_LATE_PAYMENT',
      'REFUND',
    ].includes(action.value);
    amountLabel.hidden = !needsAmount;
    scheduleFields.hidden = action.value !== 'RESCHEDULE_BOOKING';
    statementCredit = null;
    const sequence = ++creditGeneration;
    const needsCredit = ['APPROVE_MATCH', 'ACCEPT_LATE_PAYMENT'].includes(action.value);
    if (!needsCredit) {
      credit.textContent = '';
      return;
    }
    credit.textContent = tr(
      'جارٍ قراءة مطابقة سجل المزود…',
      'Reading the provider statement candidate…',
    );
    const opened = generation;
    void readStatementCredit(record.subject.id).then((result) => {
      if (opened !== generation || sequence !== creditGeneration || !form.isConnected) return;
      if (!result.ok) {
        credit.textContent = failureMessage(result.failure);
        return;
      }
      if (
        current.owner !== 'billing' ||
        result.value.obligationId !== current.obligation.obligationId ||
        result.value.amount.currency !== current.obligation.amount.currency ||
        result.value.amount.scale !== current.obligation.amount.scale
      ) {
        credit.textContent = copy().malformed;
        return;
      }
      statementCredit = { creditId: result.value.creditId, revision: result.value.creditRevision };
      credit.textContent = `${tr('مرجع المزود', 'Provider reference')}: ${result.value.reference} · ${formatMoney(result.value.amount)}`;
    });
  };
  action.addEventListener('change', update);
  commandForm(tr('تسجيل قرار الحالة', 'Record case decision'), record.caseId, form, () => {
    const financial = !amountLabel.hidden;
    const parsedAmount =
      financial && ownerCurrency
        ? parseAmount(amount.value, ownerCurrency.currency, ownerCurrency.scale)
        : null;
    if (financial && !parsedAmount?.ok) throw new Error('amount');
    const needsCredit = ['APPROVE_MATCH', 'ACCEPT_LATE_PAYMENT'].includes(action.value);
    if (needsCredit && !statementCredit) throw new Error('credit');
    return {
      kind: 'decide',
      caseId: record.caseId,
      key: idempotencyKey(),
      body: parseDecideCaseRequestV1({
        action: action.value,
        reason: { code: reason.value, note: note.value.trim() },
        ...(evidenceRef.value.trim()
          ? { evidence: [{ kind: evidenceKind.value, reference: evidenceRef.value.trim() }] }
          : {}),
        ...(parsedAmount?.ok ? { amount: parsedAmount.value } : {}),
        ...(needsCredit ? { statementCredit } : {}),
        ...(scheduleFields.hidden
          ? {}
          : {
              window: { startsAt: starts.value.trim(), endsAt: ends.value.trim() },
              bookingHold: { holdId: holdId.value.trim(), revision: Number(holdRevision.value) },
            }),
      }),
    };
  });
  update();
}

async function showCase(caseId: string): Promise<void> {
  const currentGeneration = generation;
  const request = ++detailRequest;
  let active = true;
  openModal({
    title: tr('تحميل الحالة', 'Loading case'),
    body: [h('p', { role: 'status' }, copy().loading)],
    foot: [],
    onClose: () => {
      active = false;
    },
  });
  const result = await supportCase(caseId);
  if (!active || currentGeneration !== generation || request !== detailRequest) return;
  if (!result.ok) {
    closeModal();
    if (result.failure === 'UNAUTHENTICATED') wiring.unauthenticated();
    else toast(failureMessage(result.failure));
    return;
  }
  const detail = result.value,
    record = detail.case;
  const current = await supportCaseCurrent(record);
  if (!active || currentGeneration !== generation || request !== detailRequest) return;
  if (!current.ok && current.failure === 'UNAUTHENTICATED') {
    wiring.unauthenticated();
    return;
  }
  const body = h(
    'div',
    { class: 'domain-form domain-details' },
    h('p', {}, record.summary),
    h('p', {}, `${kindLabel(record.kind)} · ${stateLabel(record.status)}`),
    h('p', {}, `${tr('المرجع', 'Reference')}: ${record.subject.id}`),
    h('p', {}, `${tr('فُتحت', 'Opened')}: ${formatInstant(record.openedAt)}`),
  );
  if (current.ok)
    append(
      body,
      h(
        'section',
        { class: 'detail-section' },
        h('h3', {}, tr('القراءة الحالية من الجهة المالكة', 'Current owner read')),
        ...describeCurrent(current.value.current),
        h('p', { class: 'muted' }, formatInstant(current.value.current.readAt)),
      ),
    );
  else
    append(
      body,
      h(
        'p',
        { role: 'alert' },
        `${tr('تعذرت قراءة الحالة الحالية', 'Current owner read unavailable')}: ${failureMessage(current.failure)}`,
      ),
    );
  for (const decision of detail.decisions)
    append(
      body,
      h(
        'section',
        { class: 'detail-section' },
        h('h3', {}, `${decision.decisionNo}. ${tr(...ACTION[decision.action])}`),
        h('p', {}, stateLabel(decision.status)),
        h('p', {}, decision.reason.note),
        decision.amount ? h('p', {}, formatMoney(decision.amount)) : null,
        decision.owner
          ? h(
              'p',
              { class: 'muted' },
              `${tr('نتيجة الجهة المالكة', 'Owner outcome')}: ${decision.owner.state ?? decision.owner.code ?? tr('غير محسومة', 'Unknown')}`,
            )
          : null,
      ),
    );
  const buttons: HTMLButtonElement[] = [];
  const refresh = h(
    'button',
    { class: 'ghost', type: 'button' },
    tr('تحديث الحالة', 'Refresh case'),
  );
  refresh.addEventListener('click', () => void showCase(caseId));
  buttons.push(refresh);
  if (
    canWrite(record.kind) &&
    (pending.has(caseId) ||
      ['OPEN', 'OWNER_REJECTED', 'BLOCKED_ON_OWNER'].includes(record.status)) &&
    current.ok
  ) {
    const decide = h(
      'button',
      { class: 'primary', type: 'button' },
      pending.has(caseId)
        ? tr('متابعة الطلب غير المحسوم', 'Resolve uncertain request')
        : tr('تسجيل قرار', 'Record decision'),
    );
    decide.addEventListener('click', () => void decisionForm(record, current.value.current));
    buttons.push(decide);
  }
  const last = detail.decisions.at(-1);
  if (
    last?.status === 'AWAITING_APPROVAL' &&
    has('billing.refund') &&
    last.decidedBy !== wiring.subject()
  ) {
    const approve = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('المراجعة الثانية', 'Second review'),
    );
    approve.addEventListener('click', () => {
      const answer = select([
        ['yes', 'اعتماد الطلب', 'Approve request'],
        ['no', 'رفض الطلب', 'Reject request'],
      ]);
      const note = h('textarea', { minlength: '10', maxlength: '500', rows: '3' });
      commandForm(
        tr('مراجعة مستقلة لطلب الاسترداد', 'Independent refund review'),
        caseId,
        h(
          'form',
          { class: 'domain-form action-form' },
          last.amount ? h('p', {}, formatMoney(last.amount)) : null,
          h('p', {}, last.reason.note),
          label('القرار', 'Decision', answer),
          label('شرح المراجعة', 'Review note', note),
        ),
        () => ({
          kind: 'approve',
          caseId,
          decisionNo: last.decisionNo,
          key: idempotencyKey(),
          body: parseApproveDecisionRequestV1({
            approve: answer.value === 'yes',
            note: note.value.trim(),
          }),
        }),
      );
    });
    buttons.push(approve);
  }
  if (
    last &&
    canWrite(record.kind) &&
    ['OUTCOME_UNKNOWN', 'BLOCKED_ON_OWNER', 'EXECUTING'].includes(record.status)
  ) {
    const resend = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('إعادة تنفيذ القرار نفسه', 'Retry the same owner command'),
    );
    resend.addEventListener('click', () =>
      commandForm(
        tr('متابعة تنفيذ القرار', 'Continue owner execution'),
        caseId,
        h(
          'form',
          { class: 'domain-form' },
          h(
            'p',
            {},
            tr(
              'سيستخدم الدعم الأمر المحفوظ ومفتاحه الأصلي. لا يُنشأ قرار جديد.',
              'Support will resend the stored owner command with its original key.',
            ),
          ),
        ),
        () => ({ kind: 'resend', caseId, decisionNo: last.decisionNo, key: idempotencyKey() }),
      ),
    );
    buttons.push(resend);
  }
  openModal({ title: `${tr('الحالة', 'Case')} ${shortRef(caseId)}`, body: [body], foot: buttons });
}

export async function showSupportCases(): Promise<void> {
  const current = ++generation;
  const view = frame(
    'disputes',
    tr('الدعم والنزاعات', 'Support & disputes'),
    tr(
      'حالات الاستثناء وقرارات المراجعة ونتائج الجهات المالكة.',
      'Exception cases, review decisions and owner outcomes.',
    ),
  );
  const kind = select([
    ['', 'كل الأنواع', 'All kinds'],
    ...CASE_KINDS.map((value) => [value, ...KIND[value]] as const),
  ]);
  const state = select([
    ['', 'كل الحالات', 'All states'],
    ...CASE_STATUSES.map((value) => [value, ...STATE[value]!] as const),
  ]);
  kind.setAttribute('aria-label', tr('نوع الحالة', 'Case kind'));
  state.setAttribute('aria-label', tr('الحالة', 'Status'));
  const search = input();
  search.placeholder = tr('رقم الحالة الكامل', 'Full case reference');
  search.dir = 'ltr';
  search.setAttribute('aria-label', search.placeholder);
  const open = h('button', { type: 'submit', class: 'ghost' }, tr('فتح الحالة', 'Open case'));
  const lookup = h('form', { class: 'toolbar' }, search, open),
    lookupError = h('p', { role: 'status' });
  lookup.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!UUID.test(search.value.trim())) {
      invalid(lookupError);
      return;
    }
    lookupError.textContent = '';
    void showCase(search.value.trim());
  });
  const filters = h('div', { class: 'toolbar' }, kind, state);
  view.content.before(filters, lookup, lookupError);
  if (permittedKinds().length || pending.has('open')) {
    const create = h(
      'button',
      { type: 'button', class: 'primary' },
      pending.has('open')
        ? tr('متابعة فتح الحالة', 'Recover case opening')
        : tr('+ حالة جديدة', '+ New case'),
    );
    create.addEventListener('click', openNew);
    view.actions.append(create);
  }
  let query = 0;
  const load = async (cursor?: string): Promise<void> => {
    const sequence = ++query;
    const data = table([
      tr('الحالة', 'Case'),
      tr('النوع', 'Kind'),
      tr('النتيجة', 'Outcome'),
      tr('آخر تحديث', 'Updated'),
      tr('الإجراء', 'Action'),
    ]);
    if (!cursor) status(view.content, copy().loading);
    replace(view.more);
    const result = await supportCases({
      ...(kind.value ? { kind: kind.value } : {}),
      ...(state.value ? { status: state.value } : {}),
      ...(cursor ? { cursor } : {}),
    });
    if (current !== generation || sequence !== query) return;
    if (
      readFailure(cursor ? view.more : view.content, result, wiring.unauthenticated) ||
      !result.ok
    )
      return;
    for (const item of result.value.items) {
      const details = h('button', { type: 'button', class: 'ghost' }, tr('تفاصيل', 'Details'));
      details.addEventListener('click', () => void showCase(item.caseId));
      append(
        data.rows,
        h(
          'tr',
          {},
          h('td', { title: item.caseId }, shortRef(item.caseId)),
          h('td', {}, kindLabel(item.kind)),
          h('td', {}, stateLabel(item.status)),
          h('td', {}, formatInstant(item.updatedAt)),
          h('td', {}, details),
        ),
      );
    }
    if (cursor) view.content.append(data.table);
    else replace(view.content, data.table);
    if (!result.value.items.length && !cursor)
      status(view.content, tr('لا توجد حالات تطابق البحث.', 'No cases match these filters.'));
    if (result.value.nextCursor) {
      const next = result.value.nextCursor,
        more = h('button', { class: 'ghost', type: 'button' }, copy().loadMore);
      more.addEventListener('click', () => {
        more.disabled = true;
        void load(next);
      });
      view.more.append(more);
    }
  };
  kind.addEventListener('change', () => void load());
  state.addEventListener('change', () => void load());
  view.refresh.addEventListener('click', () => void load());
  await load();
}
