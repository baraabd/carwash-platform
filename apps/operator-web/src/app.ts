import { newKey, type Result } from './api/client';
import {
  M,
  acceptOffer,
  readAvailability,
  readBooking,
  readJobs,
  readSession,
  readTask,
  sendMutation,
  type MutationRequest,
} from './api/operator-api';
import { P, readCustody, readProfile } from './api/profile-api';
import {
  EQUIPMENT_ISSUES,
  EQUIPMENT_KINDS,
  EQUIPMENT_STATUSES,
  EXCEPTION_REASONS,
  type BookingTechView,
  type EquipmentKind,
  type TaskView,
  type WeeklyWindow,
} from './api/types';
import { clearCache, loadCache, saveCache } from './profile-cache';
import { PENDING } from './copy';
import { $, $$, I, must, setHtml } from './dom';
import {
  checkFile,
  ensureReadUrls,
  processPhoto,
  runUpload,
  sha256Hex,
  type UploadIntent,
} from './media';
import {
  CHECKS,
  PHASE_WIRE,
  activeWork,
  buildJobs,
  cashIssue,
  checklist,
  collected,
  method,
  photos as photoSlots,
  requiredDone,
  total,
  type Job,
  type PhotoPhase,
} from './model';
import { cashMatches, declaredCash } from './money';
import { S, job, loadPreferences, ready, savePreferences, type View } from './state';
import {
  renderCollections,
  renderHeader,
  renderHome,
  renderNav,
  renderProfile,
  renderTasks,
} from './views/screens';
import {
  arrivalSheet,
  beforeViewSheet,
  breakdownSheet,
  cashSheet,
  contactSheet,
  finishSheet,
  handoffSheet,
  historySheet,
  issueSheet,
  messagePreviewSheet,
  notificationsSheet,
  photoOptionsSheet,
  resultSheet,
  taskMenuSheet,
  type IssueMode,
  type SheetContent,
} from './views/sheets';
import { renderTask, renderTaskDock } from './views/task';
import { equipmentSheet, exceptionsSheet, scheduleSheet, withoutWindow } from './views/profile';

/**
 * Controller ported from the reference IIFE: `nav`, `render`, `refresh`,
 * `updateDock`, `toast`, `showSheet`/`closeSheet` (focus trap and return),
 * `primary` (450 ms client lock), `reveal`/`setCompare`/`stopReveal`, the
 * click/input/change delegates, `popstate`, `visibilitychange`, `resize` and
 * the dock ResizeObserver. Local state transitions are replaced by server
 * mutations: nothing is shown as done until the server confirms it.
 */

const VIEWS: readonly View[] = ['home', 'tasks', 'collections', 'profile', 'task'];

let main: HTMLElement;
let header: HTMLElement;
let dock: HTMLElement;
let sheet: HTMLDialogElement;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let revealFrame: number | null = null;
let zoom = 1;
let sheetReturn: Element | null = null;
let sheetContext: { id: string | null; phase?: PhotoPhase; index?: number } | null = null;
let lock = false;
let inFlight = false;
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = (): boolean => !S.motion || reducedQuery.matches;

/** In-memory drafts of the condition note while typing (never stored on the device). */
const conditionDrafts = new Map<string, string>();
/** Booking views of the current session (memory only); dropped on 404. */
const bookings = new Map<string, BookingTechView>();

// ---------------------------------------------------------------- rendering

