import { zoneAssignments, type LiveAssignment } from '../api/live';
import { listBookings, type BookingOperation } from '../api/operations';
import { STATUS_TONE as ASSIGNMENT_TONE } from '../domain/assignment';
import {
  DERIVED_STATUSES,
  PERIODS,
  STATUS_TONE,
  bookingReference,
  isDerivedStatus,
  periodWindow,
  shortRef,
  type DerivedStatus,
  type Period,
} from '../domain/bookings';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { openBookingDetail } from './booking-detail';
import { toast } from './shell';
import { failureMessage, formatInstant, freshnessStrip } from './states';

/**
 * The approved "الحجوزات" screen fed by Reporting's derived booking-operations
 * projection. Columns the projection does not carry (customer name, vehicle,
 * package, technician, payment) belong to Booking/Dispatch; they show an
 * explicit "not available" cell instead of invented values.
 */
const COLUMNS = 8;

interface State {
  period: Period;
  status: DerivedStatus | null;
  cursor: string | null;
  generation: number;
}

const state: State = { period: 'today', status: null, cursor: null, generation: 0 };

export interface BookingsHooks {
  readonly unauthenticated: () => void;
}

let hooks: BookingsHooks = { unauthenticated: () => undefined };

function messageRow(text: string, busy = false): HTMLTableRowElement {
  return h(
    'tr',
    {},
    h(
      'td',
      { colspan: String(COLUMNS), class: 'state-cell', 'aria-busy': busy ? 'true' : undefined },
      text,
    ),
  );
}

function ownerCell(): HTMLTableCellElement {
  const c = copy();
  return h(
    'td',
    { title: c.ownerOnly },
    h('span', { 'aria-label': c.ownerOnly }, c.unavailableCell),
  );
}

/** Filled from Dispatch, the assignment owner, after the page renders. */
function liveCell(bookingId: string): HTMLTableCellElement {
  return h('td', { 'data-live': bookingId, 'aria-busy': 'true' }, copy().unavailableCell);
}

/**
 * Authoritative assignment status for the visible rows: one Dispatch read per
 * zone covering the page's job starts. Rows without a slot, or whose zone
 * read fails, keep "—" with the reason in the cell title.
 */
async function fillLive(items: readonly BookingOperation[], generation: number): Promise<void> {
  const c = copy();
  const byZone = new Map<string, number[]>();
  for (const item of items) {
    if (!item.slot) continue;
    const times = byZone.get(item.slot.zoneId) ?? [];
    times.push(Date.parse(item.slot.startsAt));
    byZone.set(item.slot.zoneId, times);
  }
  for (const [zoneId, times] of byZone) {
    const result = await zoneAssignments({
      zoneId,
      from: new Date(Math.min(...times)).toISOString(),
      to: new Date(Math.max(...times) + 1).toISOString(),
    });
    if (generation !== state.generation) return;
    if (!result.ok) {
      if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
      for (const item of items)
        if (item.slot?.zoneId === zoneId)
          settleCell(item.bookingId, null, failureMessage(result.failure));
      continue;
    }
    for (const a of result.value) settleCell(a.bookingId, a, null);
  }
  for (const cell of document.querySelectorAll<HTMLElement>('td[data-live][aria-busy="true"]')) {
    cell.removeAttribute('aria-busy');
    cell.title = c.noAssignment;
  }
}

function settleCell(bookingId: string, a: LiveAssignment | null, problem: string | null): void {
  const cell = document.querySelector<HTMLElement>(`td[data-live="${bookingId}"]`);
  if (!cell) return;
  cell.removeAttribute('aria-busy');
  if (!a) {
    cell.title = problem ?? '';
    return;
  }
  cell.dataset.assignment = a.status;
  replace(
    cell,
    h('span', { class: `status ${ASSIGNMENT_TONE[a.status]}` }, copy().assignmentStatus[a.status]),
    a.resourceId ? ` ${shortRef(a.resourceId)}` : '',
  );
}

function statusChip(status: DerivedStatus | null): HTMLElement {
  if (status === null) return h('span', {}, copy().unavailableCell);
  return h('span', { class: `status ${STATUS_TONE[status]}` }, copy().status[status]);
}

