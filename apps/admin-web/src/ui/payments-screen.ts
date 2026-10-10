import { listCases } from '../api/cases';
import { readObligation, type Attempt, type Obligation } from '../api/finance';
import { cashKpis, type CashKpis, type CashState } from '../api/kpis';
import { isUuid } from '../domain/bookings';
import { ACTIVE_STATUSES } from '../domain/cases';
import { isOpenAttempt, formatMoney, type MoneyWire } from '../domain/finance';
import { startCase } from './case-detail';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal } from './shell';
import { failureMessage, formatInstant, freshnessStrip } from './states';

/**
 * The approved "المدفوعات" screen. Cards and the state table come from
 * Reporting's derived cash-state KPIs (with freshness); an obligation and its
 * attempts are read from Billing, the owner. Every finance decision on a
 * payment (match, mismatch, unknown, late payment, refund) is taken in a
 * Support case with a reason and evidence and carried out by Billing (P04-D).
 * Nothing here marks money as received: only Billing's answer is shown.
 */
export interface PaymentsHooks {
  readonly unauthenticated: () => void;
  readonly canOpenCases: () => boolean;
  readonly canReadCases: () => boolean;
}

let hooks: PaymentsHooks = {
  unauthenticated: () => undefined,
  canOpenCases: () => false,
  canReadCases: () => false,
};
let generation = 0;

export function wirePayments(next: PaymentsHooks): void {
  hooks = next;
  const form = byId<HTMLFormElement>('obligationLookup');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = byId<HTMLInputElement>('obligationRef').value.trim().toLowerCase();
    if (!isUuid(value)) {
      replace(byId('obligationProblem'), copy().obligationHint);
      return;
    }
    replace(byId('obligationProblem'));
    void openObligation(value);
  });
}

const TONE: Readonly<Record<CashState, string>> = {
  UNPAID: 's-amber',
  AWAITING_CASH: 's-amber',
  AWAITING_PAYMENT: 's-amber',
  UNDER_REVIEW: 's-blue',
  OUTCOME_UNKNOWN: 's-red',
  PAID: 's-green',
  VOIDED: 's-red',
};

function totals(list: readonly MoneyWire[]): string {
  return list.length === 0 ? copy().unavailableCell : list.map(formatMoney).join(' · ');
}

function card(id: string, value: string, label: string): HTMLElement {
  return h('div', { class: 'card simple', id }, h('h3', {}, value), h('p', {}, label));
}

function render(k: CashKpis): void {
  const c = copy();
  const by = (s: CashState) => k.states.find((row) => row.cashState === s);
  const review = ['UNDER_REVIEW', 'OUTCOME_UNKNOWN'] as const;
  const reviewCount = review.reduce((n, s) => n + (by(s)?.count ?? 0), 0);
  replace(
    byId('paymentCards'),
    card('cardAwaitingCash', String(by('AWAITING_CASH')?.count ?? 0), c.cardAwaitingCash),
    card('cardReview', String(reviewCount), c.cardAwaitingReconciliation),
    card('cardRefunds', c.unavailableCell, c.cardRefundRequests),
  );
  void fillRefundCard();
  replace(
    byId('paymentRows'),
    ...k.states.map((row) =>
      h(
        'tr',
        { 'data-cash-state': row.cashState },
        h(
          'td',
          {},
          h('span', { class: `status ${TONE[row.cashState]}` }, c.cashStates[row.cashState]),
        ),
        h('td', {}, String(row.count)),
        h('td', {}, totals(row.outstanding)),
        h('td', {}, row.oldestSince ? formatInstant(row.oldestSince) : c.unavailableCell),
      ),
    ),
  );
  const strip = byId('paymentFreshness');
  replace(strip, ...freshnessStrip(k.freshness));
  if (k.incompleteSources.length > 0)
    append(strip, h('span', { class: 'status s-amber', 'data-partial': 'true' }, c.partialKpi));
}

/** "طلبات استرداد": open refund cases in Support (the reference's own third card). */
async function fillRefundCard(): Promise<void> {
  if (!hooks.canReadCases()) return;
  const result = await listCases({ kind: ['REFUND'], status: ACTIVE_STATUSES, limit: 100 });
  const value = document.querySelector('#cardRefunds h3');
  if (!value || !result.ok) return;
  const n = result.value.items.length;
  value.textContent = result.value.nextCursor ? `${n}+` : String(n);
}