function updateStatus(): void {
  const el = must<HTMLElement>('#storage-warning');
  const text: Partial<Record<typeof S.connection, string>> = {
    loading: PENDING.loading,
    offline: PENDING.offline,
    unknown: PENDING.unknown,
    auth: PENDING.auth,
    forbidden: PENDING.forbidden,
    error: PENDING.error,
  };
  const cachedAt = S.profileCachedAt
    ? new Date(S.profileCachedAt).toLocaleString('ar-SY', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const connectionMessage =
    S.connection === 'offline' && cachedAt
      ? `${PENDING.offlineCached} (${cachedAt}).`
      : text[S.connection];
  // A connection state outranks the task flag: it says the flag itself may be stale.
  const flagged =
    S.connection === 'ok' &&
    S.view === 'task' &&
    job()?.task?.attentionReason === 'RESOURCE_INELIGIBLE';
  const message = flagged ? PENDING.attention : connectionMessage;
  el.hidden = !message;
  el.textContent = message ?? '';
}

function toast(text: string): void {
  clearTimeout(toastTimer);
  const el = must<HTMLElement>('#toast');
  el.textContent = text;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

function stopReveal(): void {
  if (revealFrame) {
    cancelAnimationFrame(revealFrame);
    $$('[data-action=reveal]').forEach((b) => (b.innerHTML = `${I('play')}شاهد التحوّل`));
  }
  revealFrame = null;
}

function updateDock(): void {
  const height = dock.firstElementChild?.getBoundingClientRect().height || 86;
  document.documentElement.style.setProperty('--dock', `${Math.ceil(height)}px`);
}

function render({ animate = false, back = false, scroll = false } = {}): void {
  stopReveal();
  const oldFocus = document.activeElement?.getAttribute('data-focus');
  document.documentElement.dataset.motion = S.motion ? 'on' : 'off';
  document.documentElement.dataset.view = S.view;
  setHtml(header, renderHeader());
  setHtml(
    main,
    S.view === 'home'
      ? renderHome()
      : S.view === 'tasks'
        ? renderTasks()
        : S.view === 'collections'
          ? renderCollections()
          : S.view === 'profile'
            ? renderProfile(reducedQuery.matches)
            : renderTask(),
  );
  const draft = S.selectedId ? conditionDrafts.get(S.selectedId) : undefined;
  const note = $<HTMLTextAreaElement>('#condition-note', main);
  if (note && draft !== undefined) note.value = draft;
  setHtml(dock, S.view === 'task' ? renderTaskDock() : renderNav());
  main.className = 'main' + (animate ? (back ? ' screen-back' : ' screen-enter') : '');
  updateStatus();
  updateDock();
  if (scroll) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const title = $('h1', main);
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  } else if (oldFocus) {
    const target = $$('[data-focus]').find((el) => el.dataset.focus === oldFocus);
    target?.focus({ preventScroll: true });
  }
}

const refresh = (animate = false): void => render({ animate, scroll: false });

function nav(next: string, id: string | null = null, back = false): void {
  closeSheet();
  stopReveal();
  zoom = 1;
  S.view = (VIEWS as readonly string[]).includes(next) ? (next as View) : 'home';
  S.selectedId = S.jobs.some((j) => j.id === id) ? id : null;
  if (S.view === 'task' && !S.selectedId) S.view = 'home';
  try {
    history.pushState({ washgoTech: true, view: S.view, id: S.selectedId }, '', location.href);
  } catch {
    // History is a convenience.
  }
  render({ animate: true, back, scroll: true });
}

// -------------------------------------------------------------------- sheets

function showSheet(
  content: SheetContent,
  context: { id?: string; phase?: PhotoPhase; index?: number } = {},
): void {
  stopReveal();
  if (sheet.open) sheet.close();
  sheetReturn = document.activeElement;
  sheetContext = { ...context, id: context.id ?? S.selectedId };
  must('#sheet-title').textContent = content.title;
  setHtml(must('#sheet-body'), content.body);
  sheet.showModal();
  must('#sheet-body').scrollTop = 0;
}

function closeSheet(): void {
  if (sheet.open) sheet.close();
  sheetContext = null;
  profileSheet = null;
  stopReveal();
}

const ctxJob = (): Job | undefined => S.jobs.find((x) => x.id === sheetContext?.id);

// ------------------------------------------------------------------- reading

function lostSelectedTask(): void {
  if (S.view === 'task') {
    nav('home', null, true);
    toast(PENDING.lost);
  }
}

function connectionFrom(result: Result<unknown>): typeof S.connection {
  if (result.kind === 'unknown') return 'offline';
  if (result.kind === 'error') {
    if (result.code === 'AUTH_REQUIRED' || result.status === 401) return 'auth';
    if (result.code === 'AUTH_FORBIDDEN' || result.status === 403) return 'forbidden';
    return 'error';
  }
  return 'ok';
}

/** Sequence of started reads; only the newest one may replace the screen state. */
let readSeq = 0;

/** Re-read every server fact the screens use. Nothing is guessed when a read fails. */
async function reload(): Promise<boolean> {
  const seq = (readSeq += 1);
  const [jobs, availability, profile, custody] = await Promise.all([
    readJobs(),
    readAvailability(),
    readProfile(),
    readCustody(),
  ]);
  if (seq !== readSeq) return false;
  if (jobs.kind !== 'ok') {
    S.connection = connectionFrom(jobs);
    if (S.connection === 'auth' || S.connection === 'forbidden') forgetProfile();
    updateStatus();
    return false;
  }
  if (availability.kind === 'ok') S.availability = availability.value;
  readProfileFacts(profile, custody);
  // /me/jobs carries task summaries; every listed task's detail is read from /me/tasks/:id.
  const previous = new Map(
    S.jobs.flatMap((j) => (j.task ? [[j.task.taskId, j.task] as const] : [])),
  );
  const details = await Promise.all(
    jobs.value.tasks.map(async (summary): Promise<TaskView | null> => {
      const fresh = await readTask(summary.taskId);
      if (fresh.kind === 'ok') return fresh.value;
      if (fresh.kind === 'error' && taskGone(fresh)) return null;
      // Transient failure: keep the last confirmed detail only if it is not older than the summary.
      const known = previous.get(summary.taskId);
      return known && known.revision === summary.revision ? known : null;
    }),
  );
  const tasks: TaskView[] = details.filter((t): t is TaskView => t !== null);
  const ids = new Set([
    ...jobs.value.offers.map((o) => o.job.bookingId),
    ...tasks.map((t) => t.bookingId),
  ]);
  await Promise.all(
    [...ids].map(async (bookingId) => {
      const result = await readBooking(bookingId);
      if (result.kind === 'ok') bookings.set(bookingId, result.value);
      else if (
        result.kind === 'error' &&
        (result.reason === 'BOOKING_NOT_FOUND' ||
          result.code === 'NOT_FOUND' ||
          result.code === 'AUTH_FORBIDDEN')
      )
        bookings.delete(bookingId);
      // 503 ASSIGNMENT_UNVERIFIED keeps the last view of this session (memory only) and is never treated as allow-by-default for new bookings.
    }),
  );
  for (const id of [...bookings.keys()]) if (!ids.has(id)) bookings.delete(id);
  await ensureReadUrls(
    tasks.flatMap((t) =>
      [...t.evidence.BEFORE, ...t.evidence.AFTER].flatMap((e) => (e ? [e.mediaObjectId] : [])),
    ),
  );
  if (seq !== readSeq) return false;
  const hadSelected = S.view === 'task' && S.jobs.some((j) => j.id === S.selectedId);
  S.jobs = buildJobs(jobs.value.offers, tasks, bookings);
  S.loaded = true;
  S.connection = pending.size ? 'unknown' : 'ok';
  if (hadSelected && !S.jobs.some((j) => j.id === S.selectedId)) {
    lostSelectedTask();
    return true;
  }
  updateStatus();
  return true;
}

/** Server profile/custody facts; the cache is written only from a confirmed read. */
function readProfileFacts(
  profile: Awaited<ReturnType<typeof readProfile>>,
  custody: Awaited<ReturnType<typeof readCustody>>,
): void {
  if (profile.kind === 'ok') {
    S.profile = profile.value;
    S.profileCachedAt = null;
  } else if (profile.kind === 'error' && profile.status !== 503) {
    // A definitive refusal (404 no operator profile, 403): show nothing rather than guess.
    S.profile = null;
  }
  if (custody.kind === 'ok') S.custody = custody.value;
  else if (custody.kind === 'error' && custody.status !== 503) S.custody = null;
  if (S.session && S.profile && S.profileCachedAt === null) {
    saveCache({
      subject: S.session.subject,
      savedAt: new Date().toISOString(),
      profile: S.profile,
      custody: S.custody,
    });
  }
}

function forgetProfile(): void {
  clearCache();
  S.profile = null;
  S.custody = null;
  S.profileCachedAt = null;
}

/** Offline boot or reconnect failure: show the last confirmed own profile, marked stale. */
function showCachedProfile(subject: string | null): void {
  const cached = loadCache(subject, Date.now());
  if (!cached || S.profile) return;
  S.profile = cached.profile;
  S.custody = cached.custody;
  S.profileCachedAt = cached.savedAt;
}

// ----------------------------------------------------------------- mutations

interface Intent {
  readonly id: string;
  readonly key: string;
  readonly request: MutationRequest;
  readonly done: () => void;
}

/** UNKNOWN intents survive until a definitive answer for the SAME key. */
const pending = new Map<string, Intent>();
let resolveTimer: ReturnType<typeof setTimeout> | undefined;
let resolveAttempt = 0;
const RESOLVE_BACKOFF_MS = [1_500, 4_000, 10_000];

function scheduleResolve(): void {
  clearTimeout(resolveTimer);
  const delay = RESOLVE_BACKOFF_MS[resolveAttempt];
  if (delay === undefined) return; // further retries wait for online/visibility/user action
  resolveAttempt += 1;
  resolveTimer = setTimeout(() => void resolvePending(), delay);
}

/**
 * The task is no longer this technician's (reassigned, withdrawn, ended): branch on code + reason.
 * An offer withdrawn or expired before acceptance is Dispatch `409 OFFER_NOT_LIVE` / `OFFER_EXPIRED`
 * (assignment race, P06-C).
 */
function taskGone(result: Extract<Result<unknown>, { kind: 'error' }>): boolean {
  return (
    result.reason === 'TASK_NOT_FOUND' ||
    result.reason === 'TASK_CLOSED' ||
    result.reason === 'OFFER_NOT_FOUND' ||
    result.reason === 'OFFER_NOT_LIVE' ||
    result.reason === 'OFFER_EXPIRED' ||
    (result.code === 'NOT_FOUND' && result.reason === null)
  );
}

async function handleError(result: Extract<Result<unknown>, { kind: 'error' }>): Promise<void> {
  if (result.code === 'AUTH_REQUIRED' || result.status === 401) {
    S.connection = 'auth';
    forgetProfile();
    refresh();
    return;
  }
  await reload();
  refresh();
  if (result.code === 'REVISION_CONFLICT' || result.reason === 'REVISION_CONFLICT')
    toast(PENDING.conflict);
  else if (result.reason === 'OPERATOR_NOT_ACTIVE') toast(PENDING.notActive);
  else if (result.reason === 'ZONE_OUTSIDE_SERVICE_AREA') toast(PENDING.outsideArea);
  else if (result.reason === 'EXCEPTION_OVERLAPS') toast(PENDING.exceptionOverlap);
  else if (!taskGone(result)) toast(PENDING.refused);
  reopenProfileSheet();
}

async function send(intent: Intent): Promise<'ok' | 'error' | 'unknown'> {
  const result = await sendMutation(intent.request, intent.key);
  if (result.kind === 'ok') {
    pending.delete(intent.id);
    await reload();
    intent.done();
    return 'ok';
  }
  // A retryable refusal (e.g. 503 DEPENDENCY_UNAVAILABLE) is not success either: keep the
  // intent and retry it with the same key, exactly like an UNKNOWN outcome.
  if (result.kind === 'unknown' || result.retryable) {
    pending.set(intent.id, intent);
    S.connection = 'unknown';
    toast(PENDING.unknownToast);
    await reload();
    S.connection = 'unknown';
    refresh();
    scheduleResolve();
    return 'unknown';
  }
  pending.delete(intent.id);
  await handleError(result);
  return 'error';
}

/**
 * Run one user intent. The intent id is derived from the task, the action and
 * the revision the user acted on, so pressing the same control again after an
 * UNKNOWN outcome resends the identical request with the identical key.
 */
async function mutate(
  id: string,
  build: () => MutationRequest,
  done: () => void,
): Promise<'ok' | 'error' | 'unknown' | 'busy'> {
  if (inFlight) {
    toast(PENDING.busy);
    return 'busy';
  }
  const existing = pending.get(id);
  const intent: Intent = existing ?? { id, key: newKey(), request: build(), done };
  inFlight = true;
  try {
    return await send(intent);
  } finally {
    inFlight = false;
  }
}

async function resolvePending(): Promise<void> {
  if (inFlight || (!pending.size && !stalled.size)) return;
  inFlight = true;
  let unresolved = false;
  try {
    for (const intent of [...pending.values()]) {
      const result = await sendMutation(intent.request, intent.key);
      if (result.kind === 'ok') {
        pending.delete(intent.id);
        intent.done();
      } else if (result.kind === 'error' && !result.retryable) {
        pending.delete(intent.id);
        await handleError(result);
      } else {
        unresolved = true;
      }
    }
  } finally {
    inFlight = false;
  }
  if (await resumeUploads()) unresolved = true;
  if (!unresolved) resolveAttempt = 0;
  await reload();
  refresh();
  if (unresolved) scheduleResolve();
}

const taskIntent = (t: TaskView, action: string): string => `${t.taskId}:${action}:${t.revision}`;

/** Reference `transition`: after the server confirms, close the sheet and re-enter the view. */
const advanced = (): void => {
  closeSheet();
  render({ animate: true, scroll: true });
};

// -------------------------------------------------------------- task actions

function primary(): void {
  if (lock) return;
  const j = job();
  if (!j) return;
  lock = true;
  setTimeout(() => (lock = false), 450);
  const t = j.task;
  if (j.stage === 'assigned') {
    if (!ready()) {
      toast('فعّل جاهزيتك أولًا.');
      return;
    }
    const offer = j.offer;
    if (!offer) return;
    void acceptJob(offer.offerId);
  } else if (j.stage === 'accepted' && t) {
    const busy = activeWork(S.jobs);
    if (busy && busy.id !== j.id) {
      toast('أكمل المهمة الحالية قبل بدء أخرى.');
      return;
    }
    void mutate(taskIntent(t, 'depart'), () => M.depart(t), advanced);
  } else if (j.stage === 'route') {
    showSheet(arrivalSheet(j), { id: j.id });
  } else if (j.stage === 'before' && t) {
    if (!photoSlots(j, 'before').some(Boolean) || S.photoBusy) {
      toast('أضف صورة واحدة على الأقل قبل البدء.');
      return;
    }
    void mutate(taskIntent(t, 'start'), () => M.start(t), advanced);
  } else if (j.stage === 'wash' && t) {
    if (!requiredDone(j)) {
      toast('أكمل قائمة العناية أولًا.');
      return;
    }
    void mutate(taskIntent(t, 'document'), () => M.document(t), advanced);
  } else if (j.stage === 'after') {
    if (!photoSlots(j, 'after').some(Boolean) || S.photoBusy) {
      toast('أضف صورة للنتيجة أولًا.');
      return;
    }
    showSheet(finishSheet(), { id: j.id });
  } else if (j.stage === 'handoff') closeTaskSheet(j);
}

/** Accepting creates the task server-side (existing dispatch route). */
async function acceptJob(offerId: string): Promise<void> {
  const id = `offer:${offerId}:accept`;
  if (inFlight) {
    toast(PENDING.busy);
    return;
  }
  const existing = pending.get(id);
  const key = existing?.key ?? newKey();
  inFlight = true;
  try {
    const result = await acceptOffer(offerId, key);
    const done = (): void => {
      advanced();
      toast('استلمت المهمة. ابدأ التوجّه عندما تكون جاهزًا.');
    };
    if (result.kind === 'ok') {
      pending.delete(id);
      await reload();
      done();
    } else if (result.kind === 'unknown') {
      pending.set(id, {
        id,
        key,
        request: {
          method: 'POST',
          path: `/api/operator/offers/${encodeURIComponent(offerId)}/accept`,
          body: {},
        },
        done,
      });
      toast(PENDING.unknownToast);
      await reload();
      S.connection = 'unknown';
      refresh();
      scheduleResolve();
    } else {
      pending.delete(id);
      await handleError(result);
    }
  } finally {
    inFlight = false;
  }
}

function closeTaskSheet(j: Job): void {
  if (j.stage !== 'handoff') return;
  if (method(j) === 'cash' && !collected(j) && !cashIssue(j)) {
    showCash(j);
    return;
  }
  showSheet(handoffSheet(j), { id: j.id });
}

function showCash(j: Job): void {
  if (method(j) !== 'cash' || !['handoff', 'closed'].includes(j.stage)) {
    toast('تسجيل الكاش متاح بعد اكتمال الغسيل فقط.');
    return;
  }
  if (collected(j)) {
    toast('سبق تسجيل تحصيل هذه المهمة؛ لن يُكرر.');
    return;
  }
  const content = cashSheet(j);
  if (content) showSheet(content, { id: j.id });
}

function validCash(j: Job): boolean {
  const t = total(j);
  const amount = $<HTMLInputElement>('#cash-amount')?.value ?? '';
  return !!t && cashMatches(amount, t) && !!$<HTMLInputElement>('#cash-check')?.checked;
}

function syncCash(): void {
  const j = ctxJob();
  const button = $<HTMLButtonElement>('#cash-confirm');
  if (j && button) button.disabled = !validCash(j);
}

function showIssue(mode: IssueMode, j: Job): void {
  showSheet(issueSheet(mode), { id: j.id });
}

function issueError(text: string): void {
  const error = must<HTMLElement>('#issue-error');
  error.hidden = false;
  error.textContent = text;
  must<HTMLTextAreaElement>('#issue-reason').focus();
}

function saveIssue(mode: string): void {
  const j = ctxJob();
  if (!j) return;
  const note = ($<HTMLTextAreaElement>('#issue-reason')?.value ?? '').trim().slice(0, 500);
  if (note.length < 3) {
    issueError('أضف ملاحظة واضحة من 3 أحرف على الأقل.');
    return;
  }
  const saved = (): void => {
    closeSheet();
    render({ animate: true, scroll: true });
    toast('حُفظت الملاحظة.');
  };
  const t = j.task;
  if (mode === 'defer' && j.stage === 'assigned' && j.offer) {
    const offerId = j.offer.offerId;
    void mutate(
      `offer:${offerId}:decline`,
      () => M.decline(offerId, note),
      () => {
        nav('home', null, true);
        toast('حُفظت الملاحظة.');
      },
    );
  } else if (mode === 'defer' && j.stage === 'accepted' && t) {
    void mutate(taskIntent(t, 'release'), () => M.release(t, note), saved);
  } else if (mode === 'cash' && method(j) === 'cash' && j.stage === 'handoff' && t) {
    void mutate(taskIntent(t, 'close-not-collected'), () => M.closeNotCollected(t, note), saved);
  } else if ((mode === 'help' || mode === 'payment') && t) {
    void mutate(
      `${t.taskId}:note:${mode}:${note}`,
      () => M.note(t, mode === 'help' ? 'HELP' : 'PAYMENT_FOLLOW_UP', note),
      saved,
    );
  }
}

function cashConfirm(): void {
  const j = ctxJob();
  const t = j?.task;
  const amount = j ? total(j) : null;
  if (
    !j ||
    !t ||
    !amount ||
    method(j) !== 'cash' ||
    !['handoff', 'closed'].includes(j.stage) ||
    collected(j)
  )
    return;
  if (!validCash(j)) {
    const error = must<HTMLElement>('#cash-error');
    error.hidden = false;
    error.textContent = 'اكتب المبلغ كاملًا وأكّد استلامه.';
    return;
  }
  const done = (): void => {
    closeSheet();
    render({ animate: true, scroll: true });
    toast('سُجّل التحصيل مرة واحدة.');
  };
  if (j.stage === 'handoff') {
    void mutate(
      taskIntent(t, 'close-collected'),
      () => M.closeCollected(t, declaredCash(amount)),
      done,
    );
  } else {
    void mutate(taskIntent(t, 'cash-collection'), () => M.lateCash(t, declaredCash(amount)), done);
  }
}

// --------------------------------------------------------------- evidence

const uploads = new Map<string, UploadIntent>();

async function loadLocalPhoto(
  file: File | undefined,
  phase: PhotoPhase,
  index: number,
  jid: string,
): Promise<void> {
  const j = S.jobs.find((x) => x.id === jid);
  if (!file || S.photoBusy || !j || j.stage !== phase || !j.task) return;
  const problem = checkFile(file);
  if (problem === 'type') return toast('اختر JPEG أو PNG أو WebP. HEIC وSVG غير مدعومين هنا.');
  if (problem === 'size') return toast('الصورة أكبر من 10 ميغابايت. اختر صورة أصغر.');
  if (problem === 'empty') return toast('ملف الصورة فارغ أو غير صالح.');
  S.photoBusy = true;
  const rev = S.photoRevision;
  closeSheet();
  refresh();
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await processPhoto(file);
    } catch {
      toast('تعذر قراءة الصورة. جرّب صورة JPEG أو PNG أصغر.');
      return;
    }
    const sha256 = await sha256Hex(bytes);
    const uploadId = `${j.task.taskId}:${phase}:${index}:${sha256}`;
    const intent: UploadIntent = uploads.get(uploadId) ?? {
      bytes,
      sha256,
      reserveKey: newKey(),
      finalizeKey: newKey(),
      objectId: null,
      upload: null,
      stored: false,
    };
    uploads.set(uploadId, intent);
    await uploadAndAttach({ uploadId, phase, index, jid, rev }, false);
  } finally {
    S.photoBusy = false;
    if (S.view === 'task' && S.selectedId === jid) refresh();
  }
}

