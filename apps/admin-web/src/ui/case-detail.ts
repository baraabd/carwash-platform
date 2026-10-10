import {
  approveDecision,
  currentState,
  decide,
  listCases,
  openCase,
  readCase,
  resendDecision,
  type CaseDetail,
  type CaseSubject,
  type Decision,
} from '../api/cases';
import type { Result } from '../api/http';
import { newCommandKey } from '../api/live';
import {
  ACTIVE_STATUSES,
  EVIDENCE_KINDS,
  KINDS,
  actionRule,
  canApprove,
  damascusWindow,
  decidableActions,
  isResendable,
  priority,
  validateDecision,
  type CaseAction,
  type CaseKind,
  type DecisionDraft,
} from '../domain/cases';
import { formatMoney, parseAmount } from '../domain/finance';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant } from './states';

/**
 * One exception case: what was opened, the owner's state then and now, every
 * decision with its reason, evidence and the owner's answer, and the audit.
 * Decisions are recorded in Support and carried out by the owner; this view
 * shows Support's record and never infers an outcome.
 */
export interface CaseHooks {
  readonly unauthenticated: () => void;
  readonly viewer: () => { readonly subject: string; readonly permissions: readonly string[] };
  readonly changed: () => void;
}

let hooks: CaseHooks = {
  unauthenticated: () => undefined,
  viewer: () => ({ subject: '', permissions: [] }),
  changed: () => undefined,
};

export function wireCases(next: CaseHooks): void {
  hooks = next;
}

export const shortCase = (id: string): string => `#${id.slice(0, 8).toUpperCase()}`;

const STATUS_TONE = { HIGH: 's-red', MEDIUM: 's-amber', LOW: 's-green' } as const;

function failure<T>(result: Result<T>): result is Extract<Result<T>, { ok: false }> {
  if (!result.ok && result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
  return !result.ok;
}

function follow(correlationId: string): string {
  return `${copy().followUp}: ${correlationId.slice(0, 8)}`;
}

function rows(entries: readonly (readonly [string, string])[]): HTMLElement {
  return h(
    'dl',
    { class: 'detail-list' },
    ...entries.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
  );
}

function panel(id: string, title: string, owner: string, ...body: Node[]): HTMLElement {
  return h(
    'section',
    { class: 'card panel detail-section', id, 'aria-labelledby': `${id}Title` },
    h(
      'div',
      { class: 'panel-head' },
      h('h3', { id: `${id}Title` }, title),
      h('span', { class: 'status s-blue owner-chip' }, owner),
    ),
    ...body,
  );
}

function subjectLabel(subject: CaseSubject): string {
  const c = copy();
  if (subject.type === 'booking') return shortCase(subject.id);
  return `${c.obligationRef} ${shortCase(subject.parentId ?? subject.id)}`;
}

function money(
  state: Readonly<Record<string, string | number | null>>,
  key: string,
): string | null {
  const minor = state[key];
  const currency = state.currency;
  const scale = state.scale;
  if (typeof minor !== 'string' || typeof currency !== 'string' || typeof scale !== 'number')
    return null;
  return formatMoney({ currency, amountMinor: minor, scale });
}

function snapshotLines(
  state: Readonly<Record<string, string | number | null>>,
): [string, string][] {
  const c = copy();
  const lines: [string, string][] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined) lines.push([label, String(value)]);
  };
  add(c.financialStatus, state.financialStatus);
  add(c.attemptStatus, state.attemptStatus);
  add(c.amountDue, money(state, 'amountMinor'));
  add(c.verified, money(state, 'verifiedMinor'));
  add(c.outstanding, money(state, 'outstandingMinor'));
  add(c.claimed, money(state, 'claimedMinor'));
  add(c.bookingStatus, state.bookingStatus);
  if (typeof state.startsAt === 'string' && typeof state.endsAt === 'string')
    add(c.slot, `${formatInstant(state.startsAt)} – ${formatInstant(state.endsAt)}`);
  add(c.revision, state.obligationRevision ?? state.bookingRevision);
  return lines;
}

