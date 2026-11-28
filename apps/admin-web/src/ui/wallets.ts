import {
  parseReceiveHandoverRequestV1,
  parseReconcileHandoverRequestV1,
  type HandoverV1,
  type ReceiveHandoverRequestV1,
  type ReconcileHandoverRequestV1,
} from '@carwash/contracts/billing-v1';
import {
  custodyReconciliation,
  holderCustody,
  handover,
  receiveHandover,
  reconcileHandover,
} from '../api/custody';
import { UUID, idempotencyKey } from '../api/http';
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
  status,
  table,
  tr,
} from './domain-screen';

interface Wiring {
  readonly unauthenticated: () => void;
  readonly permissions: () => readonly string[];
}
let wiring: Wiring = { unauthenticated: () => undefined, permissions: () => [] };
let generation = 0,
  detailRequest = 0;
type Pending = { readonly record: HandoverV1; readonly key: string } & (
  | { readonly kind: 'receive'; readonly body: ReceiveHandoverRequestV1 }
  | { readonly kind: 'reconcile'; readonly body: ReconcileHandoverRequestV1 }
);
const pending = new Map<string, Pending>();
const has = (permission: string): boolean => wiring.permissions().includes(permission);
export function wireWalletScreens(value: Wiring): void {
  wiring = value;
  ensureScreen('wallets');
}
export function invalidateWalletScreens(clearPrivate = false): void {
  generation++;
  if (clearPrivate) {
    pending.clear();
    document.getElementById('wallets')?.replaceChildren();
  }
}
const state = (value: HandoverV1['status']): string =>
  ({
    PENDING: tr('بانتظار تسليم العهدة', 'Awaiting cash handover'),
    RECEIVED: tr(
      'استلمتها الخزينة — بانتظار التسوية',
      'Received by treasury — awaiting reconciliation',
    ),
    RECONCILED: tr('تمت التسوية', 'Reconciled'),
    CANCELLED: tr('ملغاة', 'Cancelled'),
  })[value];

