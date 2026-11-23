import { operationsKpis, type Durations, type OperationsKpis } from '../api/kpis';
import { ASSIGNMENT_STATUSES } from '../domain/assignment';
import { DERIVED_STATUSES, periodWindow } from '../domain/bookings';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { failureMessage, freshnessStrip } from './states';

/**
 * The approved "لوحة التحكم" screen, fed only by Reporting's derived KPIs for
 * today. Cards and panels without a real source (revenue, customers, rating,
 * charts, map, system health) are not rendered with invented numbers; the
 * declared differences are listed in P03-D3_ADMIN_LIVE_OPERATIONS_AND_FINANCE.md.
 */
export interface DashboardHooks {
  readonly unauthenticated: () => void;
}

let hooks: DashboardHooks = { unauthenticated: () => undefined };
let generation = 0;

export function wireDashboard(next: DashboardHooks): void {
  hooks = next;
}

/** Minutes, rounded down, from an exact millisecond figure; "—" when there is none. */
export function minutes(ms: number | null): string {
  return ms === null ? copy().unavailableCell : `${Math.floor(ms / 60_000)}`;
}

function kpi(label: string, value: string, tone: string, icon: string): HTMLElement {
  return h(
    'div',
    { class: 'card kpi' },
    h('div', { class: 'icon', 'data-tone': tone, 'aria-hidden': 'true' }, icon),
    h('div', {}, h('small', {}, label), h('b', {}, value)),
  );
}

function durationRow(label: string, d: Durations): HTMLElement {
  const c = copy();
  return h(
    'div',
    {},
    h('span', {}, label),
    h(
      'b',
      {},
      d.count === 0
        ? c.unavailableCell
        : `${minutes(d.p50Ms)} / ${minutes(d.p90Ms)} ${c.minutesShort}`,
    ),
  );
}

function render(k: OperationsKpis): void {
  const c = copy();
  const total = DERIVED_STATUSES.reduce((n, s) => n + k.bookingsByStatus[s], 0);
  replace(
    byId('dashboardKpis'),
    kpi(c.kpiBookingsToday, String(total), 'blue', '▣'),
    kpi(c.kpiAssigned, String(k.assignmentsByStatus.ASSIGNED), 'green', '♟'),
    kpi(
      c.kpiAwaitingAssignment,
      String(k.assignmentsByStatus.UNASSIGNED + k.assignmentsByStatus.OFFERED),
      'amber',
      '◌',
    ),
    kpi(
      c.kpiMedianAssign,
      k.timeToAssign.count === 0
        ? c.unavailableCell
        : `${minutes(k.timeToAssign.p50Ms)} ${c.minutesShort}`,
      'violet',
      '⏱',
    ),
    kpi(c.kpiLateAssignments, String(k.assignedAfterStart), 'rose', '⚠'),
  );
  replace(
    byId('dashboardStatus'),
    ...DERIVED_STATUSES.map((s) =>
      h('div', {}, h('span', {}, c.status[s]), h('b', {}, String(k.bookingsByStatus[s]))),
    ),
  );
  replace(
    byId('dashboardAssignments'),
    ...ASSIGNMENT_STATUSES.map((s) =>
      h(
        'div',
        {},
        h('span', {}, c.assignmentStatus[s]),
        h('b', {}, String(k.assignmentsByStatus[s])),
      ),
    ),
    h('div', {}, h('span', {}, c.reassigned), h('b', {}, String(k.reassigned))),
  );
  replace(
    byId('dashboardTiming'),
    durationRow(c.timeToFirstOffer, k.timeToFirstOffer),
    durationRow(c.timeToAssign, k.timeToAssign),
    durationRow(c.offerToAssign, k.offerToAssign),
    h(
      'div',
      {},
      h('span', {}, c.fieldStages),
      h('b', {}, k.fieldStagesAvailable ? '' : c.notAvailableYet),
    ),
  );
  const strip = byId('dashboardFreshness');
  replace(strip, ...freshnessStrip(k.freshness));
  if (k.incompleteSources.length > 0)
    append(strip, h('span', { class: 'status s-amber', 'data-partial': 'true' }, c.partialKpi));
}

export async function showDashboard(): Promise<void> {
  const run = ++generation;
  const c = copy();
  const section = byId('dashboard');
  section.setAttribute('aria-busy', 'true');
  replace(byId('dashboardKpis'), h('p', { class: 'state-cell' }, c.loading));
  const result = await operationsKpis(periodWindow('today', new Date()));
  if (run !== generation) return;
  section.setAttribute('aria-busy', 'false');
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    const message = h(
      'p',
      { class: 'state-cell', 'data-state': result.failure },
      failureMessage(result.failure),
    );
    if (result.failure !== 'FORBIDDEN' && result.failure !== 'UNAUTHENTICATED') {
      const retry = h('button', { class: 'ghost', type: 'button' }, c.retry);
      retry.addEventListener('click', () => void showDashboard());
      append(message, ' ', retry);
    }
    replace(byId('dashboardKpis'), message);
    for (const id of [
      'dashboardStatus',
      'dashboardAssignments',
      'dashboardTiming',
      'dashboardFreshness',
    ])
      replace(byId(id));
    return;
  }
  render(result.value);
}
