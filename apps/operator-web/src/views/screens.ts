import { I, escape, st } from '../dom';
import {
  activeWork,
  area,
  carName,
  cashIssue,
  collected,
  issue,
  method,
  outstanding,
  time,
  total,
  walletVerified,
  type Job,
} from '../model';
import { moneyHtml, sumMoney } from '../money';
import type { Money } from '../api/types';
import { S, job, ready } from '../state';
import { brand, heading, jobCard, money, paymentLabel, paymentPill } from './common';

/** Reference `renderHeader`. PC-04/05/06, D8 (no technician name in any C5 read). */
export function renderHeader(): string {
  const j = job();
  if (S.view === 'task' && j) {
    const where = area(j);
    return `<button class="icon-button" data-action="home" aria-label="العودة إلى يومي">${I('right')}</button><div class="header-center"><strong>مهمة <bdi>${escape(j.ref)}</bdi></strong><small>${where ? `${escape(where)} · ` : ''}${escape(time(j))}</small></div><button class="icon-button" data-action="task-menu" aria-label="خيارات المهمة">${I('more')}</button>`;
  }
  const unclosed = S.jobs.some((x) => x.stage !== 'closed');
  return `<button class="row" ${st('padding:0;background:none;text-align:start')} data-action="profile" aria-label="حسابي"><span class="avatar" aria-hidden="true">${I('user')}</span>${brand()}</button><button class="icon-button" data-action="notifications" aria-label="إشعارات">${I('bell')}${unclosed ? '<i class="alert-dot"></i>' : ''}</button>`;
}

/** Reference `renderNav`, verbatim. */
export function renderNav(): string {
  return `<nav class="bottom-nav" aria-label="التنقل الرئيسي">${(
    [
      ['home', 'grid', 'يومي'],
      ['tasks', 'calendar', 'المهام'],
      ['collections', 'wallet', 'التحصيل'],
      ['profile', 'user', 'حسابي'],
    ] as const
  )
    .map(
      ([key, icon, label]) =>
        `<button class="nav-item" data-action="${key}" ${S.view === key ? 'aria-current="page"' : ''}><span class="nav-icon">${I(icon)}</span>${label}</button>`,
    )
    .join('')}</nav>`;
}

