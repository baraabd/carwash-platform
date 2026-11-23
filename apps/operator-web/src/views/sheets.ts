import { I, escape } from '../dom';
import {
  EXTRA_LABEL,
  SERVICE_LABEL,
  area,
  base,
  carName,
  customer,
  extras,
  hasExtra,
  historyEvents,
  method,
  outstanding,
  photos as photoSlots,
  time,
  total,
  type Job,
  type PhotoPhase,
} from '../model';
import { formatMajor, moneyHtml } from '../money';
import { S } from '../state';
import { car, plate } from './common';
import { comparison, photoMarkup } from './task';

/** A sheet is a title and a body for the shared `<dialog id="sheet">`. */
export interface SheetContent {
  readonly title: string;
  readonly body: string;
}

const timeLabel = (date: string): string =>
  new Date(date).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });

/** Action `notifications`. PC-35 title; PR-16 demo explanation note. */
export function notificationsSheet(): SheetContent {
  return {
    title: 'إشعارات',
    body:
      S.jobs
        .filter((x) => x.stage !== 'closed')
        .map(
          (x) =>
            `<button class="menu-row" data-action="open-job" data-id="${escape(x.id)}"><span class="tile-icon">${I('work')}</span><span class="grow"><strong>مهمة مسندة · ${escape(carName(x))}</strong><small>${escape(time(x))}${area(x) ? ` · ${escape(area(x))}` : ''} · ${escape(x.ref)}</small></span>${I('left')}</button>`,
        )
        .join('') || '<p class="muted mt">أنهيت جميع المهام.</p>',
  };
}

/** Action `task-menu`. PC-36 («طلب مساعدة · تجربة» -> «طلب مساعدة»). */
export function taskMenuSheet(j: Job): SheetContent {
  return {
    title: 'خيارات المهمة',
    body: `<button class="menu-row" data-action="history">${I('history')}<span class="grow"><strong>سجل المهمة</strong></span>${I('left')}</button><button class="menu-row" data-action="breakdown">${I('receipt-pay')}<span class="grow"><strong>تفاصيل المبلغ</strong></span>${I('left')}</button>${j.stage !== 'closed' && j.task ? `<button class="menu-row" data-action="help">${I('help')}<span class="grow"><strong>طلب مساعدة</strong></span>${I('left')}</button>` : ''}<button class="menu-row" data-action="home">${I('grid')}<span class="grow"><strong>العودة إلى يومي</strong></span>${I('left')}</button>`,
  };
}

/** Action `contact`. PR-17 simulated call button and demo-data note removed. */
export function contactSheet(j: Job): SheetContent {
  return {
    title: 'التواصل مع العميل',
    body: `<div class="row"><span class="tile-icon lime">${I('user')}</span><div><h3>${escape(customer(j))}</h3><p class="muted">${escape(carName(j))}${area(j) ? ` · ${escape(area(j))}` : ''}</p></div></div><button class="btn outline" data-action="message-preview">${I('message')}معاينة رسالة الوصول</button>`,
  };
}

/** Action `message-preview`, verbatim. */
export function messagePreviewSheet(): SheetContent {
  return {
    title: 'معاينة رسالة الوصول',
    body: `<section class="card"><p>مرحبًا، أنا فني WashGo. وصلت إلى الموقع وأود التأكد من مكان السيارة. شكرًا لك.</p></section><p class="muted mt">معاينة نصية فقط. لم تُرسل هذه الرسالة.</p><button class="btn soft" data-action="close-sheet">العودة إلى المهمة</button>`,
  };
}

/** Reference `showBreakdown`. D2 labels; PC-37 «الإجمالي التوضيحي» -> «الإجمالي». */
export function breakdownSheet(j: Job): SheetContent | null {
  const t = total(j);
  const b = base(j);
  const e = extras(j);
  if (!t || !b || !e) return null;
  return {
    title: 'تفاصيل قيمة الطلب',
    body: `<section class="receipt"><div class="receipt-row"><span>${SERVICE_LABEL}</span><strong>${moneyHtml(b)}</strong></div><div class="receipt-row"><span>${hasExtra(j) ? EXTRA_LABEL : 'الإضافات'}</span><strong>${moneyHtml(e)}</strong></div><div class="receipt-row total"><span>الإجمالي</span><strong>${moneyHtml(t)}</strong></div></section><div class="note mt">${I('info')}<span>هذه قيمة الخدمة للعميل، وليست أجرًا أو أرباحًا للفني. لا تُنشئ الأرقام فاتورة أو التزامًا ماليًا.</span></div><button class="btn soft" data-action="close-sheet">واضح</button>`,
  };
}