function ownerOf(kind: CaseKind): string {
  return KINDS[kind].desk === 'FINANCE' ? copy().ownerBilling : copy().ownerBooking;
}

/* --------------------------------- decisions --------------------------------- */

function decisionView(detail: CaseDetail, d: Decision): HTMLElement {
  const c = copy();
  const answer = d.owner
    ? [
        c.decisionStatuses[d.status],
        d.owner.state ? `(${d.owner.state})` : '',
        d.owner.code ? `(${d.owner.code})` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : c.decisionStatuses[d.status];
  const item = h(
    'article',
    {
      class: 'decision',
      id: `decision-${d.decisionNo}`,
      'data-decision-status': d.status,
      'data-owner-state': d.owner?.state ?? undefined,
    },
    h('h4', {}, `${d.decisionNo}. ${c.caseActions[d.action]}`),
    rows([
      [
        c.decisionReason,
        `${c.reasonCodes[d.reason.code as keyof typeof c.reasonCodes] ?? d.reason.code}: ${d.reason.note}`,
      ],
      ...(d.evidence.length > 0
        ? [
            [
              c.evidenceReference,
              d.evidence
                .map(
                  (e) =>
                    `${c.evidenceKinds[e.kind as keyof typeof c.evidenceKinds] ?? e.kind}: ${e.reference}`,
                )
                .join(' · '),
            ] as [string, string],
          ]
        : []),
      ...(d.amount ? [[c.decisionAmount, formatMoney(d.amount)] as [string, string]] : []),
      ...(d.window
        ? [
            [c.slot, `${formatInstant(d.window.startsAt)} – ${formatInstant(d.window.endsAt)}`] as [
              string,
              string,
            ],
          ]
        : []),
      [c.decidedBy, `${shortCase(d.decidedBy)} · ${formatInstant(d.decidedAt)}`],
      ...(d.approval
        ? [
            [c.approvalTitle, `${shortCase(d.approval.by)} · ${d.approval.note ?? ''}`] as [
              string,
              string,
            ],
          ]
        : []),
      [c.ownerAnswer, answer],
      ...(d.owner ? [[c.sentAttempts, String(d.owner.attempts)] as [string, string]] : []),
    ]),
  );
  const viewer = hooks.viewer();
  if (
    canApprove({
      caseStatus: detail.case.status,
      decisionStatus: d.status,
      proposer: d.decidedBy,
      viewer: viewer.subject,
      permissions: viewer.permissions,
    })
  )
    append(item, approvalForm(detail, d));
  else if (d.status === 'AWAITING_APPROVAL' && d.decidedBy === viewer.subject)
    append(item, h('p', { class: 'muted', id: 'ownProposal' }, c.ownProposal));
  if (isResendable(d.status) && decidableAnyway(detail.case.kind, d.action, viewer.permissions)) {
    const button = h(
      'button',
      { class: 'primary', type: 'button', id: `resend-${d.decisionNo}` },
      c.resendSame,
    );
    const status = h('p', { role: 'status', 'aria-live': 'polite' });
    button.addEventListener('click', () => {
      button.disabled = true;
      replace(status, c.submitting);
      void resendDecision(detail.case.caseId, d.decisionNo).then((result) => {
        if (failure(result)) {
          button.disabled = false;
          replace(
            status,
            h(
              'span',
              { 'data-state': result.failure },
              `${failureMessage(result.failure)} ${follow(result.correlationId)}`,
            ),
          );
          return;
        }
        render(result.value, result.correlationId);
      });
    });
    append(item, button, status);
  }
  return item;
}

/** Resending needs the same grant as deciding that action. */
function decidableAnyway(
  kind: CaseKind,
  action: CaseAction,
  permissions: readonly string[],
): boolean {
  const r = actionRule(kind, action);
  if (!r) return false;
  return r.permission === null ? true : permissions.includes(r.permission);
}

function approvalForm(detail: CaseDetail, d: Decision): HTMLElement {
  const c = copy();
  const note = h('textarea', { id: 'approvalNote', rows: '2', maxlength: '500' });
  const problem = h('p', { class: 'field-error', id: 'approvalProblem', role: 'alert' });
  const status = h('p', { role: 'status', 'aria-live': 'polite' });
  const approve = h(
    'button',
    { class: 'primary', type: 'button', id: 'approveDecision' },
    c.approveDecision,
  );
  const reject = h(
    'button',
    { class: 'ghost', type: 'button', id: 'rejectDecision' },
    c.rejectDecision,
  );
  let key: string | null = null;
  let pending: boolean | null = null;
  const send = (value: boolean) => {
    if (note.value.trim().length < 10) {
      replace(problem, c.caseProblems.NOTE_TOO_SHORT);
      return;
    }
    replace(problem);
    if (pending !== null && pending !== value) return;
    key ??= newCommandKey();
    pending = value;
    approve.disabled = true;
    reject.disabled = true;
    note.disabled = true;
    replace(status, c.submitting);
    void approveDecision(
      detail.case.caseId,
      d.decisionNo,
      { approve: value, note: note.value.trim() },
      key,
    ).then((result) => {
      if (failure(result)) {
        if (result.failure === 'UNKNOWN_OUTCOME') {
          // Same key, same body: only "send the same again" is offered.
          (value ? approve : reject).disabled = false;
          replace(status, h('span', { 'data-state': result.failure }, c.decisionUnknown));
          return;
        }
        approve.disabled = false;
        reject.disabled = false;
        note.disabled = false;
        key = null;
        pending = null;
        replace(
          status,
          h(
            'span',
            { 'data-state': result.failure, 'data-code': result.code ?? undefined },
            `${failureMessage(result.failure)} ${follow(result.correlationId)}`,
          ),
        );
        return;
      }
      render(result.value, result.correlationId);
    });
  };
  approve.addEventListener('click', () => send(true));
  reject.addEventListener('click', () => send(false));
  return h(
    'div',
    { class: 'approval', id: 'approvalForm' },
    h('h4', {}, c.approvalTitle),
    h('label', { for: 'approvalNote' }, c.approvalNote, note),
    problem,
    h('div', { class: 'form-actions' }, reject, approve),
    status,
  );
}

/* ------------------------------- decision form ------------------------------- */

interface PendingDecision {
  readonly key: string;
  readonly draft: DecisionDraft;
}

function decisionForm(
  detail: CaseDetail,
  actions: readonly CaseAction[],
  pending: PendingDecision | null,
): HTMLElement {
  const c = copy();
  const kind = detail.case.kind;
  const locked = pending !== null;
  const action = h(
    'select',
    { id: 'caseAction', disabled: locked },
    h('option', { value: '' }, c.decisionAction),
    ...actions.map((a) =>
      h('option', { value: a, selected: pending?.draft.action === a }, c.caseActions[a]),
    ),
  );
  const reason = h(
    'select',
    { id: 'caseReason', disabled: locked },
    h('option', { value: '' }, c.decisionReason),
    ...KINDS[kind].reasons.map((r) =>
      h('option', { value: r, selected: pending?.draft.reason.code === r }, c.reasonCodes[r]),
    ),
  );
  const note = h('textarea', { id: 'caseNote', rows: '3', maxlength: '500', disabled: locked });
  note.value = pending?.draft.reason.note ?? '';
  const evidenceRows = h('div', { class: 'evidence-rows', id: 'evidenceRows' });
  const addEvidenceRow = (kindValue = 'PROVIDER_STATEMENT', reference = '') => {
    const index = evidenceRows.childElementCount;
    if (index >= 5) return;
    append(
      evidenceRows,
      h(
        'div',
        { class: 'evidence-row' },
        h(
          'label',
          { for: `evidenceKind-${index}` },
          c.evidenceKind,
          h(
            'select',
            { id: `evidenceKind-${index}`, disabled: locked },
            ...EVIDENCE_KINDS.map((k) =>
              h('option', { value: k, selected: k === kindValue }, c.evidenceKinds[k]),
            ),
          ),
        ),
        h(
          'label',
          { for: `evidenceRef-${index}` },
          c.evidenceReference,
          h('input', {
            id: `evidenceRef-${index}`,
            dir: 'ltr',
            autocomplete: 'off',
            spellcheck: 'false',
            value: reference,
            disabled: locked,
          }),
        ),
      ),
    );
  };
  for (const e of pending?.draft.evidence ?? []) addEvidenceRow(e.kind, e.reference);
  if (evidenceRows.childElementCount === 0) addEvidenceRow();
  const addEvidence = h(
    'button',
    { class: 'ghost', type: 'button', id: 'addEvidence', disabled: locked },
    c.addEvidence,
  );
  addEvidence.addEventListener('click', () => addEvidenceRow());
  const currency =
    typeof detail.case.snapshot.state.currency === 'string'
      ? detail.case.snapshot.state.currency
      : null;
  const scale =
    typeof detail.case.snapshot.state.scale === 'number' ? detail.case.snapshot.state.scale : null;
  const amount = h('input', {
    id: 'caseAmount',
    inputmode: 'decimal',
    dir: 'ltr',
    autocomplete: 'off',
    disabled: locked,
    value: pending?.draft.amount ? formatMoney(pending.draft.amount).split(' ')[0] : '',
  });
  const amountLabel = h(
    'label',
    { for: 'caseAmount', id: 'caseAmountLabel' },
    `${c.decisionAmount}${currency ? ` (${currency})` : ''}`,
    amount,
  );
  const date = h('input', { id: 'windowDate', type: 'date', disabled: locked });
  const start = h('input', { id: 'windowStart', type: 'time', disabled: locked });
  const end = h('input', { id: 'windowEnd', type: 'time', disabled: locked });
  const windowFields = h(
    'div',
    { class: 'window-fields', id: 'windowFields' },
    h('label', { for: 'windowDate' }, c.windowDate, date),
    h('label', { for: 'windowStart' }, c.windowStart, start),
    h('label', { for: 'windowEnd' }, c.windowEnd, end),
  );
  const evidenceBlock = h('div', { id: 'evidenceBlock' }, evidenceRows, addEvidence);
  const sync = () => {
    const r = action.value ? actionRule(kind, action.value as CaseAction) : null;
    amountLabel.hidden = !r?.amount;
    windowFields.hidden = !r?.window;
  };
  action.addEventListener('change', sync);
  sync();
  const problem = h('p', { class: 'field-error', id: 'caseProblem', role: 'alert' });
  const status = h(
    'p',
    { id: 'caseStatusLine', role: 'status', 'aria-live': 'polite' },
    locked ? c.decisionUnknown : '',
  );
  const submit = h(
    'button',
    { class: 'primary', type: 'button', id: 'caseDecide' },
    locked ? c.resendSame : c.recordDecision,
  );
  submit.addEventListener('click', () => {
    let draft: DecisionDraft;
    if (pending) draft = pending.draft;
    else {
      const r = action.value ? actionRule(kind, action.value as CaseAction) : null;
      const checked = validateDecision({
        kind,
        action: action.value,
        reasonCode: reason.value,
        note: note.value,
        evidence: [...evidenceRows.querySelectorAll('.evidence-row')].map((row) => ({
          kind: row.querySelector('select')?.value ?? '',
          reference: row.querySelector('input')?.value ?? '',
        })),
        amount:
          r?.amount && currency && scale !== null
            ? parseAmount(amount.value, currency, scale)
            : null,
        window: r?.window ? damascusWindow(date.value, start.value, end.value, Date.now()) : null,
      });
      if (!checked.ok) {
        replace(problem, c.caseProblems[checked.problem]);
        return;
      }
      draft = checked.value;
    }
    replace(problem);
    const attempt: PendingDecision = pending ?? { key: newCommandKey(), draft };
    submit.disabled = true;
    replace(status, c.submitting);
    void decide(detail.case.caseId, attempt.draft, attempt.key).then((result) => {
      if (failure(result)) {
        if (result.failure === 'UNKNOWN_OUTCOME') {
          // The decision may be recorded: the form locks to the same request and key.
          const form = byId('caseDecisionForm');
          form.replaceWith(decisionForm(detail, actions, attempt));
          return;
        }
        submit.disabled = false;
        replace(
          status,
          h(
            'span',
            { 'data-state': result.failure, 'data-code': result.code ?? undefined },
            `${result.failure === 'CONFLICT' ? c.notDecidable : failureMessage(result.failure)} ${follow(result.correlationId)}`,
          ),
        );
        return;
      }
      toast(c.caseDecided);
      render(result.value, result.correlationId);
    });
  });
  return h(
    'section',
    {
      class: 'card panel detail-section',
      id: 'caseDecisionForm',
      'aria-labelledby': 'caseDecisionFormTitle',
    },
    h('div', { class: 'panel-head' }, h('h3', { id: 'caseDecisionFormTitle' }, c.decideTitle)),
    h('label', { for: 'caseAction' }, c.decisionAction, action),
    h('label', { for: 'caseReason' }, c.decisionReason, reason),
    h('label', { for: 'caseNote' }, c.decisionNote, note),
    evidenceBlock,
    amountLabel,
    windowFields,
    problem,
    h('div', { class: 'form-actions' }, submit),
    status,
  );
}

/* ---------------------------------- render ---------------------------------- */

function render(detail: CaseDetail, correlationId: string | null): void {
  const c = copy();
  const k = detail.case;
  const viewer = hooks.viewer();
  const head = panel(
    'caseHead',
    c.caseTitle,
    c.ownerSupport,
    rows([
      [c.caseColumns.reason, c.caseKinds[k.kind]],
      [c.caseColumns.status, c.caseStatuses[k.status]],
      [c.caseSubject, subjectLabel(k.subject)],
      [c.caseSummary, k.summary],
      [c.caseOpened, `${formatInstant(k.openedAt)} · ${shortCase(k.openedBy)}`],
    ]),
    h(
      'span',
      { class: `status ${STATUS_TONE[priority(k.status)]}`, id: 'casePriority' },
      c.priorities[priority(k.status)],
    ),
  );
  const snapshot = panel(
    'caseSnapshot',
    c.snapshotTitle,
    ownerOf(k.kind),
    rows(snapshotLines(k.snapshot.state)),
    h('p', { class: 'muted' }, formatInstant(k.snapshot.readAt)),
  );
  const current = panel(
    'caseCurrent',
    c.currentTitle,
    ownerOf(k.kind),
    h('p', { 'aria-busy': 'true' }, c.loading),
  );
  const decisions = panel(
    'caseDecisions',
    c.decisionsTitle,
    c.ownerSupport,
    ...(detail.decisions.length === 0
      ? [h('p', { class: 'muted' }, c.noDecisions)]
      : detail.decisions.map((d) => decisionView(detail, d))),
  );
  const actions = decidableActions(k.kind, k.status, viewer.permissions);
  const auditRows = detail.events.map((e) =>
    h(
      'tr',
      { 'data-audit-action': e.action, 'data-correlation': e.correlationId },
      h('td', {}, formatInstant(e.at)),
      h('td', {}, e.action),
      h(
        'td',
        {},
        `${e.from ? c.caseStatuses[e.from as keyof typeof c.caseStatuses] : '—'} → ${c.caseStatuses[e.to as keyof typeof c.caseStatuses]}`,
      ),
      h('td', {}, e.outcome ?? '—'),
      h('td', {}, shortCase(e.actor)),
      h('td', { dir: 'ltr' }, e.correlationId.slice(0, 8)),
    ),
  );
  const audit = panel(
    'caseAudit',
    c.auditTitle,
    c.ownerSupport,
    h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, ...auditRows))),
  );
  const body: Node[] = [head, snapshot, current, decisions];
  if (actions.length > 0) body.push(decisionForm(detail, actions, null));
  body.push(audit);
  if (correlationId)
    body.push(
      h(
        'p',
        { role: 'status', id: 'caseFollowUp', 'data-correlation': correlationId },
        follow(correlationId),
      ),
    );
  const close = h('button', { class: 'ghost', type: 'button' }, c.close);
  close.addEventListener('click', closeModal);
  openModal({ title: `${c.caseTitle} ${shortCase(k.caseId)}`, body, foot: [close] });
  byId('modalBody').setAttribute('data-case', k.caseId);
  byId('modalBody').setAttribute('data-case-status', k.status);
  void fillCurrent(k.caseId, current);
  hooks.changed();
}