function command(record: HandoverV1, kind: 'receive' | 'reconcile'): void {
  const current = generation;
  let active = true,
    busy = false;
  const stored = pending.get(record.handoverId);
  const amount = input();
  amount.inputMode = 'decimal';
  amount.dir = 'ltr';
  const reference = input('', 'text', 64);
  reference.dir = 'ltr';
  if (stored) {
    reference.value =
      stored.kind === 'receive' ? stored.body.treasuryReference : stored.body.settlementReference;
    if (stored.kind === 'receive') {
      const money = stored.body.countedAmount;
      const digits = money.amountMinor.padStart(money.scale + 1, '0');
      amount.value = money.scale
        ? `${digits.slice(0, -money.scale)}.${digits.slice(-money.scale)}`
        : digits;
    }
  }
  const form = h(
    'form',
    { class: 'domain-form action-form' },
    h('p', {}, `${tr('المعلن', 'Declared')}: ${formatMoney(record.declared)}`),
    kind === 'receive' ? label('المبلغ المعدود فعليًا', 'Amount physically counted', amount) : null,
    label(
      kind === 'receive' ? 'مرجع إيصال الخزينة' : 'مرجع التسوية',
      kind === 'receive' ? 'Treasury receipt reference' : 'Settlement reference',
      reference,
    ),
    h(
      'p',
      { class: 'muted' },
      tr(
        'سيسجل النظام المبلغ والفرق واسم الموظف. لا يُعد استلام الخزينة تسوية نهائية.',
        'The owner records the amount, discrepancy and staff member. Treasury receipt and reconciliation are separate.',
      ),
    ),
  );
  const message = h('p', { class: 'field-error', role: 'alert' });
  form.append(message);
  const submit = h(
    'button',
    { type: 'button', class: 'primary' },
    stored
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('تأكيد التسجيل', 'Confirm record'),
  );
  freeze(form, Boolean(stored));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });
  submit.addEventListener('click', () => {
    if (busy || !has(kind === 'receive' ? 'billing.treasury.receive' : 'billing.reconcile')) return;
    let intent = pending.get(record.handoverId);
    try {
      if (!intent && kind === 'receive') {
        const counted = parseAmount(amount.value, record.declared.currency, record.declared.scale);
        if (!counted.ok) throw new Error('amount');
        intent = {
          kind,
          record,
          key: idempotencyKey(),
          body: parseReceiveHandoverRequestV1({
            expectedRevision: record.revision,
            countedAmount: counted.value,
            treasuryReference: reference.value.trim(),
          }),
        };
      } else if (!intent)
        intent = {
          kind: 'reconcile',
          record,
          key: idempotencyKey(),
          body: parseReconcileHandoverRequestV1({
            expectedRevision: record.revision,
            settlementReference: reference.value.trim(),
          }),
        };
    } catch {
      invalid(message);
      return;
    }
    pending.set(record.handoverId, intent);
    freeze(form, true);
    submit.disabled = busy = true;
    const result =
      intent.kind === 'receive'
        ? receiveHandover(intent.record, intent.body, intent.key)
        : reconcileHandover(intent.record, intent.body, intent.key);
    void result.then((value) => {
      if (!active || current !== generation) return;
      submit.disabled = busy = false;
      if (!value.ok) {
        if (value.failure === 'UNAUTHENTICATED') {
          wiring.unauthenticated();
          return;
        }
        if (value.failure !== 'UNKNOWN_OUTCOME') pending.delete(record.handoverId);
        message.textContent = failureMessage(value.failure);
        freeze(form, pending.has(record.handoverId));
        if (value.failure === 'CONFLICT') submit.disabled = true;
        else
          submit.textContent = pending.has(record.handoverId)
            ? tr('إعادة الطلب نفسه', 'Retry the same request')
            : copy().retry;
        return;
      }
      pending.delete(record.handoverId);
      closeModal();
      toast(state(value.value.status));
      void showHandover(record.handoverId);
    });
  });
  openModal({
    title:
      kind === 'receive'
        ? tr('استلام العهدة في الخزينة', 'Receive custody in treasury')
        : tr('تسوية العهدة', 'Reconcile custody'),
    body: [form],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}

async function showHandover(id: string): Promise<void> {
  const current = generation,
    request = ++detailRequest;
  let active = true;
  openModal({
    title: tr('تحميل التسليم', 'Loading handover'),
    body: [h('p', { role: 'status' }, copy().loading)],
    foot: [],
    onClose: () => {
      active = false;
    },
  });
  const result = await handover(id);
  if (!active || current !== generation || request !== detailRequest) return;
  if (!result.ok) {
    closeModal();
    if (result.failure === 'UNAUTHENTICATED') wiring.unauthenticated();
    else toast(failureMessage(result.failure));
    return;
  }
  const record = result.value;
  const details = h(
    'dl',
    { class: 'detail-list' },
    h('dt', {}, tr('الحالة', 'State')),
    h('dd', {}, state(record.status)),
    h('dt', {}, tr('صاحب العهدة', 'Custody holder')),
    h('dd', {}, shortRef(record.holder)),
    h('dt', {}, tr('عدد الإيصالات', 'Receipt count')),
    h('dd', {}, String(record.receiptCount)),
    h('dt', {}, tr('المبلغ المعلن', 'Declared')),
    h('dd', {}, formatMoney(record.declared)),
  );
  for (const [ar, en, value] of [
    ['المعدود', 'Counted', record.counted],
    ['النقص', 'Shortage', record.shortage],
    ['الزيادة', 'Overage', record.overage],
  ] as const)
    if (value) append(details, h('dt', {}, tr(ar, en)), h('dd', {}, formatMoney(value)));
  if (record.receivedAt)
    append(
      details,
      h('dt', {}, tr('استلام الخزينة', 'Treasury receipt')),
      h('dd', {}, formatInstant(record.receivedAt)),
    );
  if (record.reconciledAt)
    append(
      details,
      h('dt', {}, tr('التسوية', 'Reconciliation')),
      h('dd', {}, formatInstant(record.reconciledAt)),
    );
  const refresh = h('button', { class: 'ghost', type: 'button' }, tr('تحديث', 'Refresh'));
  refresh.addEventListener('click', () => void showHandover(id));
  const buttons = [refresh];
  const saved = pending.get(id);
  if (saved) {
    const retry = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('متابعة التسجيل غير المحسوم', 'Resolve uncertain record'),
    );
    retry.addEventListener('click', () => command(saved.record, saved.kind));
    buttons.push(retry);
  } else if (record.status === 'PENDING' && has('billing.treasury.receive')) {
    const receive = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('تسجيل استلام الخزينة', 'Record treasury receipt'),
    );
    receive.addEventListener('click', () => command(record, 'receive'));
    buttons.push(receive);
  } else if (record.status === 'RECEIVED' && has('billing.reconcile')) {
    const reconcile = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('تسجيل التسوية', 'Record reconciliation'),
    );
    reconcile.addEventListener('click', () => command(record, 'reconcile'));
    buttons.push(reconcile);
  }
  openModal({
    title: `${tr('تسليم العهدة', 'Custody handover')} ${shortRef(id)}`,
    body: [
      h(
        'div',
        { class: 'domain-form domain-details' },
        details,
        h(
          'details',
          {},
          h('summary', {}, tr('الإيصالات المشمولة', 'Included receipts')),
          ...record.receiptIds.map((receipt) => h('p', {}, receipt)),
        ),
      ),
    ],
    foot: buttons,
  });
}

