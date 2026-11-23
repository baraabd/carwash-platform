import { I, escape, st } from '../dom';
import { PENDING } from '../copy';
import {
  CHECKS,
  EXTRA_LABEL,
  SERVICE_LABEL,
  activeWork,
  address,
  area,
  carName,
  cashIssue,
  checkedCount,
  checklist,
  collected,
  color,
  customer,
  customerNote,
  hasExtra,
  isToday,
  issue,
  method,
  minutes,
  outstanding,
  photos as photoSlots,
  plateText,
  requiredDone,
  time,
  total,
  typeLabel,
  walletVerified,
  type Job,
  type PhotoPhase,
} from '../model';
import { S, job, ready } from '../state';
import { car, heading, money, paymentLabel, paymentSummary, plate, renderStepper } from './common';

/**
 * Reference task views: `details`, `mapMarkup`, `route`, `photoMarkup`,
 * `photos`, `wash`, `comparison`, `handoff`, `completed`, `renderTask`,
 * `renderTaskDock`. Same DOM, classes, ids and data-action values.
 */

const weekday = new Intl.DateTimeFormat('ar-SY', { weekday: 'long' });
const dayLabel = (j: Job): string =>
  isToday(j) ? 'اليوم' : escape(weekday.format(new Date(j.startsAt)));

function scheduleRow(j: Job, first: boolean): string {
  // PC-18: «للتجربة،» removed.
  return `<div class="detail-row"${first ? ` ${st('padding-top:0')}` : ''}><span class="tile-icon">${I('calendar')}</span><div class="grow"><strong>${dayLabel(j)} · <bdi>${escape(time(j))}</bdi></strong><p>موعد مجدول، وليس طلب وصول فوري</p></div></div>`;
}

export function details(j: Job): string {
  const head = heading(
    j.stage === 'accepted' ? 'جاهز للانطلاق؟' : 'مهمة جديدة، لمعة جديدة.',
    j.stage === 'accepted'
      ? 'استلمت المهمة. ابدأ التوجّه عندما تكون جاهزًا.'
      : 'راجع التفاصيل قبل استلام المهمة المسندة إليك.',
    'work',
  );
  if (!j.booking) {
    // DATA-GAP D10 / PENDING OWNER DESIGN: Booking refuses the view before acceptance.
    return `${head}
    <section class="card">${scheduleRow(j, true)}</section><div class="note mt">${I('info')}<span>${PENDING.bookingUnavailable}</span></div>`;
  }
  const note = issue(j);
  const plateValue = plateText(j);
  const instruction = customerNote(j);
  return `${head}
    ${note ? `<div class="note amber" ${st('margin-bottom:14px')}>${I('flag')}<span>ملاحظة محفوظة: ${escape(note)}</span></div>` : ''}
    <section class="vehicle-showcase"><div class="row between"><span class="pill">${typeLabel(j)}${color(j) ? ` · ${escape(color(j))}` : ''}</span>${plate(j)}</div>${car(j, 'big-car')}<div class="row between"><div><h2>${escape(carName(j))}</h2>${plateValue !== null ? '<p class="tiny muted">تأكد من اللوحة عند الوصول</p>' : ''}</div><span class="tile-icon">${I('car')}</span></div></section>
    <section class="card mt"><div class="detail-row" ${st('padding-top:0')}><span class="tile-icon">${I('spark')}</span><div class="grow"><strong>${SERVICE_LABEL}</strong><p>${minutes(j)} دقيقة تقديرية</p></div><strong>${money(j)}</strong></div>${hasExtra(j) ? `<div class="detail-row"><span class="tile-icon">${I('plus')}</span><div class="grow"><strong>${EXTRA_LABEL}</strong><p>مشمولة في إجمالي الطلب</p></div></div>` : ''}<div class="detail-row"><span class="tile-icon">${I('pin')}</span><div class="grow"><strong>${escape(area(j))}</strong><p>${escape(address(j))}</p></div></div>${scheduleRow(j, false)}<div class="detail-row"><span class="tile-icon">${I('user')}</span><div class="grow"><strong>${escape(customer(j))}</strong></div><button class="icon-button" data-action="contact" aria-label="خيارات التواصل">${I('phone')}</button></div>${instruction ? `<p class="customer-note">${escape(instruction)}</p>` : ''}</section>
    <div class="mt">${paymentSummary(j)}</div><section class="card mt" ${st('padding-block:1px')}><button class="menu-row" data-action="breakdown">${I('receipt-pay')}<span class="grow"><strong>تفاصيل المبلغ</strong><small>قيمة الطلب، وليست أرباح الفني.</small></span>${I('left')}</button><button class="menu-row" data-action="history">${I('history')}<span class="grow"><strong>سجل المهمة</strong></span>${I('left')}</button></section>`;
}

