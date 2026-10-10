import { idempotencyKey, UUID } from '../api/http';
import { listResources, type Resource } from '../api/operations';
import { decide, type VerificationCase } from '../api/reviews';
import type { Capabilities } from '../domain/access';
import { shortRef } from '../domain/bookings';
import {
  REJECT_REASONS,
  approval,
  isProblem,
  rejection,
  type ReviewDecision,
} from '../domain/review';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant, freshnessStrip } from './states';

/**
 * The approved "الفنيون" screen. The technician table and the eligible count
 * come from Reporting's derived Workforce projection. Verification decisions go
 * to Workforce itself; the pending-request list needs a Workforce read API
 * that does not exist yet (CR-D-P02-04), so requests are opened by reference.
 */
const COLUMNS = 5;

export interface TechniciansHooks {
  readonly unauthenticated: () => void;
  readonly capabilities: () => Capabilities;
}

let hooks: TechniciansHooks = {
  unauthenticated: () => undefined,
  capabilities: () => ({
    bookings: false,
    resources: false,
    reviewDecisions: false,
    assignmentActions: false,
    payments: false,
    reconcile: false,
  }),
};
let cursor: string | null = null;
let generation = 0;

function messageRow(text: string, stateName?: string): HTMLTableRowElement {
  return h(
    'tr',
    {},
    h('td', { colspan: String(COLUMNS), class: 'state-cell', 'data-state': stateName }, text),
  );
}

function resourceRow(resource: Resource): HTMLTableRowElement {
  const c = copy();
  const eligible = resource.eligibility === 'ELIGIBLE';
  return h(
    'tr',
    { 'data-resource': resource.resourceId },
    h('td', { title: resource.resourceId }, shortRef(resource.resourceId)),
    h(
      'td',
      {},
      h(
        'span',
        { class: `status ${eligible ? 's-green' : 's-red'}` },
        eligible ? c.eligible : c.ineligible,
      ),
    ),
    h('td', { title: c.ownerOnly }, c.unavailableCell),
    h('td', { title: c.ownerOnly }, c.unavailableCell),
    h('td', { title: c.ownerOnly }, c.unavailableCell),
  );
}

async function loadResources(more: boolean): Promise<void> {
  const current = ++generation;
  const rows = byId('resourceRows');
  const moreSlot = byId('resourceMore');
  if (!hooks.capabilities().resources) {
    replace(rows, messageRow(copy().forbidden, 'FORBIDDEN'));
    replace(moreSlot);
    return;
  }
  if (!more) {
    cursor = null;
    replace(rows, messageRow(copy().loading, 'LOADING'));
  }
  replace(moreSlot);
  const result = await listResources(more && cursor ? { cursor } : {});
  if (current !== generation) return;
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    const message = messageRow(failureMessage(result.failure), result.failure);
    if (more) append(rows, message);
    else replace(rows, message);
    return;
  }
  const page = result.value;
  byId('kpiEligible').textContent = String(page.summary.eligible);
  byId('kpiEligibleLabel').textContent = copy().eligibleNow;
  replace(byId('resourceFreshness'), ...freshnessStrip(page.freshness));
  if (!more) replace(rows);
  if (!more && page.items.length === 0) replace(rows, messageRow(copy().emptyResources, 'EMPTY'));
  append(rows, ...page.items.map(resourceRow));
  cursor = page.nextCursor;
  if (cursor) {
    const button = h('button', { class: 'ghost', type: 'button' }, copy().loadMore);
    button.addEventListener('click', () => void loadResources(true));
    replace(moreSlot, button);
  }
}

function renderJoinRequests(): void {
  const c = copy();
  const panel = byId('joinRequests');
  byId('joinCount').textContent = c.unavailableCell;
  if (!hooks.capabilities().reviewDecisions) {
    replace(panel, h('p', { class: 'state-cell', 'data-state': 'FORBIDDEN' }, c.forbidden));
    return;
  }
  const input = h('input', {
    id: 'caseReference',
    name: 'caseReference',
    'aria-label': c.caseReference,
    placeholder: c.caseReference,
    autocomplete: 'off',
    dir: 'ltr',
  });
  const error = h('p', { class: 'field-error', id: 'caseReferenceError', role: 'alert' });
  input.setAttribute('aria-describedby', 'caseReferenceError');
  const submit = h('button', { class: 'primary', type: 'submit' }, c.openCase);
  const form = h('form', { novalidate: true }, h('p', {}, c.queuePending), input, error, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!UUID.test(value)) {
      error.textContent = c.caseNotFound;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    location.hash = `#/technicians/review/${value.toLowerCase()}`;
  });
  replace(panel, form);
}

/* ------------------------------- review dialog ------------------------------ */

function outcomeMessage(decided: VerificationCase): string {
  const c = copy();
  const base = c.decided[decided.status];
  if (decided.status === 'APPROVED' && decided.validUntil)
    return `${base} ${c.validUntil}: ${formatInstant(decided.validUntil)}`;
  if (decided.status === 'REJECTED' && decided.decisionReason) {
    const reason = REJECT_REASONS.find((r) => r === decided.decisionReason);
    return reason ? `${base} (${c.reasons[reason]})` : base;
  }
  return base;
}

