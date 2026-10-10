import { newCommandKey } from '../api/live';
import { readObligation, reconcileAttempt, type Attempt, type Obligation } from '../api/finance';
import { cashKpis, type CashKpis, type CashState } from '../api/kpis';
import { isUuid } from '../domain/bookings';
import {
  RECONCILIATION_OUTCOMES,
  isOpenAttempt,
  validateReconciliation,
  formatMoney,
  type MoneyWire,
} from '../domain/finance';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant, freshnessStrip } from './states';

/**
 * The approved "المدفوعات" screen. Cards and the state table come from
 * Reporting's derived cash-state KPIs (with freshness); an obligation and its
 * attempts are read from Billing, the owner, and finance records
 * reconciliation through Billing. Nothing here marks money as received:
 * only Billing's answer is shown.
 */
export interface PaymentsHooks {
  readonly unauthenticated: () => void;
  readonly canReconcile: () => boolean;
}

let hooks: PaymentsHooks = { unauthenticated: () => undefined, canReconcile: () => false };
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
    card('cardPaid', String(by('PAID')?.count ?? 0), c.cardPaid),
  );
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
  byId('reconcileToday').title = hooks.canReconcile() ? '' : c.reconcileNotPermitted;
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
  if (isOpenAttempt(a.status)) {
    if (hooks.canReconcile()) {
      const button = h(
        'button',
        { class: 'primary', type: 'button', id: `reconcile-${a.attemptId}` },
        c.reconcile,
      );
      button.addEventListener('click', () => reconcileForm(o, a, null));
      append(action, button);
    } else append(action, h('span', { class: 'muted' }, c.reconcileNotPermitted));
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
  ];
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

interface PendingReconciliation {
  readonly key: string;
  readonly outcome: string;
  readonly observed: string;
}

function reconcileForm(o: Obligation, a: Attempt, pending: PendingReconciliation | null): void {
  const c = copy();
  const outcome = h(
    'select',
    { id: 'reconcileOutcome', disabled: pending !== null },
    h('option', { value: '' }, c.chooseOutcome),
    ...RECONCILIATION_OUTCOMES.map((value) =>
      h('option', { value, selected: pending?.outcome === value }, c.outcomes[value]),
    ),
  );
  const observed = h('input', {
    id: 'reconcileObserved',
    inputmode: 'decimal',
    dir: 'ltr',
    autocomplete: 'off',
    value: pending?.observed ?? '',
    disabled: pending !== null,
  });
  const problem = h('p', { class: 'field-error', id: 'reconcileProblem', role: 'alert' });
  const status = h(
    'p',
    { id: 'reconcileStatus', role: 'status', 'aria-live': 'polite' },
    pending ? c.unknownReconcile : '',
  );
  const cancel = h('button', { class: 'ghost', type: 'button' }, c.cancel);
  cancel.addEventListener('click', () => void openObligation(o.obligationId));
  const submit = h(
    'button',
    { class: 'primary', type: 'button', id: 'reconcileSubmit' },
    pending ? c.retrySameCommand : c.recordReconciliation,
  );
  submit.addEventListener('click', () => {
    const checked = validateReconciliation({
      outcome: outcome.value,
      observed: observed.value,
      currency: a.claimed.currency,
      scale: a.claimed.scale,
    });
    if (!checked.ok) {
      replace(problem, c.reconcileProblems[checked.problem]);
      return;
    }
    replace(problem);
    const attempt = pending ?? {
      key: newCommandKey(),
      outcome: outcome.value,
      observed: observed.value,
    };
    submit.disabled = true;
    cancel.disabled = true;
    replace(status, c.submitting);
    void reconcileAttempt({
      attemptId: a.attemptId,
      expectedRevision: o.revision,
      draft: checked.value,
      key: attempt.key,
    }).then((result) => {
      if (result.ok) {
        replace(
          byId('modalBody'),
          ...obligationBody(result.value),
          h(
            'p',
            { role: 'status', 'data-correlation': result.correlationId },
            `${c.reconciled} ${c.followUp}: ${result.correlationId.slice(0, 8)}`,
          ),
        );
        replace(byId('modalFoot'), cancelToClose());
        toast(c.reconciled);
        void showPayments();
        return;
      }
      if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
      if (result.failure === 'UNKNOWN_OUTCOME') {
        reconcileForm(o, a, attempt);
        return;
      }
      submit.disabled = false;
      cancel.disabled = false;
      replace(
        status,
        h(
          'span',
          { 'data-state': result.failure },
          `${result.failure === 'CONFLICT' ? c.reconcileConflict : failureMessage(result.failure)} ${c.followUp}: ${result.correlationId.slice(0, 8)}`,
        ),
      );
    });
  });
  openModal({
    title: c.reconcileTitle,
    body: [
      h(
        'dl',
        { class: 'detail-list' },
        h('dt', {}, c.reference),
        h('dd', {}, a.reference),
        h('dt', {}, c.claimed),
        h('dd', {}, formatMoney(a.claimed)),
      ),
      h('label', { for: 'reconcileOutcome' }, c.outcome, outcome),
      h(
        'label',
        { for: 'reconcileObserved' },
        `${c.observedAmount} (${a.claimed.currency})`,
        observed,
      ),
      problem,
      status,
    ],
    foot: [cancel, submit],
  });
}

function cancelToClose(): HTMLElement {
  const close = h('button', { class: 'ghost', type: 'button' }, copy().close);
  close.addEventListener('click', closeModal);
  return close;
}

/** "مطابقة اليوم": opens the obligation lookup, the only discovery path until Billing lists attempts (CR-D-P03-04). */
export function focusLookup(): void {
  byId<HTMLInputElement>('obligationRef').focus();
}