/** Reference `mapMarkup`. Still an illustration (TI-D11). PC-20: bubble trial line removed. */
export function mapMarkup(): string {
  return `<div class="map" aria-label="خريطة توضيحية لا تعتمد عليها للملاحة"><div class="map-world" id="map-world"><svg viewBox="0 0 390 270" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><pattern id="map-blocks" width="80" height="65" patternUnits="userSpaceOnUse"><rect width="80" height="65" fill="#eaf0e2"/><rect x="6" y="6" width="59" height="43" rx="6" fill="#dfe7d4"/><path d="M0 58h80M73 0v65" stroke="#fff" stroke-width="9"/></pattern></defs><rect width="390" height="270" fill="url(#map-blocks)"/><path d="M-30 70q200 130 440 78" fill="none" stroke="#fafcf6" stroke-width="21"/><path d="M120 -20 190 285" stroke="#fcfdf8" stroke-width="18"/><path d="M70 212h82l-21-82h142l-9-56" fill="none" stroke="#d5f6a6" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><path d="M70 212h82l-21-82h142l-9-56" fill="none" stroke="#285c40" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 7"/><circle cx="70" cy="212" r="15" fill="#244f38" stroke="#f3ffe6" stroke-width="4"/><path d="m63 214 7-12 7 12-7-3Z" fill="#dbffac"/><circle cx="264" cy="74" r="29" fill="#c8e5a566"/><path d="M264 49c-12 0-21 8-21 20 0 15 21 35 21 35s21-20 21-35c0-12-9-20-21-20" fill="#224e37" stroke="#f2fadd" stroke-width="3"/><circle cx="264" cy="69" r="6" fill="#d9faab"/></svg></div><span class="map-label">خريطة توضيحية · ليست ملاحة</span><div class="map-zoom"><button class="icon-button" data-action="zoom-in" aria-label="تكبير الخريطة التوضيحية">${I('plus')}</button><button class="icon-button" data-action="zoom-out" aria-label="تصغير الخريطة التوضيحية">${I('minus')}</button></div><div class="map-bubble">${I('pin')}<div>موقع العميل</div></div></div>`;
}

/** Reference `route`. PR-13 illustrative ETA/distance metrics removed (D7); PC-21. */
export function route(j: Job): string {
  const instruction = customerNote(j);
  return `${heading('في الطريق إلى اللمعة.', 'حدّث حالة الوصول بعد التوقف بأمان.', 'route')}${mapMarkup()}<section class="card mt"><div class="detail-row" ${st('padding-top:0')}><span class="tile-icon">${I('pin')}</span><div><strong>${escape(area(j))}</strong><p>${escape(address(j))}</p></div></div>${instruction ? `<p class="customer-note">${escape(instruction)}</p>` : ''}<button class="btn outline mt" data-action="contact">${I('phone')}التواصل مع العميل</button></section><div class="note mt">${I('info')}<span>لن يُفتح مسار حقيقي أو تُرسل إحداثيات.</span></div>`;
}

export const photoUrl = (objectId: string | null): string | null => {
  if (!objectId) return null;
  return S.mediaUrls.get(objectId)?.url ?? null;
};