/** Reference `showHistory` over the C4 task history. PC-38, PC-39. */
export function historySheet(j: Job): SheetContent {
  const events = historyEvents(j);
  return {
    title: 'سجل المهمة',
    body: `${events.length ? `<ol class="timeline">${events.map((event) => `<li><span class="tile-icon">${I('check')}</span><div><strong>${escape(event.text)}</strong><small>${escape(timeLabel(event.at))}</small></div></li>`).join('')}</ol>` : '<p class="muted">لم تبدأ المهمة بعد. ستظهر هنا الأحداث.</p>'}<button class="btn soft" data-action="close-sheet">إغلاق السجل</button>`,
  };
}

/** Reference `resultSheet`. PC-40. */
export function resultSheet(j: Job): SheetContent {
  return {
    title: 'النتيجة قبل وبعد',
    body: `${comparison(j)}<p class="muted mt">لا تُرسل الصور تلقائيًا إلى العميل. يُفضّل التقاط الزاوية نفسها.</p><button class="btn soft" data-action="close-sheet">إغلاق المقارنة</button>`,
  };
}

/** Reference `photoOptions`. PR-18 demo button; PC-41, PC-42. */
export function photoOptionsSheet(j: Job, phase: PhotoPhase, index: number): SheetContent {
  const p = photoSlots(j, phase)[index] ?? null;
  return {
    title: `${phase === 'before' ? 'قبل' : 'بعد'} الغسيل · الصورة ${index + 1}`,
    body: `${p ? `<div class="photo-lightbox">${photoMarkup(p, phase)}</div>` : '<p class="muted">اختر صورة من جهازك.</p>'}<label class="upload mt"><input type="file" class="input-hidden" accept="image/jpeg,image/png,image/webp" capture="environment" data-upload="${phase}" data-index="${index}">${I('camera')}<span><strong>${p ? 'استبدال الصورة' : 'اختيار صورة'}</strong><small>من الكاميرا أو الجهاز عند دعم المتصفح</small></span></label>${p ? `<button class="btn danger" data-action="delete-photo" data-phase="${phase}" data-index="${index}">${I('trash')}حذف هذه الصورة</button>` : ''}`,
  };
}

/** Action `before-view`. */
export function beforeViewSheet(j: Job): SheetContent {
  const note = j.task?.conditionNote ?? '';
  return {
    title: 'الحالة قبل الغسيل',
    body: `<div class="photo-grid">${photoSlots(j, 'before')
      .filter(Boolean)
      .map((p) => `<div class="photo-lightbox">${photoMarkup(p, 'before')}</div>`)
      .join(
        '',
      )}</div>${note ? `<p class="customer-note mt">${escape(note)}</p>` : ''}<button class="btn soft" data-action="close-sheet">متابعة العناية</button>`,
  };
}

/** Reference `primary()` route branch. PC-43 button «· تجربة» removed. */
export function arrivalSheet(j: Job): SheetContent {
  return {
    title: 'وصلت إلى السيارة؟',
    body: `<section class="vehicle-showcase"><div class="row between"><strong>${escape(carName(j))}</strong>${plate(j)}</div>${car(j, 'big-car')}</section><p class="muted mt">تحقق من السيارة واللوحة، وحدّث الحالة بعد التوقف بأمان. هذه الخطوة لا تتحقق من الموقع فعليًا.</p><button class="btn" data-action="arrived-confirm">${I('pin')}نعم، وصلت</button>`,
  };
}

/** Reference `primary()` after branch, verbatim. */
export function finishSheet(): SheetContent {
  return {
    title: 'إنهاء الغسيل؟',
    body: `<p>سيتم تثبيت صور النتيجة والانتقال إلى تسليم السيارة وحالة الدفع.</p><div class="note mt">${I('shield')}<span>لا يتم تسجيل استلام كاش أو اعتماد محفظة بمجرد إتمام هذه الخطوة.</span></div><button class="btn" data-action="finish-wash-confirm">${I('check')}نعم، انتهى الغسيل</button>`,
  };
}