export async function showWallets(): Promise<void> {
  const current = ++generation;
  const view = frame(
    'wallets',
    tr('المحافظ والعهدة', 'Wallets & custody'),
    tr(
      'النقد المحصّل وتسليم الخزينة والتسوية كما سجلتها الجهة المالية.',
      'Cash custody, treasury receipt and reconciliation reported by Billing.',
    ),
  );
  view.refresh.addEventListener('click', () => void showWallets());
  status(view.content, copy().loading);
  const holder = input(),
    handoverRef = input();
  holder.dir = handoverRef.dir = 'ltr';
  holder.placeholder = tr('هوية صاحب العهدة', 'Custody holder identity');
  holder.setAttribute('aria-label', holder.placeholder);
  handoverRef.placeholder = tr('رقم تسليم العهدة', 'Handover reference');
  handoverRef.setAttribute('aria-label', handoverRef.placeholder);
  const lookup = h('button', { class: 'ghost', type: 'submit' }, tr('عرض العهدة', 'Read custody'));
  const holderResult = h('div', { 'aria-live': 'polite' });
  const holderForm = h('form', { class: 'toolbar' }, holder, lookup);
  let holderRead = 0;
  holderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!UUID.test(holder.value.trim())) {
      status(holderResult, copy().invalid);
      return;
    }
    const sequence = ++holderRead;
    lookup.disabled = true;
    status(holderResult, copy().loading);
    void holderCustody(holder.value.trim()).then((result) => {
      if (current !== generation || sequence !== holderRead) return;
      lookup.disabled = false;
      if (readFailure(holderResult, result, wiring.unauthenticated) || !result.ok) return;
      const data = table([
        tr('العملة', 'Currency'),
        tr('العهدة الدفترية', 'Ledger custody'),
        tr('بحوزة الفني', 'Held'),
        tr('قيد التسليم', 'In handover'),
        tr('النقص القائم', 'Shortage'),
      ]);
      for (const balance of result.value.balances)
        append(
          data.rows,
          h(
            'tr',
            {},
            h('td', {}, balance.currency),
            h('td', {}, formatMoney(balance.ledgerCustody)),
            h('td', {}, formatMoney(balance.held)),
            h('td', {}, formatMoney(balance.inHandover)),
            h('td', {}, formatMoney(balance.shortageOutstanding)),
          ),
        );
      replace(holderResult, data.table);
      if (!result.value.balances.length)
        status(
          holderResult,
          tr('لا توجد عهدة مسجلة لهذه الهوية.', 'No custody is recorded for this holder.'),
        );
    });
  });
  const handoverForm = h(
    'form',
    { class: 'toolbar' },
    handoverRef,
    h('button', { class: 'ghost', type: 'submit' }, tr('فتح التسليم', 'Open handover')),
  );
  const lookupError = h('p', { role: 'status' });
  handoverForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!UUID.test(handoverRef.value.trim())) {
      invalid(lookupError);
      return;
    }
    lookupError.textContent = '';
    void showHandover(handoverRef.value.trim());
  });
  const report = await custodyReconciliation();
  if (current !== generation) return;
  if (readFailure(view.content, report, wiring.unauthenticated) || !report.ok) return;
  const value = report.value;
  const grid = h(
    'div',
    { class: 'grid section-grid' },
    h(
      'div',
      { class: 'card simple' },
      h('h3', {}, String(value.handoversPending)),
      h('p', {}, tr('بانتظار التسليم', 'Awaiting handover')),
    ),
    h(
      'div',
      { class: 'card simple' },
      h('h3', {}, String(value.handoversAwaitingReconciliation)),
      h('p', {}, tr('بانتظار التسوية', 'Awaiting reconciliation')),
    ),
    h(
      'div',
      { class: 'card simple' },
      h('h3', {}, String(value.handoversWithDiscrepancy)),
      h('p', {}, tr('تسليمات بفروقات', 'Handovers with discrepancies')),
    ),
  );
  const treasury = table([
    tr('العملة', 'Currency'),
    tr('غير مسوّى', 'Unreconciled'),
    tr('تمت تسويته', 'Reconciled'),
    tr('نقص قائم', 'Shortage'),
    tr('زيادة معلقة', 'Overage suspense'),
  ]);
  for (const amount of value.treasury)
    append(
      treasury.rows,
      h(
        'tr',
        {},
        h('td', {}, amount.currency),
        h('td', {}, formatMoney(amount.unreconciled)),
        h('td', {}, formatMoney(amount.reconciled)),
        h('td', {}, formatMoney(amount.shortageOutstanding)),
        h('td', {}, formatMoney(amount.overageSuspense)),
      ),
    );
  replace(
    view.content,
    grid,
    h(
      'p',
      { role: 'status' },
      value.consistent
        ? tr('السجلات متطابقة وفق آخر فحص.', 'Ledger and receipts matched at the latest check.')
        : tr('توجد فروقات تستدعي مراجعة مالية.', 'Discrepancies need financial review.'),
    ),
    h(
      'p',
      { class: 'muted' },
      `${formatInstant(value.evaluatedAt)} · ${value.holdersChecked} ${tr('أصحاب عهدة فُحصوا', 'holders checked')}`,
    ),
    treasury.table,
    h(
      'section',
      { class: 'card panel lookup-panel' },
      h('h2', {}, tr('تتبّع عهدة موظف', 'Inspect holder custody')),
      holderForm,
      holderResult,
    ),
    h(
      'section',
      { class: 'card panel lookup-panel' },
      h('h2', {}, tr('استلام وتسوية تسليم', 'Receive and reconcile a handover')),
      handoverForm,
      lookupError,
    ),
  );
  if (!value.consistent)
    append(
      view.content,
      h(
        'section',
        { class: 'card panel lookup-panel' },
        h(
          'p',
          {},
          `${tr('إيصالات دون التزام مسدد', 'Receipts without settled obligation')}: ${value.receiptsWithoutSettledObligation}`,
        ),
        h(
          'p',
          {},
          `${tr('تسديدات نقدية دون إيصال', 'Cash settlements without receipt')}: ${value.cashSettlementsWithoutReceipt}`,
        ),
        ...value.holderMismatches.map((item) =>
          h(
            'p',
            {},
            `${shortRef(item.holder)} · ${item.currency} · ${tr('الدفتر بوحدات العملة الصغرى', 'Ledger minor units')}: ${item.ledgerCustodyMinor} · ${tr('الإيصالات', 'Receipts')}: ${item.receiptsInCustodyMinor}`,
          ),
        ),
      ),
    );
}
