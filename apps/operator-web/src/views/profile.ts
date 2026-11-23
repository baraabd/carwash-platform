import { I, escape, st } from '../dom';
import { moneyHtml } from '../money';
import { S } from '../state';
import type {
  AvailabilityException,
  EquipmentIssue,
  EquipmentKind,
  EquipmentStatus,
  EquipmentView,
  ExceptionReason,
  ProfileView,
  ReadinessReason,
  WeeklyWindow,
} from '../api/types';
import type { SheetContent } from './sheets';

/**
 * PENDING OWNER DESIGN — P05-C2 additions (owner decision P05-C-D1,
 * 2026-10-10: "existing components" only). The approved technician reference
 * has no screen for readiness, verification, skills, weekly availability,
 * exceptions, service area, equipment or Billing custody. These sections are
 * composed ONLY of reference components and classes (card, setting-row,
 * menu-row, tile-icon, pill, segmented/segment, receipt/receipt-row,
 * field-label, input, sheet-error, note, btn, stats-grid/metric) and the
 * reference sprite. Each top-level block carries `data-pn="PN-xx"` so the
 * visual suite can declare it. Copy is PENDING OWNER COPY.
 */

export const READINESS_LABEL: Readonly<Record<ReadinessReason, string>> = {
  EMPLOYMENT_INACTIVE: 'الحساب غير نشط',
  SUSPENDED: 'الحساب موقوف مؤقتًا',
  VERIFICATION_REQUIRED: 'التحقق من الهوية مطلوب',
  VERIFICATION_EXPIRED: 'انتهت صلاحية التحقق',
  NO_SKILLS: 'لا توجد مهارات معتمدة',
  EQUIPMENT_UNAVAILABLE: 'معدّة مطلوبة غير متاحة',
};

const SKILL_LABEL: Readonly<Record<string, string>> = {
  'exterior-wash': 'غسيل خارجي',
  'interior-care': 'عناية داخلية',
  'full-care': 'عناية شاملة',
};

export const EQUIPMENT_LABEL: Readonly<Record<EquipmentKind, string>> = {
  SERVICE_VEHICLE: 'مركبة الخدمة',
  PRESSURE_WASHER: 'مضخة الضغط',
  WATER_SUPPLY: 'خزان المياه',
  POWER_SUPPLY: 'مصدر الكهرباء',
  VACUUM: 'المكنسة',
  CLEANING_KIT: 'عدة التنظيف',
};
const EQUIPMENT_ICON: Readonly<Record<EquipmentKind, string>> = {
  SERVICE_VEHICLE: 'van',
  PRESSURE_WASHER: 'drop',
  WATER_SUPPLY: 'drop',
  POWER_SUPPLY: 'bolt',
  VACUUM: 'work',
  CLEANING_KIT: 'work',
};
export const STATUS_LABEL: Readonly<Record<EquipmentStatus, string>> = {
  READY: 'جاهزة',
  DEGRADED: 'تعمل بمشكلة',
  UNAVAILABLE: 'غير متاحة',
};
export const ISSUE_LABEL: Readonly<Record<EquipmentIssue, string>> = {
  BREAKDOWN: 'عطل',
  MAINTENANCE: 'صيانة',
  MISSING: 'مفقودة',
  SUPPLIES_EMPTY: 'نفاد المواد',
  OTHER: 'سبب آخر',
};
export const REASON_LABEL: Readonly<Record<ExceptionReason, string>> = {
  LEAVE: 'إجازة',
  SICKNESS: 'مرض',
  EQUIPMENT: 'معدات',
  PERSONAL: 'ظرف شخصي',
  OTHER: 'أخرى',
};
/** ISO weekday -> name; the week is shown from Saturday, as used locally. */
export const WEEKDAYS: ReadonlyArray<readonly [number, string, string]> = [
  [6, 'السبت', 'س'],
  [7, 'الأحد', 'ح'],
  [1, 'الاثنين', 'ن'],
  [2, 'الثلاثاء', 'ث'],
  [3, 'الأربعاء', 'ر'],
  [4, 'الخميس', 'خ'],
  [5, 'الجمعة', 'ج'],
];
const dayName = (weekday: number): string => WEEKDAYS.find((d) => d[0] === weekday)?.[1] ?? '';