/** Reference `photoMarkup` for a server evidence object (short-lived read URL). */
export function photoMarkup(objectId: string | null, phase: PhotoPhase): string {
  const url = photoUrl(objectId);
  if (!url) return '';
  return `<img src="${escape(url)}" alt="${phase === 'before' ? 'قبل' : 'بعد'} الغسيل · صورة من الجهاز">`;
}

/** Reference `photos`. PC-22 photo label, PR-14 demo button, PC-23, PC-24. */
export function photos(j: Job, phase: PhotoPhase): string {
  const slots = photoSlots(j, phase);
  const count = slots.filter(Boolean).length;
  const before = phase === 'before';
  const busy = S.photoBusy;
  return `${heading(before ? 'قبل اللمعة.' : 'دع النتيجة تتحدث.', before ? 'وثّق حالة السيارة. صورة واحدة على الأقل للمتابعة.' : 'أعد التصوير من الزاوية نفسها لمقارنة أوضح.', 'camera')}
    <div class="row between" ${st('margin-bottom:13px')}><strong class="small">${before ? 'صور قبل الغسيل' : 'صور بعد الغسيل'}</strong><span class="pill ${count ? 'success' : 'neutral'}">${count} / 2 صور</span></div>
    <div class="photo-grid">${[0, 1]
      .map((index) => {
        const p = slots[index] ?? null;
        return `<div class="photo-card"><div class="photo-frame">${p ? photoMarkup(p, phase) : `<div class="photo-placeholder">${I('camera')}<span>${index ? 'زاوية إضافية' : 'الزاوية الرئيسية'}</span></div>`}${p ? `<span class="photo-badge">${I('check')}</span>` : ''}</div><div class="photo-controls"><span><strong>${index ? 'زاوية إضافية' : 'الزاوية الرئيسية'}</strong><small>${index ? 'اختيارية' : 'صورة واحدة تكفي'}</small></span><button class="icon-button" data-action="photo-options" data-phase="${phase}" data-index="${index}" aria-label="${p ? 'خيارات صورة' : 'إضافة صورة'} ${index + 1} ${before ? 'قبل' : 'بعد'} الغسيل">${I(p ? 'more' : 'plus')}</button></div></div>`;
      })
      .join('')}</div>
    <label class="upload mt ${busy ? 'processing' : ''}"><input class="input-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-upload="${phase}" ${busy ? 'disabled' : ''}>${I('camera')}<span><strong>${busy ? 'جارٍ تجهيز الصورة…' : 'التقط صورة أو اختر من الجهاز'}</strong><small>JPEG · PNG · WebP — حتى 10 ميغابايت</small></span></label>
    <div class="note mt">${I('shield')}<span>استأذن العميل قبل التصوير وتجنب الوجوه والمارة.</span></div>
    ${before ? `<label class="field-label" for="condition-note">ملاحظة عن حالة السيارة <span class="muted">· اختياري</span></label><textarea id="condition-note" data-input="condition" placeholder="مثلًا: خدش موجود مسبقًا على الباب…" maxlength="800">${escape(j.task?.conditionNote ?? '')}</textarea>` : count && photoSlots(j, 'before').some(Boolean) ? `<div class="section-title"><h2>لمعتك في مقارنة</h2><span class="tiny muted">اسحب الفاصل</span></div>${comparison(j)}` : ''}`;
}

