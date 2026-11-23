import { I, escape, st } from '../dom';
import {
  PHASES,
  SERVICE_LABEL,
  area,
  carArt,
  carName,
  collected,
  color,
  hasExtra,
  isToday,
  method,
  minutes,
  outstanding,
  plateText,
  stageIndex,
  time,
  total,
  typeLabel,
  walletVerified,
  type Job,
} from '../model';
import { moneyHtml } from '../money';

/**
 * Shared reference fragments: `brand`, `plate`, `car`, `status`,
 * `paymentLabel`, `paymentPill`, `jobCard`, `renderStepper`, `heading`,
 * `paymentSummary`. Production edits are tagged with their declared id
 * (see docs/production/C/P03-C5-operator-web.md).
 */

export const money = (j: Job): string => {
  const t = total(j);
  return t ? moneyHtml(t) : '';
};

export function brand(): string {
  return `<div class="brand">WashGo<span>.</span><small>مساحة الفني</small></div>`;
}

/** PC-01: the plate label drops «تجريبية». The plate is optional (customer rule): absent -> no plate. */
export function plate(j: Job): string {
  const text = plateText(j);
  if (text === null) return '';
  return `<span class="plate"><small>لوحة</small><strong>${escape(text)}</strong></span>`;
}

export function car(j: Job, cls = 'mini-car'): string {
  return `<div class="${cls}" aria-hidden="true"><svg class="car-symbol" viewBox="0 0 440 210"><use href="#car-${carArt(j)}"/></svg></div>`;
}

export function status(j: Job): string {
  const names: Record<Job['stage'], string> = {
    assigned: 'جديد',
    accepted: 'تم الاستلام',
    route: 'في الطريق',
    before: 'وصلت للموقع',
    wash: 'جاري العناية',
    after: 'توثيق النتيجة',
    handoff: 'جاهز للتسليم',
    closed: j.deferred ? 'أُعيد للإدارة' : 'مكتمل',
  };
  return `<span class="pill ${j.stage === 'assigned' ? 'amber' : j.stage === 'closed' ? 'success' : ''}"><i class="light-dot"></i>${names[j.stage]}</span>`;
}

export function paymentLabel(j: Job): string {
  const m = method(j);
  if (m === 'cash') return collected(j) ? 'كاش · تم التحصيل' : 'كاش بعد الغسيل';
  return m === 'sham' ? 'شام كاش' : 'سيريتل كاش';
}

/** PC-02: «معتمد تجريبيًا» is unreachable (D9: no verification source); pending stays «قيد المراجعة». */
export function paymentPill(j: Job): string {
  const cash = method(j) === 'cash';
  return `<span class="pill ${outstanding(j) && !cash ? 'amber' : !outstanding(j) ? 'success' : ''}">${I(cash ? 'banknote' : 'shield')}${paymentLabel(j)}${!cash ? ' · ' + (walletVerified(j) ? 'معتمد' : 'قيد المراجعة') : ''}</span>`;
}

const weekday = new Intl.DateTimeFormat('ar-SY', { weekday: 'long' });

export function jobCard(j: Job, featured = false): string {
  // PENDING-D1: a job on another day shows its weekday instead of «اليوم».
  const day = isToday(j) ? 'اليوم' : escape(weekday.format(new Date(j.startsAt)));
  const head = `<div class="row between"><div><div class="job-time"><bdi>${escape(time(j))}</bdi><small>${day}</small></div><div class="job-meta"><bdi>${escape(j.ref)}</bdi> · ${minutes(j)} دقيقة للخدمة</div></div>${status(j)}</div>`;
  // DATA-GAP D10: before acceptance (and after release) Booking refuses the technician view.
  const details = j.booking
    ? `
      <div class="job-vehicle"><div><h3>${escape(carName(j))}</h3><p class="small muted">${color(j) ? `${escape(color(j))} · ` : ''}${typeLabel(j)}</p>${plate(j)}</div>${car(j)}</div>
      <div class="job-service">${I('spark', 'small')}<span>${SERVICE_LABEL}</span>${hasExtra(j) ? '<span class="pill">+ إضافة</span>' : ''}</div>
      <div class="job-footer"><div class="row between"><span class="job-location">${I('pin', 'small')}${escape(area(j))}</span><span class="job-amount">${money(j)}</span></div><div class="row between" ${st('margin-top:10px')}>${paymentPill(j)}</div></div>`
    : '';
  return `<article class="job-card ${featured ? 'featured' : ''}" aria-label="مهمة ${escape(j.ref)}">
      ${head}${details}
      <button class="btn ${featured ? '' : 'outline'}" data-action="open-job" data-id="${escape(j.id)}">${j.stage === 'assigned' ? 'تفاصيل واستلام المهمة' : j.stage === 'closed' ? 'ملخص المهمة' : 'متابعة المهمة'}${I('arrow')}</button>
    </article>`;
}

export function renderStepper(j: Job): string {
  const n = stageIndex(j);
  return `<div class="stepper"><div class="stepper-head"><span>رحلة المهمة</span><span class="ltr">${String(n + 1).padStart(2, '0')} / 06</span></div><ol class="steps">${PHASES.map((label, i) => `<li class="${i === n ? 'current' : i < n ? 'done' : ''}" ${i === n ? 'aria-current="step"' : ''}><i></i>${label}</li>`).join('')}</ol></div>`;
}

export function heading(title: string, desc: string, icon: string): string {
  return `<div class="heading"><div><h1>${title}</h1><p>${desc}</p></div><span class="tile-icon lime large">${I(icon)}</span></div>`;
}

/** PC-03: «محليًا» removed; the verified wallet branch is unreachable (D9). */
export function paymentSummary(j: Job): string {
  const cash = method(j) === 'cash';
  return `<section class="card payment-summary row"><span class="tile-icon ${outstanding(j) && !cash ? 'amber' : 'lime'}">${I(cash ? 'banknote' : 'shield')}</span><div class="grow"><h3>${paymentLabel(j)}</h3><p>${cash ? (collected(j) ? 'تم تسجيل التحصيل' : 'يُحصّل المبلغ بعد إنهاء الغسيل') : walletVerified(j) ? 'معتمد' : 'التحويل بانتظار مطابقة الإدارة'}</p></div></section>`;
}