/** Reference `renderHome`. PC-07..10, PR-03 «جدول تجريبي», PR-04 guide panel, PR-05 design footer. */
export function renderHome(): string {
  if (!S.loaded) return '';
  const closed = S.jobs.filter((j) => j.stage === 'closed' && !j.deferred).length;
  const next = activeWork(S.jobs) ?? S.jobs.find((j) => j.stage !== 'closed');
  const later = S.jobs.filter((j) => j !== next && j.stage !== 'closed');
  const date = new Date().toLocaleDateString('ar-SY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const isReady = ready();
  const ratio = S.jobs.length ? (closed / S.jobs.length) * 100 : 0;
  return `<section class="hero"><div class="hero-top row between"><span class="date-pill">${I('sun', 'small')}${escape(date)}</span><button class="switch" role="switch" aria-checked="${isReady}" data-action="ready" aria-label="الجاهزية للمهام"><span>${isReady ? 'جاهز للمهام' : 'استراحة'}</span><span class="switch-track"></span></button></div><div class="hero-body"><div><small>مرحبًا</small><h1>يومك منظّم.</h1><p>خطوة واضحة لكل مهمة.</p></div><div class="hero-art"><span class="tile-icon">${I('car')}</span>${I('spark', 'spark')}</div></div><div class="hero-foot"><span><strong>${closed}</strong> / ${S.jobs.length} مهام أنجزتها</span><span class="hero-meter"><i ${st(`width:${ratio}%`)}></i></span></div></section>
    ${!isReady ? `<div class="note amber mt">${I('pause')}<span>أنت في استراحة. يمكنك متابعة مهمة بدأتَها؛ استلام مهمة جديدة يتطلب تفعيل الجاهزية.</span></div>` : ''}
    <div class="section-title"><h2>${activeWork(S.jobs) ? 'مهمتك الحالية' : 'موعدك القادم'}</h2><small>مسند إليك من الإدارة</small></div>
    ${next ? jobCard(next, true) : `<div class="empty"><span class="tile-icon lime">${I('check')}</span><h3>أنهيت جدولك</h3><p>كل مهمة مكتملة تحتفظ بصورها وحالة دفعها.</p><button class="btn soft" data-action="tasks">عرض المهام</button></div>`}
    ${later.length ? `<div class="section-title"><h2>بعدها في جدولك</h2><button class="text-btn" data-action="tasks">كل المهام ${I('left')}</button></div>${later.map((j) => jobCard(j)).join('')}` : ''}
    `;
}

const followed = (j: Job): boolean =>
  j.deferred || !!issue(j) || !!cashIssue(j) || (j.stage === 'closed' && outstanding(j));

/** Reference `renderTasks`. PC-11, PC-12. */
export function renderTasks(): string {
  if (!S.loaded) return '';
  const active = S.jobs.filter((j) => j.stage !== 'closed');
  const done = S.jobs.filter((j) => j.stage === 'closed');
  const follow = S.jobs.filter(followed);
  const shown = S.taskFilter === 'active' ? active : S.taskFilter === 'done' ? done : follow;
  return `${heading('مهامك، بوضوح.', 'جدول مسند من الإدارة.', 'calendar')}<div class="segmented" role="group" aria-label="تصفية المهام">${(
    [
      ['active', 'نشطة', active.length],
      ['done', 'منتهية', done.length],
      ['follow', 'متابعة', follow.length],
    ] as const
  )
    .map(
      ([key, name, n]) =>
        `<button class="segment" aria-pressed="${S.taskFilter === key}" data-action="task-filter" data-value="${key}" data-focus="filter-${key}">${name}<small>${n}</small></button>`,
    )
    .join(
      '',
    )}</div>${shown.length ? shown.map((j) => jobCard(j)).join('') : `<div class="empty"><span class="tile-icon">${I('calendar')}</span><h3>لا توجد مهام في هذه القائمة</h3><p>تتغير القوائم عندما تتقدم في مهامك.</p><button class="btn soft" data-action="filter-active">عرض المهام النشطة</button></div>`}`;
}

const SYP_ZERO: Money = { currency: 'SYP', amountMinor: '0', scale: 2 };

function sumTotals(jobs: readonly Job[], template: Money): Money {
  return sumMoney(
    jobs.flatMap((j) => {
      const t = total(j);
      return t && t.currency === template.currency ? [t] : [];
    }),
    template,
  );
}

/**
 * Reference `renderCollections`. Figures are computed only from server data:
 * Dispatch collection declarations and Booking totals (full order value, not
 * earnings). PC-13..16.
 */
export function renderCollections(): string {
  if (!S.loaded) return '';
  const template = S.jobs.find((j) => j.booking)?.booking?.total ?? SYP_ZERO;
  const cash = sumTotals(S.jobs.filter(collected), template);
  const wallets = S.jobs.filter(
    (j) => method(j) !== 'cash' && walletVerified(j) && j.stage === 'closed' && !j.deferred,
  );
  const follow = S.jobs.filter((j) => j.stage === 'closed' && outstanding(j) && !j.deferred);
  const shown = S.jobs
    .filter((j) => j.stage === 'closed' && !j.deferred)
    .filter((j) =>
      S.collectionFilter === 'cash'
        ? collected(j)
        : S.collectionFilter === 'follow'
          ? outstanding(j)
          : true,
    );
  return `${heading('التحصيل، دون التباس.', 'الأرقام تعكس المهام، وليست حسابًا ماليًا فعليًا.', 'wallet')}<section class="ledger-hero"><div class="row between"><strong>الكاش المسجّل</strong>${I('banknote')}</div><span class="amount">${moneyHtml(cash)}</span><p>قيمة طلبات محصّلة · ليست أرباح الفني</p></section><div class="stats-grid"><div class="metric"><small>محافظ · مهام مكتملة ومعتمدة</small><strong>${moneyHtml(sumTotals(wallets, template))}</strong></div><div class="metric"><small>مهام مكتملة والدفع للمتابعة</small><strong>${follow.length}<span class="small"> مهام</span></strong></div></div><div class="segmented" role="group" aria-label="تصفية التحصيل">${(
    [
      ['all', 'كل المكتمل'],
      ['cash', 'كاش محصّل'],
      ['follow', 'متابعة'],
    ] as const
  )
    .map(
      ([key, name]) =>
        `<button class="segment" aria-pressed="${S.collectionFilter === key}" data-action="collection-filter" data-value="${key}">${name}</button>`,
    )
    .join('')}</div>${
    shown.length
      ? shown
          .map(
            (j) =>
              `<section class="card" ${st('margin-bottom:12px')}><div class="row"><span class="tile-icon ${outstanding(j) ? 'amber' : 'lime'}">${I(outstanding(j) ? 'clock' : 'check')}</span><div class="grow"><strong>${escape(carName(j))}</strong><div class="tiny muted">${escape(j.ref)} · ${paymentLabel(j)}</div></div><strong>${money(j)}</strong></div><div class="row between mt">${paymentPill(j)}<button class="text-btn" data-action="open-job" data-id="${escape(j.id)}">التفاصيل ${I('left')}</button></div></section>`,
          )
          .join('')
      : `<div class="empty"><span class="tile-icon">${I('receipt-pay')}</span><h3>لا توجد حركات مكتملة هنا</h3><p>أكمل مهمة وشاهد حالة التحصيل بوضوح.</p><button class="btn soft" data-action="home">الذهاب إلى المهام</button></div>`
  }<div class="note mt">${I('shield')}<span>الفني لا يملك زر اعتماد شام كاش أو سيريتل كاش.</span></div>`;
}

/**
 * Reference `renderProfile`. Only the motion preference survives in
 * production. D8 (no name), PR-06..PR-11 and PR-05 (design footer) removed.
 */
export function renderProfile(reducedByDevice: boolean): string {
  return `<section class="profile-head"><div class="avatar">${I('user')}</div><h1>حسابي</h1></section><section class="card"><div class="setting-row"><span class="tile-icon">${I('spark')}</span><div class="grow"><strong>المؤثرات الحركية</strong><small>${reducedByDevice ? 'إعداد تقليل الحركة في الجهاز له الأولوية' : 'استجابة عند الاختيار وانتقالات هادئة'}</small></div><button class="switch" role="switch" aria-checked="${S.motion}" data-action="motion" aria-label="المؤثرات الحركية"><span class="switch-track"></span></button></div></section>`;
}