/** One photo's upload + attach, identified by its `uploads` entry. */
interface PhotoUpload {
  readonly uploadId: string;
  readonly phase: PhotoPhase;
  readonly index: number;
  readonly jid: string;
  readonly rev: number;
}

/**
 * Uploads whose outcome is UNKNOWN. Like an UNKNOWN mutation they are resumed by
 * `resolvePending` (backoff, `online`, `visibilitychange`) with the same reservation
 * and Idempotency-Keys, as the UNKNOWN status promises; nothing is shown as saved before.
 */
const stalled = new Map<string, PhotoUpload>();

async function uploadAndAttach(p: PhotoUpload, resumed: boolean): Promise<'unknown' | 'settled'> {
  const intent = uploads.get(p.uploadId);
  if (!intent) return 'settled';
  const outcome = await runUpload(intent);
  if (outcome.kind === 'unknown') {
    stalled.set(p.uploadId, p);
    S.connection = 'unknown';
    if (!resumed) {
      toast(PENDING.unknownToast);
      scheduleResolve();
    }
    return 'unknown';
  }
  stalled.delete(p.uploadId);
  if (outcome.kind === 'rejected') {
    uploads.delete(p.uploadId);
    toast(PENDING.uploadRejected);
    return 'settled';
  }
  if (outcome.kind === 'failed') {
    uploads.delete(p.uploadId);
    toast(PENDING.refused);
    return 'settled';
  }
  const current = S.jobs.find((x) => x.id === p.jid);
  const task = current?.task;
  if (p.rev !== S.photoRevision || !current || current.stage !== p.phase || !task) {
    return 'settled';
  }
  S.photoBusy = false;
  const result = await mutate(
    `${task.taskId}:attach:${p.phase}:${p.index}:${outcome.objectId}`,
    () => M.attach(task, PHASE_WIRE[p.phase], p.index, outcome.objectId),
    () => {
      refresh();
      toast('تم تجهيز الصورة وحفظها.');
    },
  );
  if (result === 'ok') uploads.delete(p.uploadId);
  return 'settled';
}