const pad = (n: number): string => String(n).padStart(2, '0');
export const clock = (minute: number): string =>
  minute === 1440 ? '24:00' : `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long' });
const dateTimeLabel = (iso: string): string =>
  new Date(iso).toLocaleString('ar-SY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function verificationText(p: ProfileView): string {
  const v = p.verification;
  if (v.status === 'VERIFIED' && v.verifiedUntil) {
    return `موثّق حتى ${escape(dateLabel(v.verifiedUntil))}`;
  }
  if (v.status === 'PENDING') return 'طلب التحقق قيد المراجعة';
  if (v.status === 'REJECTED') return 'لم يُعتمد التحقق · راجع الإدارة';
  return 'لم يُوثّق الحساب بعد';
}

function equipmentPill(e: EquipmentView): string {
  const tone = e.status === 'READY' ? 'success' : e.status === 'DEGRADED' ? 'amber' : 'danger';
  return `<span class="pill ${tone}">${STATUS_LABEL[e.status]}</span>`;
}

function scheduleSummary(p: ProfileView): string {
  const days = new Set(p.schedule.windows.map((w) => w.weekday)).size;
  if (days === 0) return 'لم تحدّد أوقات توفّرك بعد';
  return `${days} أيام في الأسبوع · ${p.schedule.windows.length} فترات`;
}

function activeExceptions(p: ProfileView): AvailabilityException[] {
  return p.exceptions.filter((e) => e.status === 'ACTIVE');
}

/** Profile additions rendered after the reference motion card (PN-01..PN-03). */
export function renderProfileSections(): string {
  const p = S.profile;
  if (!p) return '';
  const readiness = p.readiness.ready
    ? 'جاهز لاستلام مهام جديدة'
    : p.readiness.reasons.map((r) => READINESS_LABEL[r]).join(' · ');
  const skills = p.skillCodes.length
    ? p.skillCodes
        .map(
          (code) =>
            `<span class="pill">${SKILL_LABEL[code] ? escape(SKILL_LABEL[code]) : `<bdi class="ltr">${escape(code)}</bdi>`}</span>`,
        )
        .join(' ')
    : '<span class="pill neutral">لا توجد</span>';
  const extraZones = p.serviceArea.zoneIds.length - 1;
  const exceptions = activeExceptions(p);
  return `<section class="card mt" data-pn="PN-01"><div class="setting-row"><span class="tile-icon ${p.readiness.ready ? 'lime' : 'amber'}">${I(p.readiness.ready ? 'check' : 'info')}</span><div class="grow"><strong>${escape(p.displayName)}</strong><small>${escape(readiness)}</small></div></div><div class="setting-row"><span class="tile-icon">${I('shield')}</span><div class="grow"><strong>التحقق من الهوية</strong><small>${verificationText(p)}</small></div></div><div class="setting-row"><span class="tile-icon">${I('star')}</span><div class="grow"><strong>المهارات المعتمدة</strong><small>${skills}</small></div></div></section>
