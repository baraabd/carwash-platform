import type {
  BookingTechView,
  CheckCode,
  EvidencePhase,
  Money,
  OfferView,
  TaskStage,
  TaskView,
} from './api/types';
import { minor, sumMoney, zeroLike } from './money';

/**
 * View model built ONLY from server reads. The reference kept the same
 * fields in localStorage (`S.jobs`); here every fact comes from Dispatch,
 * Booking and Workforce and nothing authoritative is cached on the device.
 */

/** Reference `STAGES`. */
export const STAGES = [
  'assigned',
  'accepted',
  'route',
  'before',
  'wash',
  'after',
  'handoff',
  'closed',
] as const;
export type RefStage = (typeof STAGES)[number];

/** Reference `PHASES`. */
export const PHASES = ['المهمة', 'الطريق', 'قبل الغسيل', 'العناية', 'بعد الغسيل', 'التسليم'];

/** C4 stage mapping; `RELEASED` is the reference's deferred close. */
const TASK_TO_REF: Partial<Record<TaskStage, RefStage>> = {
  ACCEPTED: 'accepted',
  EN_ROUTE: 'route',
  ARRIVED: 'before',
  IN_SERVICE: 'wash',
  DOCUMENTING: 'after',
  FINISHED: 'handoff',
  CLOSED: 'closed',
  RELEASED: 'closed',
};

export type Method = 'cash' | 'sham' | 'syriatel';