/** Reference `showCash`. Exact Money (D3). PC-44..PC-47. */
export function cashSheet(j: Job): SheetContent | null {
  const t = total(j);
  if (!t) return null;
  return {
    title: 'تأكيد استلام الكاش',
    body: `<section class="receipt"><div class="receipt-row"><span>رقم المهمة</span><strong class="ltr">${escape(j.ref)}</strong></div><div class="receipt-row total"><span>المبلغ المستحق</span><strong>${moneyHtml(t)}</strong></div></section><label class="field-label" for="cash-amount">المبلغ المستلم <span class="muted">· ل.س</span></label><input id="cash-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="${formatMajor(t)}" maxlength="15" aria-describedby="cash-hint"><p class="field-hint" id="cash-hint">اكتب المبلغ كاملًا. يمكن استخدام الأرقام العربية.</p><label class="confirm-line mt"><input id="cash-check" type="checkbox"><span>أؤكد استلام المبلغ كاملًا، وليس بمجرد انتهاء الغسيل.</span></label><div id="cash-error" class="sheet-error" hidden></div><button class="btn" data-action="cash-confirm" id="cash-confirm" disabled>${I('check')}تسجيل التحصيل</button><p class="tiny muted mt">لا يصدر إيصالًا قانونيًا ولا يُحدّث حسابات فعلية.</p>`,
  };
}

export type IssueMode = 'defer' | 'cash' | 'payment' | 'help';

/** Reference `showIssue`. PC-48 («كل ذلك محلي ولا يُرسل فعليًا.» removed), PC-49, PC-50. */
export function issueSheet(mode: IssueMode): SheetContent {
  const type =
    mode === 'defer'
      ? 'إعادة المهمة للإدارة'
      : mode === 'cash'
        ? 'تعذّر تحصيل الكاش'
        : mode === 'payment'
          ? 'متابعة تحويل المحفظة'
          : 'طلب مساعدة';
  const text =
    mode === 'defer'
      ? 'يُسجَّل طلب إعادة إسناد ويزيل المهمة من الجدول النشط دون غسيل أو تحصيل.'
      : mode === 'cash'
        ? 'تبقى الخدمة مكتملة والمبلغ غير محصّل. سجّل السبب بدل اعتباره مدفوعًا.'
        : mode === 'payment'
          ? 'الفني يسجل ملاحظة فقط؛ لا يُعتمد الدفع ولا يُطلب تحويل جديد.'
          : 'سجّل العائق؛ لا يتم إلغاء المهمة تلقائيًا.';
  return {
    title: type,
    body: `<p class="muted">${text}</p><label class="field-label" for="issue-reason">السبب أو الملاحظة</label><textarea id="issue-reason" maxlength="500" placeholder="اكتب ملاحظة مختصرة…">${mode === 'payment' ? 'يرجى متابعة مطابقة تحويل المحفظة. لم يتم طلب تحصيل إضافي.' : ''}</textarea><div id="issue-error" class="sheet-error" hidden></div><button class="btn" data-action="save-issue" data-mode="${mode}">${I('check')}حفظ الملاحظة</button>`,
  };
}

/** Reference `closeTaskSheet` (non-cash or recorded cash outcome). PC-51. */
export function handoffSheet(j: Job): SheetContent {
  const due = outstanding(j);
  return {
    title: 'تأكيد التسليم',
    body: `<div class="success-art" data-style="margin-top:9px;width:76px;height:76px;border-radius:26px">${I('check')}</div><p class="center">هل انتهى الغسيل وتم تسليم السيارة؟</p><section class="receipt mt"><div class="receipt-row"><span>السيارة</span><strong>${escape(carName(j))}</strong></div><div class="receipt-row"><span>حالة الدفع</span><strong>${due ? 'يبقى للمتابعة' : method(j) === 'cash' ? 'كاش مسجّل' : 'معتمد'}</strong></div></section><div class="note ${due ? 'amber' : ''} mt">${I('info')}<span>${due ? 'إغلاق المهمة لا يعتمد التحويل أو يحوّل المبلغ إلى محصّل. يبقى ظاهرًا للمتابعة.' : 'تأكيد التسليم دون إرسال إشعار للعميل.'}</span></div><button class="btn" data-action="close-job-confirm">${I('check')}نعم، تأكيد التسليم</button>`,
  };
}