/** Resume stalled uploads one at a time; true while any outcome is still UNKNOWN. */
async function resumeUploads(): Promise<boolean> {
  if (S.photoBusy) return stalled.size > 0;
  let unresolved = false;
  for (const p of [...stalled.values()]) {
    S.photoBusy = true;
    try {
      if ((await uploadAndAttach(p, true)) === 'unknown') unresolved = true;
    } finally {
      S.photoBusy = false;
    }
  }
  return unresolved;
}

// ------------------------------------------------------------------ reveal

function setCompare(input: HTMLInputElement): void {
  const value = Math.max(0, Math.min(100, Number(input.value)));
  input.closest<HTMLElement>('.compare')?.style.setProperty('--split', `${value}%`);
  input.setAttribute('aria-valuetext', `قبل ${value} بالمئة، بعد ${100 - value} بالمئة`);
}

function reveal(): void {
  const el = $('#comparison', sheet.open ? sheet : main);
  if (!el) return;
  const range = $<HTMLInputElement>('.compare-range', el);
  if (!range) return;
  const button = el.parentElement ? $('[data-action=reveal]', el.parentElement) : null;
  if (revealFrame) {
    stopReveal();
    if (button) button.innerHTML = `${I('play')}شاهد التحوّل`;
    return;
  }
  if (reduced()) {
    range.value = Number(range.value) > 50 ? '10' : '90';
    setCompare(range);
    toast('تم تغيير المقارنة دون حركة احترامًا للوضع الهادئ.');
    return;
  }
  const start = performance.now();
  if (button) button.innerHTML = `${I('pause')}إيقاف التحوّل`;
  const step = (t: number): void => {
    const progress = Math.min((t - start) / 2300, 1);
    const value = 52 - 42 * Math.sin(progress * Math.PI);
    range.value = String(Math.round(value));
    setCompare(range);
    if (progress < 1) revealFrame = requestAnimationFrame(step);
    else {
      revealFrame = null;
      if (button?.isConnected) button.innerHTML = `${I('play')}شاهد التحوّل`;
    }
  };
  revealFrame = requestAnimationFrame(step);
}