export async function showPayments(): Promise<void> {
  const run = ++generation;
  const c = copy();
  const section = byId('payments');
  section.setAttribute('aria-busy', 'true');
  replace(
    byId('paymentRows'),
    h('tr', {}, h('td', { colspan: '4', class: 'state-cell' }, c.loading)),
  );
  const result = await cashKpis();
  if (run !== generation) return;
  section.setAttribute('aria-busy', 'false');
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    replace(byId('paymentCards'));
    replace(
      byId('paymentRows'),
      h(
        'tr',
        {},
        h(
          'td',
          { colspan: '4', class: 'state-cell', 'data-state': result.failure },
          failureMessage(result.failure),
        ),
      ),
    );
    return;
  }
  render(result.value);
  byId('reconcileToday').title = hooks.canOpenCases() ? '' : c.reconcileNotPermitted;
}

/* ------------------------------- obligation ------------------------------- */

function attemptRow(o: Obligation, a: Attempt): HTMLElement {
  const c = copy();
  const cells = h(
    'tr',
    { 'data-attempt': a.attemptId, 'data-attempt-status': a.status },
    h('td', {}, a.reference),
    h('td', {}, c.methods[a.method as keyof typeof c.methods] ?? a.method),
    h('td', {}, formatMoney(a.claimed)),
    h('td', {}, a.status),
    h('td', {}, formatInstant(a.submittedAt)),
  );
  const action = h('td', {});
  if (!hooks.canOpenCases()) append(action, h('span', { class: 'muted' }, c.reconcileNotPermitted));
  else {
    // An attempt still under review gets a review case; any other attempt
    // (mismatched, or paid after the obligation closed) a late-payment case.
    const review = isOpenAttempt(a.status);
    const button = h(
      'button',
      { class: 'primary', type: 'button', id: `${review ? 'review' : 'late'}-${a.attemptId}` },
      review ? c.openReviewCase : c.openLatePayment,
    );
    button.addEventListener('click', () =>
      startCase(review ? 'PAYMENT_REVIEW' : 'LATE_PAYMENT', {
        type: 'billing.payment-attempt',
        id: a.attemptId,
        parentId: o.obligationId,
      }),
    );
    append(action, button);
  }
  append(cells, action);
  return cells;
}

function obligationBody(o: Obligation): Node[] {
  const c = copy();
  return [
    h(
      'dl',
      { class: 'detail-list', 'data-financial-status': o.financialStatus },
      h('dt', {}, c.financialStatus),
      h(
        'dd',
        {},
        c.financialStatuses[o.financialStatus as keyof typeof c.financialStatuses] ??
          o.financialStatus,
      ),
      h('dt', {}, c.amountDue),
      h('dd', {}, formatMoney(o.amount)),
      h('dt', {}, c.verified),
      h('dd', {}, formatMoney(o.verified)),
      h('dt', {}, c.outstanding),
      h('dd', {}, formatMoney(o.outstanding)),
      h('dt', {}, c.revision),
      h('dd', {}, String(o.revision)),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...[c.reference, c.paymentMethod, c.claimed, c.attemptStatus, c.submittedAt, ''].map(
              (t) => h('th', { scope: 'col' }, t),
            ),
          ),
        ),
        h('tbody', {}, ...o.attempts.map((a) => attemptRow(o, a))),
      ),
    ),
    h('p', { class: 'muted' }, c.billingDecides),
    ...(hooks.canOpenCases() && o.verified.amountMinor !== '0' ? [refundButton(o)] : []),
  ];
}

function refundButton(o: Obligation): HTMLElement {
  const button = h(
    'button',
    { class: 'ghost', type: 'button', id: `refund-${o.obligationId}` },
    copy().requestRefund,
  );
  button.addEventListener('click', () =>
    startCase('REFUND', { type: 'billing.obligation', id: o.obligationId, parentId: null }),
  );
  return button;
}

export async function openObligation(obligationId: string): Promise<void> {
  const c = copy();
  const close = h('button', { class: 'ghost', type: 'button' }, c.close);
  close.addEventListener('click', closeModal);
  openModal({
    title: c.obligationTitle,
    body: [h('p', { 'aria-busy': 'true' }, c.loading)],
    foot: [close],
  });
  const result = await readObligation(obligationId);
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    replace(
      byId('modalBody'),
      h('p', { 'data-state': result.failure }, failureMessage(result.failure)),
    );
    return;
  }
  replace(byId('modalBody'), ...obligationBody(result.value));
}

/** "مطابقة اليوم": opens the obligation lookup, the only discovery path until Billing lists attempts (CR-D-P03-04). */
export function focusLookup(): void {
  byId<HTMLInputElement>('obligationRef').focus();
}