/** Reference `wash`/`checkList`: items come from the task's checklist snapshot (C4). */
export function wash(j: Job): string {
  const items = checklist(j);
  const done = checkedCount(j);
  const ratio = items.length ? done / items.length : 0;
  return `${heading('كل تفصيلة، بعناية.', 'أنجز القائمة ثم وثّق النتيجة. لا تعتمد على مؤقّت وحده.', 'spark')}<section class="progress-card row between" ${st(`--percent:${ratio * 100}%`)}><div><h2>${SERVICE_LABEL}</h2><p>${done} من ${items.length} خطوات تم تأكيدها</p><span class="timer-label">${I('clock', 'small')}<span>${minutes(j)} دقيقة للخدمة · تقديري</span></span></div><div class="progress-ring"><strong>${Math.round(ratio * 100)}<small>%</small></strong></div></section><div class="section-title"><h2>قائمة العناية</h2><small>اضغط بعد الإنجاز</small></div><ul class="checklist">${items
    .map((item, index) => {
      const meta = CHECKS[item.code];
      return `<li><button class="check-button ${item.checked ? 'checked' : ''}" role="checkbox" aria-checked="${item.checked}" data-action="check" data-index="${index}" data-focus="check-${index}"><span class="check-circle">${I('check')}</span><span class="grow"><strong>${meta.name}</strong><small>${meta.desc}</small></span><span class="task-icon">${I(meta.icon)}</span></button></li>`;
    })
    .join(
      '',
    )}</ul>${hasExtra(j) ? `<div class="note mt">${I('plus')}<span><strong>${EXTRA_LABEL}</strong><br>لا تنس الإضافة المتفق عليها.</span></div>` : ''}<button class="text-btn full mt" data-action="before-view">${I('image')}عرض صور الحالة قبل الغسيل</button>`;
}

/** Reference `comparison`: first available before and after evidence. PC-25. */
export function comparison(j: Job): string {
  const before = photoSlots(j, 'before').find(Boolean) ?? null;
  const after = photoSlots(j, 'after').find(Boolean) ?? null;
  if (!before || !after) return '<div class="note">لا توجد صورتان للمقارنة في هذه المهمة.</div>';
  return `<div class="compare" id="comparison" ${st('--split:52%')}><div class="scene-layer after">${photoMarkup(after, 'after')}</div><div class="scene-layer before">${photoMarkup(before, 'before')}</div><span class="compare-label before">قبل</span><span class="compare-label after">بعد</span><div class="compare-divider"><div class="compare-handle">${I('left', 'small')}${I('right', 'small')}</div></div><label class="sr" for="compare-range">حرك الفاصل لمقارنة قبل الغسيل وبعده</label><input class="compare-range" id="compare-range" type="range" min="0" max="100" value="52" dir="ltr" aria-valuetext="قبل 52 بالمئة، بعد 48 بالمئة"></div><div class="compare-caption"><span>صورتان من جهازك</span><button class="text-btn" data-action="reveal">${I('play')}شاهد التحوّل</button></div>`;
}

/** Reference `handoff`. PC-29..PC-31; wallet verification unreachable (D9). */
export function handoff(j: Job): string {
  if (method(j) === 'cash') {
    const c = collected(j);
    const reason = cashIssue(j);
    return `${heading(c ? 'وصل المبلغ، بقي التسليم.' : 'اللمعة اكتملت. وقت التسليم.', c ? 'تم تسجيل استلام الكاش. يمكنك الآن إغلاق المهمة.' : 'تأكد من تسليم السيارة ثم سجّل التحصيل أو تعذّره.', 'banknote')}<section class="cash-hero"><span class="tile-icon lime">${I(c ? 'check' : 'banknote')}</span><p>${c ? 'كاش مسجّل' : 'المبلغ المطلوب بعد الغسيل'}</p><strong class="amount">${money(j)}</strong><p>قيمة الطلب كاملة · وليست أرباح الفني</p><span class="pill ${c ? 'success' : ''}">${c ? 'تم التحصيل' : 'لم يُسجّل التحصيل بعد'}</span></section><section class="receipt mt"><div class="receipt-row"><span>السيارة</span><strong>${escape(carName(j))}</strong></div><div class="receipt-row"><span>المهمة</span><strong class="ltr">${escape(j.ref)}</strong></div><div class="receipt-row"><span>الخدمة</span><strong>اكتمل الغسيل</strong></div><div class="receipt-row"><span>الدفع</span><strong>${c ? 'كاش مسجّل' : reason ? 'متابعة تحصيل مطلوبة' : 'بانتظار استلام الكاش'}</strong></div></section>${reason ? `<div class="note amber mt">${I('flag')}<span>سبب عدم التحصيل: ${escape(reason)}.</span></div>` : ''}<div class="note mt">${I('shield')}<span>اكتمال الغسيل لا يُثبت استلام النقود. سجّل التحصيل فقط بعد الاستلام.</span></div><button class="text-btn full mt" data-action="result-preview">${I('image')}عرض صور قبل وبعد</button>`;
  }
  const pending = !walletVerified(j);
  return `${heading('الخدمة مكتملة، والدفع مستقل.', pending ? 'التحويل قيد المراجعة؛ الفني لا يعتمد مدفوعات المحافظ.' : 'معتمد', 'shield')}<section class="cash-hero" ${st(`background:${pending ? '#fbf4e4' : '#e8f3da'}`)}><span class="tile-icon ${pending ? 'amber' : 'lime'}">${I(pending ? 'clock' : 'check')}</span><p>${paymentLabel(j)}</p><strong class="amount">${money(j)}</strong><span class="pill ${pending ? 'amber' : 'success'}">${pending ? 'بانتظار مطابقة الإدارة' : 'معتمد'}</span></section><div class="note ${pending ? 'amber' : ''} mt">${I('info')}<span>${pending ? 'لا تطلب تحويلًا جديدًا أو كاشًا بدلًا منه قبل مراجعة الإدارة؛ قد يكون العميل قد دفع فعلًا. إغلاق المهمة لن يحوّل الدفع إلى «مدفوع».' : 'الفني يعرض الحالة فقط.'}</span></div>${pending ? `<button class="btn soft mt" data-action="payment-followup">${I('message')}تسجيل ملاحظة لمتابعة الدفع</button>` : ''}<button class="text-btn full mt" data-action="result-preview">${I('image')}عرض صور قبل وبعد</button>`;
}