// ------------------------------------------------------------------ events

// ------------------------------------------------------- profile (P05-C2)

type ProfileSheet =
  | { readonly kind: 'schedule' | 'exceptions' }
  | { readonly kind: 'equipment'; readonly equipment: EquipmentKind };
let profileSheet: ProfileSheet | null = null;

function openProfileSheet(next: ProfileSheet, error = ''): void {
  profileSheet = next;
  showSheet(
    next.kind === 'equipment'
      ? equipmentSheet(next.equipment)
      : next.kind === 'schedule'
        ? scheduleSheet(error)
        : exceptionsSheet(error),
  );
  if (next.kind === 'schedule') pressed('schedule-day', 'weekday', String(S.sheetChoice.weekday));
  if (next.kind === 'exceptions') pressed('exception-reason', 'reason', S.sheetChoice.reason);
}

/** After a confirmed change or a refusal, show the re-read state in the same sheet. */
function reopenProfileSheet(): void {
  if (profileSheet && sheet.open) openProfileSheet(profileSheet);
}

function pressed(action: string, attr: string, value: string): void {
  for (const el of $$(`[data-action=${action}]`, sheet)) {
    el.setAttribute('aria-pressed', String(el.dataset[attr] === value));
  }
}

/**
 * Profile mutations never run offline: nothing is queued or shown as saved
 * without the server. Online, they use the same intent machinery as task
 * actions (UNKNOWN keeps the request and its key; a definitive answer resolves it).
 */
function profileMutation(id: string, build: () => MutationRequest, done: () => void): void {
  if (!S.profile || S.profileCachedAt !== null || navigator.onLine === false) {
    toast(PENDING.offlineAction);
    return;
  }
  void mutate(id, build, () => {
    done();
    refresh();
    reopenProfileSheet();
  });
}

const minuteOf = (value: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return minute >= 0 && minute <= 1440 ? minute : null;
};