function row(item: BookingOperation): HTMLTableRowElement {
  const tr = h(
    'tr',
    { 'data-booking': item.bookingId, tabindex: '0', 'aria-label': shortRef(item.bookingId) },
    h('td', {}, shortRef(item.bookingId)),
    item.customerRef
      ? h('td', { title: copy().ownerOnly }, shortRef(item.customerRef))
      : ownerCell(),
    ownerCell(),
    ownerCell(),
    h('td', {}, item.slot ? formatInstant(item.slot.startsAt) : copy().unavailableCell),
    liveCell(item.bookingId),
    ownerCell(),
    h('td', {}, statusChip(item.derivedStatus)),
  );
  const open = (): void => openDetail(item.bookingId);
  tr.addEventListener('click', open);
  tr.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return tr;
}

async function load(append_: boolean): Promise<void> {
  const generation = ++state.generation;
  const rows = byId('bookingRows');
  const more = byId('bookingMore');
  const section = byId('bookings');
  section.setAttribute('aria-busy', 'true');
  if (!append_) {
    state.cursor = null;
    replace(rows, messageRow(copy().loading, true));
    replace(byId('bookingFreshness'));
  }
  replace(more);
  const window_ = periodWindow(state.period, new Date());
  const result = await listBookings({
    ...window_,
    ...(state.status ? { status: state.status } : {}),
    ...(append_ && state.cursor ? { cursor: state.cursor } : {}),
  });
  // A newer filter change superseded this request: drop its answer.
  if (generation !== state.generation) return;
  section.setAttribute('aria-busy', 'false');
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
    const message = h('td', {
      colspan: String(COLUMNS),
      class: 'state-cell',
      'data-state': result.failure,
    });
    append(message, failureMessage(result.failure));
    if (result.failure !== 'FORBIDDEN' && result.failure !== 'UNAUTHENTICATED') {
      const retry = h('button', { class: 'ghost', type: 'button' }, copy().retry);
      retry.addEventListener('click', () => void load(append_));
      append(message, ' ', retry);
    }
    if (append_) append(rows, h('tr', {}, message));
    else replace(rows, h('tr', {}, message));
    return;
  }
  const page = result.value;
  replace(byId('bookingFreshness'), ...freshnessStrip(page.freshness));
  if (!append_) replace(rows);
  if (!append_ && page.items.length === 0) replace(rows, messageRow(copy().empty));
  append(rows, ...page.items.map(row));
  void fillLive(page.items, generation);
  state.cursor = page.nextCursor;
  if (page.nextCursor) {
    const button = h(
      'button',
      { class: 'ghost', type: 'button', id: 'bookingLoadMore' },
      copy().loadMore,
    );
    button.addEventListener('click', () => void load(true));
    replace(more, button);
  }
}

export function openDetail(bookingId: string): void {
  openBookingDetail(bookingId);
}

function searchFor(value: string): void {
  const reference = bookingReference(value);
  if (reference) openDetail(reference);
  else toast(copy().searchHint);
}

export function renderFilters(): void {
  const c = copy();
  const status = byId<HTMLSelectElement>('statusFilter');
  replace(
    status,
    h('option', { value: '' }, c.allStatuses),
    ...DERIVED_STATUSES.map((s) =>
      h('option', { value: s, selected: state.status === s }, c.status[s]),
    ),
  );
  const period = byId<HTMLSelectElement>('periodFilter');
  replace(
    period,
    ...PERIODS.map((p) => h('option', { value: p, selected: state.period === p }, c.periods[p])),
  );
  byId('manualBooking').title = c.manualBookingPending;
}

export function wireBookings(next: BookingsHooks): void {
  hooks = next;
  renderFilters();
  byId<HTMLSelectElement>('statusFilter').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    state.status = isDerivedStatus(value) ? value : null;
    void load(false);
  });
  byId<HTMLSelectElement>('periodFilter').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    state.period = PERIODS.find((p) => p === value) ?? 'today';
    void load(false);
  });
  for (const id of ['bookingSearch', 'globalSearch'])
    byId<HTMLInputElement>(id).addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      // The dialog opened below focuses a button; without this, the same Enter
      // press would activate it and close the dialog at once.
      event.preventDefault();
      searchFor((event.target as HTMLInputElement).value);
    });
}

/** Reload the current page, for example after a Dispatch command changed it. */
export function refreshBookings(): Promise<void> {
  return load(false);
}

export function showBookings(): Promise<void> {
  return load(false);
}