<section class="card mt" ${st('padding-block:2px')} data-pn="PN-02"><button class="menu-row" data-action="profile-schedule" data-focus="profile-schedule">${I('calendar')}<span class="grow"><strong>أوقات التوفّر الأسبوعية</strong><small>${escape(scheduleSummary(p))}</small></span>${I('left')}</button><button class="menu-row" data-action="profile-exceptions" data-focus="profile-exceptions">${I('flag')}<span class="grow"><strong>الإجازات والاستثناءات</strong><small>${exceptions.length ? `${exceptions.length} قادمة · أقربها ${escape(dateLabel(exceptions[0]?.startsAt ?? p.asOf))}` : 'لا توجد استثناءات قادمة'}</small></span>${I('left')}</button><div class="menu-row">${I('pin')}<span class="grow"><strong>منطقة الخدمة</strong><small>المنطقة الأساسية${extraZones > 0 ? ` و${extraZones} مناطق إضافية` : ' فقط'} · تحدّدها الإدارة</small></span></div></section>
<section class="card mt" ${st('padding-block:2px')} data-pn="PN-03">${
    p.equipment.length
      ? p.equipment
          .map(
            (e) =>
              `<button class="menu-row" data-action="profile-equipment" data-kind="${e.kind}" data-focus="equipment-${e.kind}">${I(EQUIPMENT_ICON[e.kind])}<span class="grow"><strong>${EQUIPMENT_LABEL[e.kind]}${e.required ? '' : ' <span class="muted">· اختيارية</span>'}</strong><small>${e.issue ? `${ISSUE_LABEL[e.issue]} · ` : ''}آخر تحديث ${escape(dateTimeLabel(e.updatedAt))}</small></span>${equipmentPill(e)}</button>`,
          )
          .join('')
      : `<div class="menu-row">${I('van')}<span class="grow"><strong>المعدات والمركبة</strong><small>لم تُسجّل الإدارة معدات لحسابك بعد</small></span></div>`
  }</section>`;
}

/** Weekly availability sheet: list per day, add a window, apply to the coming week. */
export function scheduleSheet(error = ''): SheetContent {
  const p = S.profile;
  if (!p) return { title: 'أوقات التوفّر', body: '' };
  const rows = WEEKDAYS.map(([weekday, name]) => {
    const windows = p.schedule.windows.filter((w) => w.weekday === weekday);
    return `<div class="receipt-row"><span>${name}</span><strong>${
      windows.length
        ? windows
            .map(
              (w) =>
                `<bdi class="ltr">${clock(w.startMinute)}–${clock(w.endMinute)}</bdi> <button class="text-btn" data-action="schedule-remove" data-weekday="${w.weekday}" data-start="${w.startMinute}" aria-label="حذف فترة ${name} ${clock(w.startMinute)}">${I('trash')}</button>`,
            )
            .join('<br>')
        : '<span class="muted">غير متاح</span>'
    }</strong></div>`;
  }).join('');
  const shifts = p.upcomingShifts.slice(0, 7);
  return {
    title: 'أوقات التوفّر الأسبوعية',
    body: `<section class="receipt">${rows}</section><p class="field-label">إضافة فترة</p><div class="segmented" role="group" aria-label="يوم الفترة">${WEEKDAYS.map(([weekday, name, short], i) => `<button class="segment" aria-pressed="${i === 0}" data-action="schedule-day" data-weekday="${weekday}" aria-label="${name}">${short}</button>`).join('')}</div><div class="row"><div class="grow"><label class="field-label" for="schedule-from">من</label><input id="schedule-from" type="time" value="08:00" step="900"></div><div class="grow"><label class="field-label" for="schedule-to">إلى</label><input id="schedule-to" type="time" value="16:00" step="900"></div></div><div id="schedule-error" class="sheet-error" ${error ? '' : 'hidden'}>${escape(error)}</div><button class="btn soft mt" data-action="schedule-add">${I('plus')}إضافة الفترة</button><button class="btn mt" data-action="schedule-apply" ${p.schedule.revision === 0 ? 'disabled' : ''}>${I('calendar')}تفعيل الأسبوع القادم في جدولك</button><p class="tiny muted mt">التفعيل ينشئ ورديات للأيام السبعة القادمة فقط، ويتخطّى الإجازات والأوقات المتداخلة.</p>${
      shifts.length
        ? `<p class="field-label">ورديات قادمة</p><section class="receipt">${shifts.map((s) => `<div class="receipt-row"><span>${escape(dateLabel(s.startsAt))}</span><strong class="ltr">${escape(new Date(s.startsAt).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }))}–${escape(new Date(s.endsAt).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }))}</strong></div>`).join('')}</section>`
        : ''
    }`,
  };
}

/** Exceptions sheet: upcoming periods with cancel, and a new full-day period. */
export function exceptionsSheet(error = ''): SheetContent {
  const p = S.profile;
  if (!p) return { title: 'الإجازات والاستثناءات', body: '' };
  const list = activeExceptions(p);
  const today = new Date();
  const localDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return {
    title: 'الإجازات والاستثناءات',
    body: `${
      list.length
        ? `<section class="receipt">${list.map((e) => `<div class="receipt-row"><span>${REASON_LABEL[e.reason]}<br><small class="muted">${escape(dateTimeLabel(e.startsAt))} ← ${escape(dateTimeLabel(e.endsAt))}</small></span><button class="text-btn" data-action="exception-cancel" data-id="${escape(e.exceptionId)}">إلغاء</button></div>`).join('')}</section>`
        : '<p class="muted">لا توجد إجازات أو استثناءات قادمة.</p>'
    }<p class="field-label">إضافة استثناء</p><div class="segmented" role="group" aria-label="سبب الاستثناء">${(Object.keys(REASON_LABEL) as ExceptionReason[]).map((reason, i) => `<button class="segment" aria-pressed="${i === 0}" data-action="exception-reason" data-reason="${reason}">${REASON_LABEL[reason]}</button>`).join('')}</div><div class="row"><div class="grow"><label class="field-label" for="exception-from">من يوم</label><input id="exception-from" type="date" value="${localDate}" min="${localDate}"></div><div class="grow"><label class="field-label" for="exception-to">حتى يوم</label><input id="exception-to" type="date" value="${localDate}" min="${localDate}"></div></div><div id="exception-error" class="sheet-error" ${error ? '' : 'hidden'}>${escape(error)}</div><button class="btn mt" data-action="exception-save">${I('check')}حفظ الاستثناء</button><p class="tiny muted mt">لا تُسند إليك مهام جديدة خلال الاستثناء. المهام المسندة سابقًا تبقى حتى تقرّر الإدارة.</p>`,
  };
}

/** Equipment status sheet for one registered item. */
export function equipmentSheet(kind: EquipmentKind): SheetContent {
  const e = S.profile?.equipment.find((x) => x.kind === kind);
  if (!e) return { title: 'المعدات', body: '<p class="muted">هذه المعدّة غير مسجّلة لحسابك.</p>' };
  const statuses = Object.keys(STATUS_LABEL) as EquipmentStatus[];
  const issues = Object.keys(ISSUE_LABEL) as EquipmentIssue[];
  return {
    title: EQUIPMENT_LABEL[kind],
    body: `<section class="receipt"><div class="receipt-row"><span>الحالة الحالية</span><strong>${equipmentPill(e)}</strong></div><div class="receipt-row"><span>مطلوبة للعمل</span><strong>${e.required ? 'نعم · تعطّلها يوقف استلام المهام' : 'لا'}</strong></div></section><p class="field-label">الحالة الآن</p><div class="segmented" role="group" aria-label="حالة المعدّة">${statuses.map((s) => `<button class="segment" aria-pressed="${s === e.status}" data-action="equipment-status" data-status="${s}">${STATUS_LABEL[s]}</button>`).join('')}</div><div id="equipment-issues" ${e.status === 'READY' ? 'hidden' : ''}><p class="field-label">السبب</p><div class="segmented" role="group" aria-label="سبب المشكلة">${issues.map((x) => `<button class="segment" aria-pressed="${x === (e.issue ?? 'BREAKDOWN')}" data-action="equipment-issue" data-issue="${x}">${ISSUE_LABEL[x]}</button>`).join('')}</div></div><button class="btn mt" data-action="equipment-save" data-kind="${kind}">${I('check')}حفظ حالة المعدّة</button>`,
  };
}

/** Billing custody figures for the collections screen (PN-04). */
export function renderCustody(): string {
  const balance = S.custody?.balances.find((b) => b.currency === 'SYP') ?? S.custody?.balances[0];
  if (!balance) return '';
  const shortage = balance.shortageOutstanding.amountMinor !== '0';
  return `<div class="stats-grid" data-pn="PN-04"><div class="metric"><small>نقد بعهدتك · لم يُسلَّم</small><strong>${moneyHtml(balance.held)}</strong></div><div class="metric"><small>قيد التسليم للشركة</small><strong>${moneyHtml(balance.inHandover)}</strong></div></div>${shortage ? `<div class="note amber mt" data-pn="PN-04">${I('info')}<span>عجز مسجّل بعد المطابقة: ${moneyHtml(balance.shortageOutstanding)}. راجع الإدارة المالية.</span></div>` : ''}`;
}

/** Window list after removing one (by weekday + start). */
export function withoutWindow(
  windows: readonly WeeklyWindow[],
  weekday: number,
  start: number,
): WeeklyWindow[] {
  return windows.filter((w) => !(w.weekday === weekday && w.startMinute === start));
}

export { dayName };
