import type { Result } from '../api/http';
import {
  bookingAssignment,
  bookingNotifications,
  newCommandKey,
  offerJob,
  ownedBooking,
  reassignJob,
  unassignJob,
  type LiveAssignment,
} from '../api/live';
import { bookingDetail } from '../api/operations';
import {
  STATUS_TONE,
  allowedCommands,
  validateOffer,
  type AssignmentCommand,
} from '../domain/assignment';
import { shortRef } from '../domain/bookings';
import { formatMoney } from '../domain/finance';
import { append, byId, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant, freshnessStrip } from './states';

/**
 * Booking detail: each section reads its OWNER and says which owner it is.
 * Booking holds the booking, Dispatch the assignment and its commands,
 * Communications the notification delivery state, Reporting only the derived
 * history. A failing owner shows its own state; the others still render.
 */
export interface DetailHooks {
  readonly unauthenticated: () => void;
  readonly canAct: () => boolean;
  /** Called after Dispatch accepted a command, so the live table refreshes. */
  readonly changed: () => void;
}

let hooks: DetailHooks = {
  unauthenticated: () => undefined,
  canAct: () => false,
  changed: () => undefined,
};

export function wireBookingDetail(next: DetailHooks): void {
  hooks = next;
}

function list(entries: readonly (readonly [string, string])[]): HTMLElement {
  const dl = h('dl', { class: 'detail-list' });
  for (const [term, value] of entries) append(dl, h('dt', {}, term), h('dd', {}, value));
  return dl;
}

function section(id: string, title: string, owner: string): HTMLElement {
  return h(
    'section',
    { class: 'detail-section', id, 'aria-labelledby': `${id}Title` },
    h(
      'div',
      { class: 'panel-head' },
      h('h3', { id: `${id}Title` }, title),
      h('span', { class: 'pill' }, owner),
    ),
    h('p', { 'aria-busy': 'true' }, copy().loading),
  );
}

function failed<T>(
  result: Result<T>,
  into: HTMLElement,
): result is Extract<Result<T>, { ok: false }> {
  if (result.ok) return false;
  if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
  const head = into.querySelector('.panel-head');
  replace(into, head, h('p', { 'data-state': result.failure }, failureMessage(result.failure)));
  return true;
}

async function fillBooking(bookingId: string, into: HTMLElement): Promise<void> {
  const c = copy();
  const result = await ownedBooking(bookingId);
  if (failed(result, into)) return;
  const b = result.value;
  replace(
    into,
    into.querySelector('.panel-head'),
    list([
      [c.bookingStatus, `${b.status} · ${b.confirmation}`],
      [c.slot, `${formatInstant(b.slotStartsAt)} – ${formatInstant(b.slotEndsAt)}`],
      [c.slotCommitted, b.slotCommitted ? c.yes : c.no],
      [c.paymentMethod, c.methods[b.paymentMethod as keyof typeof c.methods] ?? b.paymentMethod],
      [c.total, formatMoney(b.total)],
      [c.revision, String(b.revision)],
    ]),
    h('p', { class: 'muted' }, c.contactWithheld),
  );
}

async function fillNotifications(bookingId: string, into: HTMLElement): Promise<void> {
  const c = copy();
  const result = await bookingNotifications(bookingId);
  if (failed(result, into)) return;
  const head = into.querySelector('.panel-head');
  if (result.value.length === 0) {
    replace(into, head, h('p', {}, c.noNotifications));
    return;
  }
  replace(
    into,
    head,
    h(
      'div',
      { class: 'mini-list' },
      ...result.value.map((n) =>
        h(
          'div',
          { 'data-notification': n.id, 'data-delivery': n.state },
          h('span', {}, `${n.templateKey} · ${n.channel}`),
          h(
            'b',
            {},
            `${c.delivery[n.state as keyof typeof c.delivery] ?? n.state} (${n.attemptCount})`,
          ),
        ),
      ),
    ),
  );
}