async function fillCurrent(caseId: string, into: HTMLElement): Promise<void> {
  const c = copy();
  const result = await currentState(caseId);
  const head = into.querySelector('.panel-head');
  if (failure(result)) {
    replace(into, head, h('p', { 'data-state': result.failure }, failureMessage(result.failure)));
    return;
  }
  const s = result.value;
  replace(
    into,
    head,
    rows([
      [s.owner === 'billing' ? c.financialStatus : c.bookingStatus, s.status],
      [c.revision, String(s.revision)],
      ...s.lines.map(
        ([k, v]) =>
          [
            k.startsWith('attempt:') ? `${c.attemptStatus} ${shortCase(k.slice(8))}` : k,
            k.endsWith('At') ? formatInstant(v) : v,
          ] as [string, string],
      ),
    ]),
    h('p', { class: 'muted', 'data-current-status': s.status }, formatInstant(s.readAt)),
  );
}

export async function openCaseDetail(caseId: string): Promise<void> {
  const c = copy();
  const close = h('button', { class: 'ghost', type: 'button' }, c.close);
  close.addEventListener('click', closeModal);
  openModal({
    title: c.caseTitle,
    body: [h('p', { 'aria-busy': 'true' }, c.loading)],
    foot: [close],
  });
  const result = await readCase(caseId);
  if (failure(result)) {
    replace(
      byId('modalBody'),
      h('p', { 'data-state': result.failure }, failureMessage(result.failure)),
    );
    return;
  }
  render(result.value, null);
}