export function openReview(caseId: string): void {
  const c = copy();
  if (!hooks.capabilities().reviewDecisions) {
    toast(c.forbidden);
    return;
  }
  const approveRadio = h('input', {
    type: 'radio',
    name: 'decision',
    value: 'APPROVE',
    checked: true,
  });
  const rejectRadio = h('input', { type: 'radio', name: 'decision', value: 'REJECT' });
  const validUntil = h('input', { type: 'date', id: 'validUntil', name: 'validUntil', dir: 'ltr' });
  const reason = h(
    'select',
    { id: 'rejectReason', name: 'reason', disabled: true },
    h('option', { value: '' }, '—'),
    ...REJECT_REASONS.map((r) => h('option', { value: r }, c.reasons[r])),
  );
  const problem = h('p', { class: 'field-error', id: 'reviewProblem', role: 'alert' });
  const outcome = h('p', { id: 'reviewOutcome', role: 'status', 'aria-live': 'polite' });
  const sync = (): void => {
    const approving = approveRadio.checked;
    validUntil.disabled = !approving;
    reason.disabled = approving;
  };
  approveRadio.addEventListener('change', sync);
  rejectRadio.addEventListener('change', sync);

  const cancel = h('button', { class: 'ghost', type: 'button' }, c.cancel);
  cancel.addEventListener('click', closeModal);
  const submit = h('button', { class: 'primary', type: 'button', id: 'reviewSubmit' }, c.submit);

  // One key per decision attempt; reused only to re-send the SAME decision.
  let pending: { decision: ReviewDecision; key: string } | null = null;

  const send = async (): Promise<void> => {
    problem.textContent = '';
    let decision: ReviewDecision;
    if (pending) {
      decision = pending.decision;
    } else {
      const shaped = approveRadio.checked
        ? approval(validUntil.value, new Date())
        : rejection(reason.value);
      if (isProblem(shaped)) {
        problem.textContent = c.problems[shaped];
        (approveRadio.checked ? validUntil : reason).focus();
        return;
      }
      decision = shaped;
      pending = { decision, key: idempotencyKey() };
    }
    submit.disabled = true;
    for (const control of [approveRadio, rejectRadio, validUntil, reason]) control.disabled = true;
    submit.textContent = c.submitting;
    const result = await decide(caseId, decision, pending.key);
    submit.textContent = c.submit;
    if (result.ok) {
      outcome.textContent = outcomeMessage(result.value);
      outcome.dataset.state = result.value.status;
      replace(
        byId('modalFoot'),
        h('button', { class: 'primary', type: 'button', id: 'reviewDone' }, c.close),
      );
      byId('reviewDone').addEventListener('click', closeModal);
      byId('reviewDone').focus();
      toast(outcomeMessage(result.value));
      return;
    }
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    if (result.failure === 'UNKNOWN_OUTCOME') {
      // The decision may have been committed: only the same decision may be re-sent.
      problem.textContent = c.unknownOutcome;
      problem.dataset.state = 'UNKNOWN_OUTCOME';
      submit.textContent = c.retrySame;
      submit.disabled = false;
      submit.focus();
      return;
    }
    pending = null;
    problem.dataset.state = result.failure;
    problem.textContent =
      result.failure === 'CONFLICT'
        ? c.conflict
        : result.failure === 'NOT_FOUND'
          ? c.caseNotFound
          : result.failure === 'FORBIDDEN'
            ? c.selfReview
            : failureMessage(result.failure);
    if (
      result.failure === 'CONFLICT' ||
      result.failure === 'NOT_FOUND' ||
      result.failure === 'FORBIDDEN'
    )
      return;
    submit.disabled = false;
    approveRadio.disabled = false;
    rejectRadio.disabled = false;
    sync();
  };
  submit.addEventListener('click', () => void send());

  const field = (label: string, control: HTMLElement): HTMLLabelElement =>
    h('label', {}, label, control);
  openModal({
    title: c.reviewTitle,
    body: [
      h(
        'div',
        {},
        h('b', {}, `${c.reviewCase}: `),
        h('span', { dir: 'ltr', id: 'reviewCaseId' }, caseId),
      ),
      h(
        'fieldset',
        { class: 'decision' },
        h('legend', {}, c.decision),
        h('label', {}, approveRadio, ` ${c.approve}`),
        h('label', {}, rejectRadio, ` ${c.requestCorrection}`),
      ),
      field(c.validUntil, validUntil),
      field(c.reason, reason),
      problem,
      outcome,
    ],
    foot: [cancel, submit],
    onClose: () => {
      if (location.hash.startsWith('#/technicians/review/')) location.hash = '#/technicians';
    },
  });
}

export function wireTechnicians(next: TechniciansHooks): void {
  hooks = next;
  byId('addTechnician').title = copy().addTechnicianPending;
}

export function showTechnicians(): Promise<void> {
  renderJoinRequests();
  return loadResources(false);
}