/** Reference `completed`. RELEASED is the deferred variant. PC-26, PC-27, PC-32..34, PR-15. */
export function completed(j: Job): string {
  if (j.deferred) {
    return `${heading('أُعيدت المهمة للجدول.', '', 'history')}<div class="note amber">${I('info')}<span>لم يُنفذ الغسيل ولم يُسجّل تحصيل. أُخفيت المهمة من القائمة النشطة.</span></div><button class="btn outline mt" data-action="history">عرض سجل المهمة</button>`;
  }
  const cash = method(j) === 'cash';
  const c = collected(j);
  return `<section class="center" ${st('padding:15px 0 17px')}><div class="success-art">${I('check')}</div><span class="pill success">اكتملت المهمة</span><h1 ${st('margin:12px 0 7px')}>لمعة تستحق المشاهدة.</h1><p class="small muted">${escape(carName(j))} · ${SERVICE_LABEL}</p></section>${comparison(j)}<section class="receipt mt"><div class="receipt-row"><span>المهمة</span><strong class="ltr">${escape(j.ref)}</strong></div><div class="receipt-row"><span>قيمة الخدمة</span><strong>${money(j)}</strong></div><div class="receipt-row"><span>حالة الغسيل</span><strong>مكتمل</strong></div><div class="receipt-row"><span>حالة الدفع</span><strong>${cash ? (c ? 'تم التحصيل' : 'لم يُحصّل · للمتابعة') : walletVerified(j) ? 'معتمد' : 'قيد المراجعة'}</strong></div></section>${outstanding(j) ? `<div class="note amber mt">${I('clock')}<span>الخدمة مكتملة لكن الدفع ما زال للمتابعة. لا تُحسب هذه المهمة ضمن الكاش المحصّل.</span></div>` : ''}${cash && !c ? `<button class="btn outline mt" data-action="cash-dialog">${I('banknote')}تسجيل تحصيل لاحق</button>` : ''}<button class="text-btn full mt" data-action="history">${I('history')}عرض سجل المهمة</button>`;
}

/** Reference `renderTask`. */
export function renderTask(): string {
  const j = job();
  if (!j) return '';
  return (
    (j.stage !== 'closed' ? renderStepper(j) : '') +
    (['assigned', 'accepted'].includes(j.stage)
      ? details(j)
      : j.stage === 'route'
        ? route(j)
        : j.stage === 'before'
          ? photos(j, 'before')
          : j.stage === 'wash'
            ? wash(j)
            : j.stage === 'after'
              ? photos(j, 'after')
              : j.stage === 'handoff'
                ? handoff(j)
                : completed(j))
  );
}