/**
 * Opens a case for a subject (one key per intended opening) and shows it. An
 * already-open case for the same subject is found and shown instead.
 */
export function startCase(kind: CaseKind, subject: CaseSubject): void {
  const c = copy();
  const summary = h('input', {
    id: 'caseSummaryInput',
    maxlength: '200',
    value: c.caseSummaryDefault[kind],
  });
  const status = h('p', { role: 'status', 'aria-live': 'polite', id: 'caseOpenStatus' });
  const submit = h(
    'button',
    { class: 'primary', type: 'button', id: 'caseOpenSubmit' },
    c.openCaseSubmit,
  );
  const cancel = h('button', { class: 'ghost', type: 'button' }, c.cancel);
  cancel.addEventListener('click', closeModal);
  const key = newCommandKey();
  submit.addEventListener('click', () => {
    submit.disabled = true;
    replace(status, c.submitting);
    void openCase({ kind, subject, summary: summary.value.trim(), key }).then(async (result) => {
      if (!failure(result)) {
        render(result.value, result.correlationId);
        return;
      }
      // The Gateway reports every owner 409 as CONFLICT: an open case for the
      // subject is looked up; otherwise the owner state did not allow opening.
      if (result.failure === 'CONFLICT') {
        const found = await listCases({
          kind: [kind],
          status: ACTIVE_STATUSES,
          subject: { type: subject.type, id: subject.id },
          limit: 1,
        });
        const existing = found.ok ? found.value.items[0] : undefined;
        if (existing) {
          toast(c.caseAlreadyOpen);
          await openCaseDetail(existing.caseId);
          return;
        }
      }
      // A lost answer may have opened the case: the same key replays it.
      submit.disabled = false;
      replace(
        status,
        h(
          'span',
          { 'data-state': result.failure, 'data-code': result.code ?? undefined },
          `${result.failure === 'CONFLICT' ? c.subjectNotEligible : failureMessage(result.failure)} ${follow(result.correlationId)}`,
        ),
      );
    });
  });
  openModal({
    title: `${c.caseKinds[kind]} · ${subjectLabel(subject)}`,
    body: [h('label', { for: 'caseSummaryInput' }, c.caseSummaryLabel, summary), status],
    foot: [cancel, submit],
  });
}