export interface Job {
  /** Stable key across offer -> task: the booking id. */
  readonly id: string;
  readonly ref: string;
  readonly offer: OfferView | null;
  readonly task: TaskView | null;
  readonly booking: BookingTechView | null;
  readonly stage: RefStage;
  readonly deferred: boolean;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Reference `CHECKS`, keyed by the C4 checklist snapshot codes. */
export const CHECKS: Readonly<Record<CheckCode, { name: string; desc: string; icon: string }>> = {
  exterior: { name: 'الهيكل والزجاج', desc: 'تنظيف الخارج وإزالة آثار الماء', icon: 'drop' },
  wheels: { name: 'الجنوط والإطارات', desc: 'تنظيف الزوايا والتأكد من النتيجة', icon: 'wheel' },
  interior: { name: 'المقصورة الداخلية', desc: 'المقاعد والأسطح والأرضيات', icon: 'seat' },
  quality: {
    name: 'فحص الجودة النهائي',
    desc: 'مراجعة اللمعة وتجهيز السيارة للتسليم',
    icon: 'spark',
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DATA-GAP D1: C3 has no human booking reference; a short form of the id is shown. */
export const shortRef = (bookingId: string): string =>
  UUID.test(bookingId) ? bookingId.slice(0, 8).toUpperCase() : bookingId;

export function buildJobs(
  offers: readonly OfferView[],
  tasks: readonly TaskView[],
  bookings: ReadonlyMap<string, BookingTechView>,
): Job[] {
  const jobs = new Map<string, Job>();
  for (const offer of offers) {
    if (offer.status !== 'OFFERED') continue;
    const id = offer.job.bookingId;
    jobs.set(id, {
      id,
      ref: shortRef(id),
      offer,
      task: null,
      booking: bookings.get(id) ?? null,
      stage: 'assigned',
      deferred: false,
      startsAt: offer.job.startsAt,
      endsAt: offer.job.endsAt,
    });
  }
  for (const task of tasks) {
    const stage = TASK_TO_REF[task.stage];
    if (!stage) continue; // WITHDRAWN / CANCELLED are not the technician's work any more.
    const id = task.bookingId;
    jobs.set(id, {
      id,
      ref: shortRef(id),
      offer: null,
      task,
      booking: bookings.get(id) ?? null,
      stage,
      deferred: task.stage === 'RELEASED',
      startsAt: task.startsAt,
      endsAt: task.endsAt,
    });
  }
  return [...jobs.values()].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
  );
}

export const stageIndex = (j: Job): number =>
  ({ assigned: 0, accepted: 0, route: 1, before: 2, wash: 3, after: 4, handoff: 5, closed: 5 })[
    j.stage
  ];

const hhmm = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export const time = (j: Job): string => hhmm.format(new Date(j.startsAt));
export const minutes = (j: Job): number =>
  Math.max(0, Math.round((Date.parse(j.endsAt) - Date.parse(j.startsAt)) / 60_000));

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const isToday = (j: Job): boolean => dayKey(new Date(j.startsAt)) === dayKey(new Date());

export const vehicleType = (j: Job): string => j.booking?.vehicle.type ?? 'sedan';
/** Reference art exists for sedan/suv/pickup; `large` uses the large-car (suv) art. */
export const carArt = (j: Job): string => {
  const type = vehicleType(j);
  return type === 'large' ? 'suv' : type;
};
export const typeLabel = (j: Job): string => (vehicleType(j) === 'sedan' ? 'سيدان' : 'سيارة كبيرة');
export const carName = (j: Job): string => {
  const v = j.booking?.vehicle;
  const name = [v?.make, v?.model].filter((x): x is string => !!x && !!x.trim()).join(' ');
  return name || typeLabel(j);
};
export const color = (j: Job): string | null => j.booking?.vehicle.color ?? null;
export const plateText = (j: Job): string | null => j.booking?.vehicle.plate?.text ?? null;

/** Customer location description is the reference "area"; address details are the reference "address". */
export const area = (j: Job): string => j.booking?.address.location.description ?? '';
export const address = (j: Job): string => j.booking?.address.details ?? area(j);
export const customer = (j: Job): string => j.booking?.contact.name ?? '';
export const customerNote = (j: Job): string | null => j.booking?.contact.notes ?? null;

/** DATA-GAP D2: C3 lines carry no display names; reference generic labels are used. */
export const SERVICE_LABEL = 'الخدمة';
export const EXTRA_LABEL = 'الإضافات';

export const total = (j: Job): Money | null => j.booking?.total ?? null;
export function extras(j: Job): Money | null {
  const b = j.booking;
  if (!b) return null;
  return sumMoney(
    b.lines.filter((l) => l.kind === 'EXTRA').map((l) => l.amount),
    b.total,
  );
}
export const hasExtra = (j: Job): boolean => {
  const e = extras(j);
  return !!e && minor(e) !== 0n;
};
export function base(j: Job): Money | null {
  const t = total(j);
  const e = extras(j);
  if (!t || !e) return null;
  return { currency: t.currency, scale: t.scale, amountMinor: (minor(t) - minor(e)).toString() };
}
export const zeroOf = (j: Job): Money | null => (j.booking ? zeroLike(j.booking.total) : null);

export function method(j: Job): Method | null {
  switch (j.booking?.paymentMethod) {
    case 'CASH_ON_COMPLETION':
      return 'cash';
    case 'SHAM_CASH':
      return 'sham';
    case 'SYRIATEL_CASH':
      return 'syriatel';
    default:
      return null;
  }
}

/** Cash declared by the technician (on close or later). A declaration, not a Billing receipt. */
export const collected = (j: Job): boolean => {
  const c = j.task?.collection;
  return method(j) === 'cash' && !!c && (c.outcome === 'CASH_COLLECTED' || c.lateAmount !== null);
};

/**
 * DATA-GAP D9: no C5 route exposes Billing's payment verification. A wallet
 * payment is therefore never shown as verified; it stays the reference's
 * "pending review" state (outstanding).
 */
export const walletVerified = (j: Job): boolean => {
  void j;
  return false;
};

export const outstanding = (j: Job): boolean =>
  method(j) === 'cash' ? !collected(j) : !walletVerified(j);

export const cashIssue = (j: Job): string => {
  const c = j.task?.collection;
  return c && c.outcome === 'CASH_NOT_COLLECTED' && !collected(j) ? (c.reason ?? '') : '';
};

/** Reference `j.issue` (help / payment follow-up note text). */
export const issue = (j: Job): string => {
  const notes =
    j.task?.notes.filter((n) => n.kind === 'HELP' || n.kind === 'PAYMENT_FOLLOW_UP') ?? [];
  return notes.length ? (notes[notes.length - 1]?.text ?? '') : '';
};

export const activeWork = (jobs: readonly Job[]): Job | undefined =>
  jobs.find((j) => ['route', 'before', 'wash', 'after', 'handoff'].includes(j.stage));

export type PhotoPhase = 'before' | 'after';
export const PHASE_WIRE: Readonly<Record<PhotoPhase, EvidencePhase>> = {
  before: 'BEFORE',
  after: 'AFTER',
};

export const photos = (j: Job, phase: PhotoPhase): readonly [string | null, string | null] => {
  const slots = j.task?.evidence[PHASE_WIRE[phase]];
  return [slots?.[0]?.mediaObjectId ?? null, slots?.[1]?.mediaObjectId ?? null];
};

export const checklist = (j: Job) => j.task?.checklist.items ?? [];
export const checkedCount = (j: Job): number => checklist(j).filter((x) => x.checked).length;
export const requiredDone = (j: Job): boolean =>
  checklist(j).every((x) => !x.required || x.checked);

/**
 * C4 `history[].action` vocabulary (provider fact, P03-C4; unlisted actions are not shown),
 * mapped to the reference's own history texts with trial qualifiers removed.
 * Checklist/condition-note updates were never shown in the reference history.
 */
export const HISTORY_TEXT: Readonly<Record<string, string>> = {
  accepted: 'استلام المهمة',
  departed: 'بدء التوجّه',
  arrived: 'تأكيد الوصول',
  'evidence.before.attached': 'إضافة صورة قبل الغسيل',
  'evidence.after.attached': 'إضافة صورة بعد الغسيل',
  'evidence.before.removed': 'حُذفت الصورة',
  'evidence.after.removed': 'حُذفت الصورة',
  started: 'بدء الغسيل بعد توثيق الحالة',
  documented: 'اكتمال قائمة العناية',
  finished: 'انتهاء الغسيل · الدفع مستقل',
  closed: 'تأكيد التسليم وإغلاق المهمة',
  'cash.late-declared': 'تسجيل استلام الكاش كاملًا',
  released: 'طلب إعادة إسناد',
  'note.help': 'ملاحظة للمتابعة',
  'note.payment-follow-up': 'ملاحظة للمتابعة',
  'note.cash-issue': 'ملاحظة للمتابعة',
};

export const historyEvents = (j: Job): { text: string; at: string }[] =>
  (j.task?.history ?? []).flatMap((h) => {
    const text = HISTORY_TEXT[h.action];
    return text ? [{ text, at: h.at }] : [];
  });