/** Reference `renderTaskDock`. PC-28 («ملخص التجربة محفوظ» -> «ملخص المهمة محفوظ»). */
export function renderTaskDock(): string {
  const j = job();
  if (!j) return '';
  let label = '';
  let action = 'primary';
  let icon = 'arrow';
  let disabled = false;
  let secondary = '';
  let hint = '';
  switch (j.stage) {
    case 'assigned':
      label = 'استلام المهمة';
      disabled = !ready();
      hint = ready() ? 'راجع التفاصيل ثم ابدأ' : 'فعّل جاهزيتك من «يومي»';
      secondary =
        '<button class="text-btn" data-action="defer">لا أستطيع تنفيذ هذه المهمة</button>';
      break;
    case 'accepted': {
      label = 'بدء التوجّه';
      const busy = activeWork(S.jobs);
      disabled = !!busy && busy.id !== j.id;
      hint = disabled ? 'لديك مهمة أخرى قيد التنفيذ' : 'حدّث الحالة بعد التوقف بأمان';
      // DEV-01 (owner decision required): the reference handles `defer` at this stage but shows
      // its control only on the assigned dock; the same control is shown so C4 release is reachable.
      secondary =
        '<button class="text-btn" data-action="defer">لا أستطيع تنفيذ هذه المهمة</button>';
      break;
    }
    case 'route':
      label = 'وصلت إلى الموقع';
      icon = 'pin';
      hint = 'تأكد من السيارة واللوحة عند الوصول';
      break;
    case 'before':
      label = 'بدء الغسيل';
      disabled = !photoSlots(j, 'before').some(Boolean) || S.photoBusy;
      icon = 'drop';
      hint = disabled ? 'أضف صورة واحدة على الأقل' : 'صور الحالة جاهزة';
      break;
    case 'wash':
      label = 'التقط صور النتيجة';
      disabled = !requiredDone(j);
      icon = 'camera';
      hint = disabled
        ? `أكمل قائمة العناية · ${checkedCount(j)} / ${checklist(j).length}`
        : 'تم تأكيد جميع خطوات العناية';
      break;
    case 'after':
      label = 'إنهاء الغسيل والتسليم';
      disabled = !photoSlots(j, 'after').some(Boolean) || S.photoBusy;
      icon = 'check';
      hint = disabled ? 'أضف صورة بعد الغسيل أولًا' : 'الدفع يُسجّل بشكل منفصل';
      break;
    case 'handoff':
      if (method(j) === 'cash' && !collected(j) && !cashIssue(j)) {
        label = 'تسجيل استلام الكاش';
        action = 'cash-dialog';
        icon = 'banknote';
        secondary = '<button class="text-btn" data-action="cash-issue">لم أستلم المبلغ</button>';
      } else {
        label =
          (method(j) !== 'cash' && !walletVerified(j)) || (cashIssue(j) && !collected(j))
            ? 'إغلاق المهمة · الدفع للمتابعة'
            : 'تأكيد التسليم وإغلاق المهمة';
        icon = 'check';
      }
      hint = 'لا يُسجّل التحصيل تلقائيًا';
      break;
    case 'closed':
      label = 'العودة إلى جدولي';
      action = 'home';
      icon = 'calendar';
      hint = j.deferred
        ? 'لم تُنفذ هذه الخدمة'
        : outstanding(j)
          ? 'أُنجز الغسيل · الدفع ما زال للمتابعة'
          : 'ملخص المهمة محفوظ';
      break;
  }
  const value = total(j);
  return `<div class="task-dock"><div class="dock-hint"><span>${hint}</span><span>${value ? `${money(j)} قيمة الطلب` : ''}</span></div><button class="btn" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}${I(icon)}</button>${secondary}</div>`;
}