function addWindow(): void {
  const p = S.profile;
  if (!p) return;
  const from = minuteOf($<HTMLInputElement>('#schedule-from', sheet)?.value ?? '');
  const toRaw = $<HTMLInputElement>('#schedule-to', sheet)?.value ?? '';
  const to = toRaw === '00:00' ? 1440 : minuteOf(toRaw);
  const weekday = S.sheetChoice.weekday;
  const clash = p.schedule.windows.some(
    (w) =>
      w.weekday === weekday &&
      from !== null &&
      to !== null &&
      from < w.endMinute &&
      w.startMinute < to,
  );
  if (from === null || to === null || to - from < 15 || clash) {
    openProfileSheet({ kind: 'schedule' }, PENDING.scheduleInvalid);
    return;
  }
  const windows: WeeklyWindow[] = [
    ...p.schedule.windows,
    { weekday, startMinute: from, endMinute: to, zoneId: p.serviceArea.homeZoneId },
  ];
  const revision = p.schedule.revision;
  profileMutation(
    `schedule:${revision}:add:${weekday}:${from}:${to}`,
    () => P.schedule(p.schedule.timeZone, windows, revision),
    () => toast('أُضيفت الفترة إلى أوقات توفّرك.'),
  );
}

function removeWindow(weekday: number, start: number): void {
  const p = S.profile;
  if (!p) return;
  const revision = p.schedule.revision;
  profileMutation(
    `schedule:${revision}:remove:${weekday}:${start}`,
    () =>
      P.schedule(p.schedule.timeZone, withoutWindow(p.schedule.windows, weekday, start), revision),
    () => toast('حُذفت الفترة.'),
  );
}

/** Tomorrow as a local calendar date (the server checks it against its time zone). */
function tomorrowLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function applySchedule(): void {
  const p = S.profile;
  if (!p || p.schedule.revision === 0) return;
  const startDate = tomorrowLocal();
  const revision = p.schedule.revision;
  profileMutation(
    `schedule-apply:${startDate}:${revision}`,
    () => P.apply(startDate, revision),
    () => toast('فُعّل الأسبوع القادم. راجع الورديات القادمة.'),
  );
}

function saveException(): void {
  const fromValue = $<HTMLInputElement>('#exception-from', sheet)?.value ?? '';
  const toValue = $<HTMLInputElement>('#exception-to', sheet)?.value ?? '';
  const parse = (v: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const from = parse(fromValue);
  const to = parse(toValue);
  const reason = S.sheetChoice.reason;
  if (!from || !to || to < from) {
    openProfileSheet({ kind: 'exceptions' }, PENDING.exceptionInvalid);
    return;
  }
  const now = new Date();
  // A period starting today starts now; it ends at the local midnight after the last day.
  const startsAt = from <= now ? now : from;
  const endsAt = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86_400_000) {
    openProfileSheet({ kind: 'exceptions' }, PENDING.exceptionInvalid);
    return;
  }
  const body = { from: fromValue, to: toValue, reason };
  const startIso =
    from <= now
      ? new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString()
      : startsAt.toISOString();
  profileMutation(
    `exception:${JSON.stringify(body)}`,
    () => P.exception(startIso, endsAt.toISOString(), reason),
    () => toast('حُفظ الاستثناء. لن تُسند إليك مهام جديدة خلاله.'),
  );
}

function saveEquipment(kind: EquipmentKind): void {
  const item = S.profile?.equipment.find((e) => e.kind === kind);
  const { status, issue } = S.sheetChoice;
  if (!item) return;
  const wanted = status === 'READY' ? null : issue;
  profileMutation(
    `equipment:${kind}:${item.revision}:${status}:${wanted ?? ''}`,
    () => P.equipment(kind, status, wanted, item.revision),
    () => toast('حُفظت حالة المعدّة.'),
  );
}

function onClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  const b = target?.closest<HTMLElement>('[data-action]');
  if (!b || (b as HTMLButtonElement).disabled) return;
  if (b.classList.contains('btn') && !reduced()) {
    const rect = b.getBoundingClientRect();
    const r = document.createElement('i');
    r.className = 'ripple';
    r.style.left = `${e.clientX ? e.clientX - rect.left : rect.width / 2}px`;
    r.style.top = `${e.clientY ? e.clientY - rect.top : rect.height / 2}px`;
    b.appendChild(r);
    setTimeout(() => r.remove(), 500);
  }
  const action = b.dataset.action;
  const j = job();
  const c = ctxJob();
  switch (action) {
    case 'home':
    case 'tasks':
    case 'collections':
    case 'profile':
      nav(action, null, S.view === 'task');
      break;
    case 'open-job':
      nav('task', b.dataset.id ?? null);
      break;
    case 'close-sheet':
      closeSheet();
      break;
    case 'ready': {
      const current = S.availability;
      if (!current) break;
      const status = current.status === 'AVAILABLE' ? 'ON_BREAK' : 'AVAILABLE';
      void mutate(
        `availability:${status}:${current.revision}`,
        () => ({
          method: 'PUT',
          path: '/api/operator/availability',
          body: { status, expectedRevision: current.revision },
        }),
        () => {
          refresh();
          toast(ready() ? 'الجاهزية مفعّلة.' : 'استراحة. المهمة التي بدأتَها تبقى متاحة.');
        },
      );
      break;
    }
    case 'motion':
      S.motion = !S.motion;
      savePreferences();
      refresh();
      toast(S.motion ? 'تم تفعيل المؤثرات مع احترام إعدادات الجهاز.' : 'تم تفعيل الوضع الهادئ.');
      break;
    case 'task-filter':
      if (
        b.dataset.value === 'active' ||
        b.dataset.value === 'done' ||
        b.dataset.value === 'follow'
      ) {
        S.taskFilter = b.dataset.value;
        savePreferences();
        refresh();
      }
      break;
    case 'filter-active':
      S.taskFilter = 'active';
      savePreferences();
      refresh();
      break;
    case 'collection-filter':
      if (b.dataset.value === 'all' || b.dataset.value === 'cash' || b.dataset.value === 'follow') {
        S.collectionFilter = b.dataset.value;
        savePreferences();
        refresh();
      }
      break;
    case 'profile-schedule':
      S.sheetChoice.weekday = 6;
      openProfileSheet({ kind: 'schedule' });
      break;
    case 'profile-exceptions':
      S.sheetChoice.reason = 'LEAVE';
      openProfileSheet({ kind: 'exceptions' });
      break;
    case 'profile-equipment': {
      const kind = EQUIPMENT_KINDS.find((k) => k === b.dataset.kind);
      const item = S.profile?.equipment.find((x) => x.kind === kind);
      if (!kind || !item) break;
      S.sheetChoice.status = item.status;
      S.sheetChoice.issue = item.issue ?? 'BREAKDOWN';
      openProfileSheet({ kind: 'equipment', equipment: kind });
      break;
    }
    case 'schedule-day':
      S.sheetChoice.weekday = Number(b.dataset.weekday);
      pressed('schedule-day', 'weekday', String(S.sheetChoice.weekday));
      break;
    case 'schedule-add':
      addWindow();
      break;
    case 'schedule-remove':
      removeWindow(Number(b.dataset.weekday), Number(b.dataset.start));
      break;
    case 'schedule-apply':
      applySchedule();
      break;
    case 'exception-reason':
      S.sheetChoice.reason = EXCEPTION_REASONS.find((r) => r === b.dataset.reason) ?? 'LEAVE';
      pressed('exception-reason', 'reason', S.sheetChoice.reason);
      break;
    case 'exception-save':
      saveException();
      break;
    case 'exception-cancel': {
      const id = b.dataset.id;
      if (!id) break;
      profileMutation(
        `exception-cancel:${id}`,
        () => P.cancelException(id),
        () => toast('أُلغي الاستثناء.'),
      );
      break;
    }
    case 'equipment-status':
      S.sheetChoice.status = EQUIPMENT_STATUSES.find((x) => x === b.dataset.status) ?? 'READY';
      pressed('equipment-status', 'status', S.sheetChoice.status);
      must<HTMLElement>('#equipment-issues').hidden = S.sheetChoice.status === 'READY';
      break;
    case 'equipment-issue':
      S.sheetChoice.issue = EQUIPMENT_ISSUES.find((x) => x === b.dataset.issue) ?? 'OTHER';
      pressed('equipment-issue', 'issue', S.sheetChoice.issue);
      break;
    case 'equipment-save': {
      const kind = EQUIPMENT_KINDS.find((k) => k === b.dataset.kind);
      if (kind) saveEquipment(kind);
      break;
    }
    case 'notifications':
      showSheet(notificationsSheet());
      break;
    case 'task-menu':
      if (j) showSheet(taskMenuSheet(j));
      break;
    case 'contact':
      if (j?.booking) showSheet(contactSheet(j));
      break;
    case 'message-preview':
      showSheet(messagePreviewSheet());
      break;
    case 'breakdown': {
      const content = j ? breakdownSheet(j) : null;
      if (content) showSheet(content);
      break;
    }
    case 'history':
      if (j) showSheet(historySheet(j));
      break;
    case 'primary':
      primary();
      break;
    case 'arrived-confirm': {
      const t = c?.task;
      if (c?.stage === 'route' && t)
        void mutate(taskIntent(t, 'arrive'), () => M.arrive(t), advanced);
      break;
    }
    case 'finish-wash-confirm': {
      const t = c?.task;
      if (c?.stage === 'after' && t && photoSlots(c, 'after').some(Boolean)) {
        void mutate(taskIntent(t, 'finish'), () => M.finish(t), advanced);
      }
      break;
    }
    case 'zoom-in':
    case 'zoom-out': {
      zoom = Math.max(1, Math.min(1.8, zoom + (action === 'zoom-in' ? 0.2 : -0.2)));
      const world = $('#map-world');
      if (world) world.style.transform = `scale(${zoom})`;
      (b as HTMLButtonElement).disabled = action === 'zoom-in' ? zoom >= 1.8 : zoom <= 1;
      const other = $<HTMLButtonElement>(
        `[data-action="${action === 'zoom-in' ? 'zoom-out' : 'zoom-in'}"]`,
      );
      if (other) other.disabled = false;
      break;
    }
    case 'photo-options': {
      const phase = b.dataset.phase;
      if (j && (phase === 'before' || phase === 'after') && j.stage === phase) {
        const index = Number(b.dataset.index);
        showSheet(photoOptionsSheet(j, phase, index), { phase, index });
      }
      break;
    }
    case 'delete-photo': {
      const phase = b.dataset.phase;
      const t = j?.task;
      const index = Number(b.dataset.index);
      if (
        j &&
        t &&
        (phase === 'before' || phase === 'after') &&
        j.stage === phase &&
        (index === 0 || index === 1)
      ) {
        void mutate(
          taskIntent(t, `detach:${phase}:${index}`),
          () => M.detach(t, PHASE_WIRE[phase], index),
          () => {
            closeSheet();
            refresh();
            toast('حُذفت الصورة.');
          },
        );
      }
      break;
    }
    case 'check': {
      const t = j?.task;
      if (j?.stage === 'wash' && t) {
        const i = Number(b.dataset.index);
        const item = checklist(j)[i];
        if (item && CHECKS[item.code]) {
          void mutate(
            taskIntent(t, `check:${item.code}`),
            () => M.check(t, item.code, !item.checked),
            () => refresh(),
          );
        }
      }
      break;
    }
    case 'before-view':
      if (j) showSheet(beforeViewSheet(j));
      break;
    case 'result-preview':
      if (j) showSheet(resultSheet(j));
      break;
    case 'reveal':
      reveal();
      break;
    case 'cash-dialog':
      if (j) showCash(j);
      break;
    case 'cash-confirm':
      cashConfirm();
      break;
    case 'close-job-confirm': {
      const t = c?.task;
      if (c?.stage === 'handoff' && t && (method(c) !== 'cash' || collected(c) || cashIssue(c))) {
        void mutate(taskIntent(t, 'close'), () => M.closeNotCash(t), advanced);
      }
      break;
    }
    case 'defer':
      if (j && ['assigned', 'accepted'].includes(j.stage)) showIssue('defer', j);
      break;
    case 'cash-issue':
      if (j && method(j) === 'cash' && j.stage === 'handoff' && !collected(j)) showIssue('cash', j);
      break;
    case 'payment-followup':
      if (j && method(j) !== 'cash' && j.task) showIssue('payment', j);
      break;
    case 'help':
      if (j && j.stage !== 'closed' && j.task) showIssue('help', j);
      break;
    case 'save-issue':
      saveIssue(b.dataset.mode ?? '');
      break;
  }
}