async function fillDerived(bookingId: string, into: HTMLElement): Promise<void> {
  const c = copy();
  const result = await bookingDetail(bookingId);
  if (failed(result, into)) return;
  const { holds, assignments, freshness, item } = result.value;
  replace(
    into,
    into.querySelector('.panel-head'),
    h('div', { class: 'freshness-strip' }, ...freshnessStrip(freshness)),
    list([
      [c.derivedStatus, item.derivedStatus ? c.status[item.derivedStatus] : c.unavailableCell],
    ]),
    h(
      'div',
      { class: 'mini-list' },
      ...holds.map((hold) =>
        h('div', {}, h('span', {}, formatInstant(hold.startsAt)), h('b', {}, hold.state)),
      ),
      ...assignments.map((a) =>
        h(
          'div',
          {},
          h(
            'span',
            {},
            `${c.assignedAfter}: ${a.firstAssignedAt ? formatInstant(a.firstAssignedAt) : c.unavailableCell}`,
          ),
          h('b', {}, a.reassigned ? c.reassigned : c.assignmentStatus[a.status]),
        ),
      ),
    ),
  );
}

/* ------------------------------- assignment ------------------------------- */

interface Pending {
  readonly command: AssignmentCommand;
  readonly key: string;
  readonly expectedRevision: number;
  readonly resourceId: string;
  readonly technicianSubjectId: string;
}

function assignmentView(a: LiveAssignment): HTMLElement {
  const c = copy();
  return h(
    'div',
    {
      'data-assignment': a.assignmentId,
      'data-status': a.status,
      'data-revision': String(a.revision),
    },
    h('span', { class: `status ${STATUS_TONE[a.status]}` }, c.assignmentStatus[a.status]),
    list([
      [c.technician, a.resourceId ? shortRef(a.resourceId) : c.unavailableCell],
      [
        c.offer,
        a.offer
          ? `${a.offer.status} · ${shortRef(a.offer.resourceId)} · ${formatInstant(a.offer.expiresAt)}`
          : c.unavailableCell,
      ],
      [c.jobWindow, `${formatInstant(a.startsAt)} – ${formatInstant(a.endsAt)}`],
      [c.revision, String(a.revision)],
    ]),
  );
}

function input(id: string, label: string, value: string): HTMLElement {
  return h(
    'label',
    { for: id },
    label,
    h('input', { id, value, autocomplete: 'off', spellcheck: 'false', dir: 'ltr' }),
  );
}

async function fillAssignment(bookingId: string, into: HTMLElement): Promise<void> {
  const result = await bookingAssignment(bookingId);
  if (failed(result, into)) return;
  renderAssignment(into, result.value, null);
}

function renderAssignment(into: HTMLElement, a: LiveAssignment, pending: Pending | null): void {
  const c = copy();
  const head = into.querySelector('.panel-head');
  const body: Node[] = [assignmentView(a)];
  const commands = allowedCommands(a.status);
  if (!hooks.canAct()) body.push(h('p', { class: 'muted' }, c.actionsNotPermitted));
  else if (commands.length > 0) body.push(actionForm(into, a, commands, pending));
  replace(into, head, ...body);
}

function actionForm(
  into: HTMLElement,
  a: LiveAssignment,
  commands: readonly AssignmentCommand[],
  pending: Pending | null,
): HTMLElement {
  const c = copy();
  const form = h('form', {
    class: 'modal-body action-form',
    id: 'assignmentForm',
    novalidate: true,
  });
  const needsTarget = commands.some((cmd) => cmd !== 'unassign');
  if (needsTarget)
    append(
      form,
      input('offerResource', c.resourceId, pending?.resourceId ?? ''),
      input('offerTechnician', c.technicianSubject, pending?.technicianSubjectId ?? ''),
    );
  const problems = h('p', { class: 'field-error', id: 'assignmentProblems', role: 'alert' });
  const outcome = h('p', { id: 'assignmentOutcome', role: 'status', 'aria-live': 'polite' });
  append(form, problems);
  const buttons = h('div', { class: 'form-actions' });
  for (const command of commands) {
    // After an UNKNOWN outcome only the SAME command may be resent.
    const locked = pending !== null && pending.command !== command;
    const button = h(
      'button',
      {
        type: 'button',
        class: command === 'unassign' ? 'ghost' : 'primary',
        id: `assignment-${command}`,
        disabled: locked,
      },
      pending?.command === command ? c.retrySameCommand : c.commands[command],
    );
    button.addEventListener(
      'click',
      () => void submit(into, a, command, pending, problems, outcome),
    );
    append(buttons, button);
  }
  append(form, buttons, outcome);
  if (pending) append(outcome, c.unknownCommand);
  return form;
}

