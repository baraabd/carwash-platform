import type { Attempt, Obligation } from '../api/finance';
import { readStatementCredit, type StatementCreditReview } from '../api/statement-credit';
import { formatMoney } from '../domain/finance';
import { append, h, replace } from './dom';
import { copy } from './i18n';
import { failureMessage, formatInstant } from './states';

/** A read does not approve or settle anything. The user must select the displayed record. */
export function statementCreditPicker(input: {
  readonly obligation: Obligation;
  readonly attempt: Attempt;
  readonly frozen: StatementCreditReview | null;
  readonly unauthenticated: () => void;
}) {
  const c = copy();
  let record = input.frozen;
  let loading = false;
  let frozen = input.frozen !== null;
  const select = h('select', { id: 'statementCredit', disabled: frozen });
  const details = h('dl', { class: 'detail-list' });
  const status = h('p', { id: 'statementCreditStatus', role: 'status', 'aria-live': 'polite' });
  const refresh = h(
    'button',
    { class: 'ghost', type: 'button', disabled: frozen },
    c.reloadStatement,
  );
  const node = h(
    'section',
    { id: 'statementCreditReview', hidden: true, role: 'group', 'aria-label': c.statementCredit },
    h('label', { for: 'statementCredit' }, c.statementCredit, select),
    details,
    h('p', {}, c.statementReviewNotice),
    status,
    refresh,
  );

  function render(): void {
    replace(select, h('option', { value: '' }, c.chooseStatement));
    replace(details);
    if (!record) return;
    append(
      select,
      h(
        'option',
        { value: record.creditId, selected: frozen },
        `${c.methods[record.provider]} · ${record.reference} · ${formatMoney(record.amount)}`,
      ),
    );
    for (const [label, value] of [
      [c.statementMerchant, record.merchantAccount],
      [c.reference, record.reference],
      [c.statementEvidence, record.evidenceFingerprint],
      [c.statementOccurredAt, formatInstant(record.occurredAt)],
      [c.statementRecordedAt, formatInstant(record.recordedAt)],
      [c.statementStatus, c.statementPending],
    ])
      append(details, h('dt', {}, label), h('dd', {}, value));
  }

  async function load(): Promise<void> {
    if (loading || frozen) return;
    loading = true;
    record = null;
    render();
    select.disabled = true;
    refresh.disabled = true;
    replace(status, c.loading);
    const result = await readStatementCredit(input.attempt.attemptId);
    loading = false;
    if (!node.isConnected) return;
    select.disabled = frozen;
    refresh.disabled = frozen;
    if (!result.ok) {
      if (result.failure === 'UNAUTHENTICATED') input.unauthenticated();
      replace(
        status,
        h(
          'span',
          { 'data-state': result.failure },
          result.code === 'PROVIDER_CREDIT_REQUIRED'
            ? c.statementMissing
            : failureMessage(result.failure),
        ),
      );
      return;
    }
    if (
      result.value.obligationId !== input.obligation.obligationId ||
      result.value.obligationRevision !== input.obligation.revision ||
      result.value.provider !== input.attempt.method
    ) {
      replace(status, h('span', { 'data-state': 'CONFLICT' }, c.reconcileConflict));
      return;
    }
    record = result.value;
    render();
    replace(status);
  }

  refresh.addEventListener('click', () => void load());
  render();
  return {
    node,
    selected: () => (record && select.value === record.creditId ? record : null),
    show(required: boolean): void {
      node.hidden = !required;
      if (required && !record) void load();
    },
    freeze(value: boolean): void {
      frozen = value;
      select.disabled = value || loading;
      refresh.disabled = value || loading;
    },
  };
}