function onInput(e: Event): void {
  const t = e.target as HTMLElement;
  if (t.matches('.compare-range')) {
    stopReveal();
    setCompare(t as HTMLInputElement);
    const parent = t.closest('.compare')?.parentElement;
    const btn = parent ? $('[data-action=reveal]', parent) : null;
    if (btn) btn.innerHTML = `${I('play')}شاهد التحوّل`;
  }
  if (t.id === 'cash-amount') syncCash();
  if (t.dataset.input === 'condition' && S.selectedId) {
    conditionDrafts.set(S.selectedId, (t as HTMLTextAreaElement).value.slice(0, 800));
  }
}

function onChange(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.id === 'cash-check') syncCash();
  if (t.dataset.input === 'condition') {
    const j = job();
    const task = j?.task;
    const text = t.value.slice(0, 800);
    if (
      j &&
      task &&
      (task.stage === 'ARRIVED' || task.stage === 'IN_SERVICE') &&
      text !== (task.conditionNote ?? '')
    ) {
      const jid = j.id;
      void mutate(
        `${task.taskId}:condition:${task.revision}:${text}`,
        () => M.conditionNote(task, text),
        () => {
          conditionDrafts.delete(jid);
        },
      );
    }
  }
  if (t.matches('[data-upload]')) {
    const j = job();
    const phase = t.dataset.upload;
    if (!j || (phase !== 'before' && phase !== 'after')) return;
    const index =
      t.dataset.index !== undefined
        ? Number(t.dataset.index)
        : photoSlots(j, phase).findIndex((p) => !p);
    if (index < 0) {
      toast('لديك صورتان. استخدم خيارات الصورة لاستبدالها.');
      t.value = '';
      return;
    }
    void loadLocalPhoto(t.files?.[0], phase, index, j.id);
    t.value = '';
  }
}

/**
 * PRODUCTION BEHAVIOUR (P06-C, PB-01): while the page is visible the server
 * facts are re-read every 30 s, so a new offer, a reassignment, a withdrawal
 * or an eligibility flag made by operations reaches the technician without an
 * action of theirs. The re-read waits while a sheet is open, a mutation or a
 * photo is in flight, an UNKNOWN intent is pending or a text field is being
 * edited, so it never moves the screen under the user's hand. Hidden pages do
 * not poll; `visibilitychange` re-reads on return.
 */
const BACKGROUND_READ_MS = 30_000;
let backgroundTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleBackgroundRead(): void {
  clearTimeout(backgroundTimer);
  backgroundTimer = setTimeout(() => void backgroundRead(), BACKGROUND_READ_MS);
}

/** Inputs whose focus does not mean the user is typing (a chosen photo leaves focus on its input). */
const NOT_TYPING = new Set(['file', 'checkbox', 'radio', 'button', 'submit']);

function userIsBusy(): boolean {
  const active = document.activeElement;
  return (
    inFlight ||
    lock ||
    S.photoBusy ||
    pending.size > 0 ||
    stalled.size > 0 ||
    sheet.open ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && !NOT_TYPING.has(active.type))
  );
}

async function backgroundRead(): Promise<void> {
  if (!S.session || document.hidden) return;
  if (!userIsBusy() && (await reload())) refresh();
  scheduleBackgroundRead();
}

async function boot(): Promise<void> {
  const session = await readSession();
  if (session.kind !== 'ok') {
    S.connection = connectionFrom(session);
    if (S.connection === 'offline') showCachedProfile(null);
    else if (S.connection === 'auth' || S.connection === 'forbidden') forgetProfile();
    refresh();
    return;
  }
  if (!session.value.permissions.includes('work.read:assigned')) {
    S.connection = 'forbidden';
    updateStatus();
    return;
  }
  S.session = session.value;
  // A cache written for another subject is discarded here; an offline-shown one is replaced.
  if (S.profileCachedAt !== null) {
    S.profile = null;
    S.custody = null;
    S.profileCachedAt = null;
  }
  loadCache(S.session.subject, Date.now());
  if (!(await reload())) showCachedProfile(S.session.subject);
  refresh();
  scheduleBackgroundRead();
}

export function start(): void {
  main = must('#main');
  header = must('#header');
  dock = must('#dock');
  sheet = must<HTMLDialogElement>('#sheet');
  loadPreferences();
  sheet.addEventListener('close', () => {
    stopReveal();
    if (sheetReturn instanceof HTMLElement && sheetReturn.isConnected)
      sheetReturn.focus({ preventScroll: true });
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !sheet.open) return;
    const focusable = $$(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      sheet,
    ).filter(
      (el) =>
        el.getClientRects().length &&
        !el.closest('[hidden]') &&
        getComputedStyle(el).visibility !== 'hidden',
    );
    if (!focusable.length) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      e.shiftKey &&
      (document.activeElement === first || !sheet.contains(document.activeElement))
    ) {
      e.preventDefault();
      last?.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last || !sheet.contains(document.activeElement))
    ) {
      e.preventDefault();
      first?.focus();
    }
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) {
      const r = sheet.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right)
        closeSheet();
    }
  });
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopReveal();
    else if (S.session) {
      scheduleBackgroundRead();
      void resolvePending().then(() => reload().then(() => refresh()));
    }
  });
  window.addEventListener('online', () => {
    if (!S.session) {
      // Started offline: nothing was confirmed yet, so start over from the session read.
      void boot();
      return;
    }
    resolveAttempt = 0;
    void (pending.size || stalled.size ? resolvePending() : reload().then(() => refresh()));
  });
  window.addEventListener('offline', () => {
    if (S.connection === 'ok') S.connection = 'offline';
    updateStatus();
  });
  window.addEventListener('popstate', (e: PopStateEvent) => {
    closeSheet();
    const state = e.state as { view?: unknown; id?: unknown } | null;
    S.view = (VIEWS as readonly unknown[]).includes(state?.view) ? (state?.view as View) : 'home';
    S.selectedId = S.jobs.some((x) => x.id === state?.id) ? (state?.id as string) : null;
    if (S.view === 'task' && !S.selectedId) S.view = 'home';
    render({ animate: true, back: true, scroll: true });
  });
  window.addEventListener('resize', updateDock);
  reducedQuery.addEventListener?.('change', () => {
    stopReveal();
    if (S.view === 'profile') refresh();
  });
  if ('ResizeObserver' in window) new ResizeObserver(updateDock).observe(dock);
  try {
    history.replaceState({ washgoTech: true, view: 'home', id: null }, '', location.href);
  } catch {
    // History is a convenience.
  }
  render();
  void boot();
}