async function submit(
  into: HTMLElement,
  a: LiveAssignment,
  command: AssignmentCommand,
  pending: Pending | null,
  problems: HTMLElement,
  outcome: HTMLElement,
): Promise<void> {
  const c = copy();
  const resourceRaw =
    (document.getElementById('offerResource') as HTMLInputElement | null)?.value ?? '';
  const technicianRaw =
    (document.getElementById('offerTechnician') as HTMLInputElement | null)?.value ?? '';
  let target = { resourceId: '', technicianSubjectId: '' };
  if (command !== 'unassign') {
    const checked = validateOffer({ resourceId: resourceRaw, technicianSubjectId: technicianRaw });
    if (!checked.ok) {
      replace(problems, checked.problems.map((p) => c.offerProblems[p]).join(' '));
      return;
    }
    target = checked.value;
  }
  replace(problems);
  const attempt: Pending = pending ?? {
    command,
    key: newCommandKey(),
    expectedRevision: a.revision,
    ...target,
  };
  for (const button of into.querySelectorAll('button')) button.disabled = true;
  replace(outcome, c.submitting);
  const base = {
    assignmentId: a.assignmentId,
    expectedRevision: attempt.expectedRevision,
    key: attempt.key,
  };
  const offer = {
    resourceId: attempt.resourceId,
    technicianSubjectId: attempt.technicianSubjectId,
  };
  const result =
    command === 'offer'
      ? await offerJob({ ...base, offer })
      : command === 'reassign'
        ? await reassignJob({ ...base, offer })
        : await unassignJob(base);
  if (result.ok) {
    renderAssignment(into, result.value, null);
    const done = h(
      'p',
      { role: 'status', 'data-correlation': result.correlationId },
      `${c.commandDone[command]} ${c.followUp}: ${result.correlationId.slice(0, 8)}`,
    );
    append(into, done);
    toast(c.commandDone[command]);
    hooks.changed();
    return;
  }
  if (result.failure === 'UNAUTHENTICATED') hooks.unauthenticated();
  if (result.failure === 'UNKNOWN_OUTCOME') {
    // Never assume success; offer only the identical command, same key.
    renderAssignment(into, a, attempt);
    return;
  }
  if (result.failure === 'CONFLICT') {
    // The assignment moved on (newer revision, live offer, already assigned):
    // show Dispatch's current state instead of retrying blindly.
    await fillAssignment(a.bookingId, into);
    append(
      into,
      h(
        'p',
        { class: 'field-error', role: 'alert', 'data-state': 'CONFLICT' },
        c.assignmentConflict,
      ),
    );
    return;
  }
  renderAssignment(into, a, null);
  append(
    into,
    h(
      'p',
      { class: 'field-error', role: 'alert', 'data-state': result.failure },
      `${failureMessage(result.failure)} ${c.followUp}: ${result.correlationId.slice(0, 8)}`,
    ),
  );
}

/* ---------------------------------- open ---------------------------------- */

export function openBookingDetail(bookingId: string): void {
  const c = copy();
  const closeButton = h('button', { class: 'ghost', type: 'button' }, c.close);
  closeButton.addEventListener('click', closeModal);
  const booking = section('detailBooking', c.sectionBooking, c.ownerBooking);
  const assignment = section('detailAssignment', c.sectionAssignment, c.ownerDispatch);
  const notifications = section(
    'detailNotifications',
    c.sectionNotifications,
    c.ownerCommunications,
  );
  const derived = section('detailDerived', c.sectionDerived, c.ownerReporting);
  openModal({
    title: `${c.detailTitle} ${shortRef(bookingId)}`,
    body: [booking, assignment, notifications, derived],
    foot: [closeButton],
  });
  void fillBooking(bookingId, booking);
  void fillAssignment(bookingId, assignment);
  void fillNotifications(bookingId, notifications);
  void fillDerived(bookingId, derived);
  byId('modalBody').scrollTop = 0;
}
