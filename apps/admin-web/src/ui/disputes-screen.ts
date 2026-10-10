import { listCases, type CaseSummary } from '../api/cases';
import { ACTIVE_STATUSES, CASE_KINDS, age, priority, type CaseKind } from '../domain/cases';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { openCaseDetail, shortCase } from './case-detail';
import { failureMessage } from './states';

/**
 * The approved "مركز النزاعات" screen, fed by Support's exception cases
 * (oldest first). Each row opens the case; nothing here decides anything.
 */
export interface DisputesHooks {
  readonly unauthenticated: () => void;
  readonly readableKinds: () => readonly CaseKind[];
}

let hooks: DisputesHooks = { unauthenticated: () => undefined, readableKinds: () => [] };
let generation = 0;
let cursor: string | null = null;

const TONE = { HIGH: 's-red', MEDIUM: 's-amber', LOW: 's-green' } as const;

export function wireDisputes(next: DisputesHooks): void {
  hooks = next;
  byId('caseKindFilter').addEventListener('change', () => void showDisputes());
  byId('caseStatusFilter').addEventListener('change', () => void showDisputes());
}

export function renderDisputeFilters(): void {
  const c = copy();
  const kind = byId<HTMLSelectElement>('caseKindFilter');
  const status = byId<HTMLSelectElement>('caseStatusFilter');
  const kindValue = kind.value;
  const statusValue = status.value || 'active';
  replace(
    kind,
    h('option', { value: '' }, c.allKinds),
    ...hooks
      .readableKinds()
      .map((k) => h('option', { value: k, selected: k === kindValue }, c.caseKinds[k])),
  );
  replace(
    status,
    h('option', { value: 'active', selected: statusValue === 'active' }, c.activeCases),
    h('option', { value: 'all', selected: statusValue === 'all' }, c.allCases),
  );
}

function subjectCell(item: CaseSummary): string {
  const c = copy();
  if (item.subject.type === 'booking') return shortCase(item.subject.id);
  return `${c.obligationRef} ${shortCase(item.subject.parentId ?? item.subject.id)}`;
}

function row(item: CaseSummary): HTMLElement {
  const c = copy();
  const p = priority(item.status);
  const tr = h(
    'tr',
    {
      'data-case': item.caseId,
      'data-case-kind': item.kind,
      'data-case-status': item.status,
      tabindex: '0',
      'aria-label': shortCase(item.caseId),
    },
    h('td', {}, shortCase(item.caseId)),
    h('td', {}, subjectCell(item)),
    h('td', {}, c.caseKinds[item.kind]),
    h('td', { dir: 'ltr' }, age(item.openedAt, Date.now())),
    h('td', {}, h('span', { class: `status ${TONE[p]}` }, c.priorities[p])),
    h('td', {}, c.caseStatuses[item.status]),
  );
  const open = (): void => void openCaseDetail(item.caseId);
  tr.addEventListener('click', open);
  tr.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      // Enter must not also activate the dialog's first focused control.
      event.preventDefault();
      open();
    }
  });
  return tr;
}

async function load(append_: boolean): Promise<void> {
  const run = append_ ? generation : ++generation;
  const c = copy();
  const tbody = byId('caseRows');
  const more = byId('caseMore');
  const kind = byId<HTMLSelectElement>('caseKindFilter').value;
  const active = byId<HTMLSelectElement>('caseStatusFilter').value !== 'all';
  const kinds = CASE_KINDS.filter((k) => (kind ? k === kind : hooks.readableKinds().includes(k)));
  if (!append_) {
    cursor = null;
    replace(tbody, h('tr', {}, h('td', { colspan: '6', class: 'state-cell' }, c.loading)));
  }
  const result = await listCases({
    kind: kinds,
    ...(active ? { status: ACTIVE_STATUSES } : {}),
    limit: 25,
    cursor,
  });
  if (run !== generation) return;
  byId('disputes').setAttribute('aria-busy', 'false');
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    replace(
      tbody,
      h(
        'tr',
        {},
        h(
          'td',
          { colspan: '6', class: 'state-cell', 'data-state': result.failure },
          failureMessage(result.failure),
        ),
      ),
    );
    replace(more);
    return;
  }
  if (!append_) replace(tbody);
  if (!append_ && result.value.items.length === 0)
    append(tbody, h('tr', {}, h('td', { colspan: '6', class: 'state-cell' }, c.casesEmpty)));
  append(tbody, ...result.value.items.map(row));
  cursor = result.value.nextCursor;
  if (cursor) {
    const button = h(
      'button',
      { class: 'ghost', type: 'button', id: 'caseMoreButton' },
      c.loadMore,
    );
    button.addEventListener('click', () => void load(true));
    replace(more, button);
  } else replace(more);
}

export async function showDisputes(): Promise<void> {
  byId('disputes').setAttribute('aria-busy', 'true');
  renderDisputeFilters();
  await load(false);
}

/** Refreshes the queue after a case changed, if it is on screen. */
export function refreshDisputes(): void {
  if (location.hash.startsWith('#/disputes')) void load(false);
}
