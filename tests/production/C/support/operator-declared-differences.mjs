/* global document, window, HTMLElement, NodeFilter, scrollX, scrollY -- browser code inside page.evaluate() */
/**
 * Declared differences between the approved technician reference and the
 * production operator-web port. Every entry has an id that is also used in
 * apps/operator-web/src (comments) and docs/production/C/P03-C5-operator-web.md.
 *
 * The visual suite applies these operations to the RAW reference DOM before
 * its capture, records the bounding boxes of everything they touch (the
 * declared regions) and then requires a ZERO pixel difference against the
 * candidate. Nothing else may differ. Categories:
 *   PR  production removal of a prototype-only control/notice (ADR 0004)
 *   PC  production copy edit: a trial/local qualifier that would be false
 *   D   data gap: the C1-C5 contracts do not provide the reference value
 */

const ID = { 'WG-2041': '20410000', 'WG-2042': '20420000', 'WG-2043': '20430000' };

export const DECLARED = Object.freeze([
  {
    id: 'PR-01',
    kind: 'remove',
    selector: '.prototype-bar',
    reason:
      'Trial banner «واجهة تجريبية · طلبات ومبالغ توضيحية فقط» and its guide (ADR 0004 designer control).',
  },
  {
    id: 'PR-04',
    kind: 'remove',
    selector: '.quick-panel',
    reason: 'Home «جرّب رحلة الفني كاملة» walkthrough panel opens the prototype guide.',
  },
  {
    id: 'PR-05',
    kind: 'remove',
    selector: '.design-footer',
    reason: 'Design-approval footers (also registered a11y debt TI-D13).',
  },
  {
    id: 'PR-03',
    kind: 'remove',
    selector: '.hero-foot > span:last-child',
    when: 'جدول تجريبي',
    reason: '«جدول تجريبي» trial label in the hero footer.',
  },
  {
    id: 'D1',
    kind: 'text',
    from: 'WG-2041',
    to: ID['WG-2041'],
    reason: 'No human booking reference in C3; the first 8 hex digits of the booking id are shown.',
  },
  { id: 'D1', kind: 'text', from: 'WG-2042', to: ID['WG-2042'], reason: 'As above.' },
  { id: 'D1', kind: 'text', from: 'WG-2043', to: ID['WG-2043'], reason: 'As above.' },
  {
    id: 'D1',
    kind: 'attr',
    attr: 'aria-label',
    from: 'WG-2041',
    to: ID['WG-2041'],
    reason: 'As above (job card label).',
  },
  {
    id: 'D1',
    kind: 'attr',
    attr: 'aria-label',
    from: 'WG-2042',
    to: ID['WG-2042'],
    reason: 'As above.',
  },
  {
    id: 'D1',
    kind: 'attr',
    attr: 'aria-label',
    from: 'WG-2043',
    to: ID['WG-2043'],
    reason: 'As above.',
  },
  {
    id: 'PC-01',
    kind: 'html',
    selector: '.plate small',
    from: 'لوحة<br>تجريبية',
    to: 'لوحة',
    reason: 'Plate label «لوحة تجريبية» -> «لوحة».',
  },
  {
    id: 'PC-04',
    kind: 'text',
    from: ' · بيانات تجريبية',
    to: '',
    reason: 'Task header «بيانات تجريبية».',
  },
  {
    id: 'PC-05',
    kind: 'attr',
    attr: 'aria-label',
    from: 'الحساب التجريبي',
    to: 'حسابي',
    reason: 'Header account label.',
  },
  {
    id: 'D8',
    kind: 'html',
    selector: '.avatar',
    from: 'أح',
    to: '<svg class="ic " aria-hidden="true"><use href="#i-user"></use></svg>',
    reason: 'No technician name in any C5 read; reference user icon instead of initials.',
  },
  {
    id: 'D8',
    kind: 'text',
    from: 'مرحبًا، أحمد',
    to: 'مرحبًا',
    reason: 'No technician name in any C5 read.',
  },
  {
    id: 'D8',
    kind: 'text',
    from: 'أحمد · الفني التجريبي',
    to: 'حسابي',
    reason: 'No technician name; nav label «حسابي» reused.',
  },
  {
    id: 'PC-06',
    kind: 'attr',
    attr: 'aria-label',
    from: 'إشعارات التجربة',
    to: 'إشعارات',
    reason: 'Notifications label.',
  },
  {
    id: 'PC-07',
    kind: 'attr',
    attr: 'aria-label',
    from: 'الجاهزية التجريبية للمهام',
    to: 'الجاهزية للمهام',
    reason: 'Readiness switch label.',
  },
  {
    id: 'PC-08',
    kind: 'text',
    from: ' مهام أنجزتها في العرض',
    to: ' مهام أنجزتها',
    reason: 'Hero meter «في العرض».',
  },
  {
    id: 'PC-09',
    kind: 'text',
    from: 'أنت في استراحة تجريبية.',
    to: 'أنت في استراحة.',
    reason: 'Break note.',
  },
  {
    id: 'PC-10',
    kind: 'text',
    from: 'أنهيت جدول العرض',
    to: 'أنهيت جدولك',
    reason: 'Empty home schedule.',
  },
  {
    id: 'D2',
    kind: 'text',
    from: 'عناية إضافية بالإطارات',
    to: 'الإضافات',
    reason: 'C3 lines carry no display names; reference generic label «الإضافات».',
  },
  {
    id: 'D2',
    kind: 'text',
    from: 'لا تنس الإضافة المتفق عليها ضمن عناية الإطارات.',
    to: 'لا تنس الإضافة المتفق عليها.',
    reason: 'Add-on reminder was specific to the seed add-on name.',
  },
  {
    id: 'D2',
    kind: 'text',
    from: 'داخلي + خارجي · سيارة كبيرة · ',
    to: '',
    reason: 'Service detail text not in C3.',
  },
  {
    id: 'D2',
    kind: 'text',
    from: 'داخلي + خارجي · ',
    to: '',
    reason: 'Service detail text not in C3.',
  },
  {
    id: 'D2',
    kind: 'text',
    from: 'غسيل خارجي · ',
    to: '',
    reason: 'Service detail text not in C3.',
  },
  {
    id: 'D2',
    kind: 'text',
    from: 'نظافة متكاملة',
    to: 'الخدمة',
    reason: 'Service name not in C3; reference label «الخدمة».',
  },
  { id: 'D2', kind: 'text', from: 'عناية شاملة', to: 'الخدمة', reason: 'As above.' },
  { id: 'D2', kind: 'text', from: 'لمعة خارجية', to: 'الخدمة', reason: 'As above.' },
  {
    id: 'D5',
    kind: 'href',
    selector: '.job-service use[href="#i-drop"]',
    to: '#i-spark',
    reason: 'Seed-id rule (WG-2043 drop icon) is a demo rule; spark is used for every service.',
  },
  {
    id: 'D7',
    kind: 'regex',
    pattern: ' · [0-9.]+ كم توضيحيًا',
    to: '',
    reason: 'No distance source (Geo/TI-D11); illustrative distance removed from the job card.',
  },
  {
    id: 'D9',
    kind: 'pill',
    from: ' · معتمد تجريبيًا',
    to: ' · قيد المراجعة',
    className: 'pill amber',
    reason:
      'No C5 route exposes Billing payment verification; wallets are never shown as verified.',
  },
  {
    id: 'PC-11',
    kind: 'text',
    from: 'جدول مسند من الإدارة. كل البيانات هنا للتجربة.',
    to: 'جدول مسند من الإدارة.',
    reason: 'Tasks heading trial sentence.',
  },
  {
    id: 'PC-12',
    kind: 'text',
    from: 'تتغير القوائم عندما تتقدم في سيناريوهات التجربة.',
    to: 'تتغير القوائم عندما تتقدم في مهامك.',
    reason: 'Empty tasks list.',
  },
  {
    id: 'PC-13',
    kind: 'text',
    from: 'الأرقام تعكس محاكاة المهام، وليست حسابًا ماليًا فعليًا.',
    to: 'الأرقام تعكس المهام، وليست حسابًا ماليًا فعليًا.',
    reason: 'Collections heading.',
  },
  {
    id: 'PC-14',
    kind: 'text',
    from: 'قيمة طلبات محصّلة في العرض · ليست أرباح الفني',
    to: 'قيمة طلبات محصّلة · ليست أرباح الفني',
    reason: 'Ledger caption.',
  },
  {
    id: 'PC-15',
    kind: 'text',
    from: 'أكمل مهمة تجريبية وشاهد حالة التحصيل بوضوح.',
    to: 'أكمل مهمة وشاهد حالة التحصيل بوضوح.',
    reason: 'Empty collections.',
  },
  {
    id: 'PC-16',
    kind: 'text',
    from: ' حالة المحفظة مفترضة في بيانات العرض؛ الربط الحقيقي يأتي لاحقًا.',
    to: '',
    reason: 'Collections note second sentence.',
  },
  {
    id: 'PR-06',
    kind: 'remove',
    selector: '.profile-head p, .profile-head .pill',
    reason: 'Profile demo team line and «حساب عرض · دون تسجيل دخول حقيقي».',
  },
  {
    id: 'PR-07',
    kind: 'remove',
    selector: '.profile-head + .card .setting-row + .setting-row',
    reason: 'Profile browser-storage status row (prototype persistence).',
  },
  {
    id: 'PR-08',
    kind: 'remove',
    selector: '.profile-head ~ section.card.mt',
    reason:
      'Profile guide/privacy/design-feedback menu (PR-08/09/10) and trial reset card (PR-11).',
  },
  {
    id: 'PC-17',
    kind: 'text',
    from: 'ملاحظة محفوظة محليًا: ',
    to: 'ملاحظة محفوظة: ',
    reason: 'Note is stored by Dispatch, not locally.',
  },
  {
    id: 'PC-18',
    kind: 'text',
    from: 'موعد مجدول للتجربة، وليس طلب وصول فوري',
    to: 'موعد مجدول، وليس طلب وصول فوري',
    reason: 'Schedule row.',
  },
  {
    id: 'PR-12',
    kind: 'removeText',
    selector: '.detail-row p',
    text: 'بيانات العميل توضيحية',
    reason: 'Customer data is real in production.',
  },
  {
    id: 'PC-19',
    kind: 'attr',
    attr: 'aria-label',
    from: 'خيارات التواصل التجريبية',
    to: 'خيارات التواصل',
    reason: 'Contact button label.',
  },
  {
    id: 'PR-13',
    kind: 'addClass',
    selector: '.route-stats + section.card',
    className: 'mt',
    reason: 'Spacing kept with the reference `mt` utility after PR-13.',
  },
  {
    id: 'PR-13',
    kind: 'remove',
    selector: '.route-stats',
    reason: 'Illustrative ETA/distance metrics; no Geo source (D7, TI-D11).',
  },
  {
    id: 'PC-20',
    kind: 'remove',
    selector: '.map-bubble small',
    reason: '«المسار والمسافة للتجربة».',
  },
  {
    id: 'PC-21',
    kind: 'text',
    from: ' في التطوير الفعلي تُربط هذه الشاشة بخرائط وموقع مصرح بهما.',
    to: '',
    reason: 'Development note on the route screen.',
  },
  {
    id: 'PC-22',
    kind: 'remove',
    selector: '.photo-label',
    reason: '«صورة محلية»/«رسم تجريبي» label; photos are server evidence.',
  },
  {
    id: 'PR-14',
    kind: 'remove',
    selector: '[data-action="demo-photos"], [data-action="demo-photo-one"]',
    reason: 'Demo illustration buttons (never evidence).',
  },
  {
    id: 'PC-23',
    kind: 'text',
    from: ' الصور تبقى محليًا في هذا النموذج؛ لا تُرسل إلى عميل أو خادم.',
    to: '',
    reason: 'Photos are uploaded to Media.',
  },
  {
    id: 'PC-24',
    kind: 'removeText',
    selector: '.field-hint',
    text: 'تُحفظ الملاحظة محليًا، دون إرسالها للإدارة.',
    reason: 'Condition note is stored by Dispatch.',
  },
  {
    id: 'PC-25',
    kind: 'text',
    from: 'صورتان من جهازك · محليًا فقط',
    to: 'صورتان من جهازك',
    reason: 'Comparison caption.',
  },
  {
    id: 'PC-30',
    kind: 'text',
    from: 'سجّل التحصيل فقط بعد الاستلام؛ لن تنفذ هذه النسخة أي معاملة مالية.',
    to: 'سجّل التحصيل فقط بعد الاستلام.',
    reason: 'Handoff note prototype clause.',
  },
  {
    id: 'PC-32',
    kind: 'text',
    from: 'اكتملت المهمة · تجريبيًا',
    to: 'اكتملت المهمة',
    reason: 'Completion pill.',
  },
  {
    id: 'PC-33',
    kind: 'text',
    from: 'تم التحصيل · تجريبي',
    to: 'تم التحصيل',
    reason: 'Receipt payment state.',
  },
  {
    id: 'PR-15',
    kind: 'removeText',
    selector: '.note',
    text: 'تم حفظ ملخص التجربة',
    reason: 'Completion note about browser-local storage.',
  },
  {
    id: 'PC-34',
    kind: 'text',
    from: 'تسجيل تحصيل لاحق · تجربة',
    to: 'تسجيل تحصيل لاحق',
    reason: 'Late cash button.',
  },
  {
    id: 'PC-26',
    kind: 'text',
    from: 'محاكاة طلب إعادة الإسناد؛ لم تُرسل إلى الإدارة فعليًا.',
    to: '',
    reason: 'Release IS sent to Dispatch.',
  },
  {
    id: 'PC-27',
    kind: 'text',
    from: ' أُخفيت المهمة من القائمة النشطة في هذا العرض.',
    to: ' أُخفيت المهمة من القائمة النشطة.',
    reason: 'Deferred note.',
  },
  {
    id: 'PC-28',
    kind: 'text',
    from: 'ملخص التجربة محفوظ',
    to: 'ملخص المهمة محفوظ',
    reason: 'Closed dock hint (reference phrase «ملخص المهمة»).',
  },
  { id: 'PC-36', kind: 'text', from: 'طلب مساعدة · تجربة', to: 'طلب مساعدة', reason: 'Task menu.' },
  {
    id: 'PR-17',
    kind: 'remove',
    selector: '[data-action="demo-contact"]',
    reason: 'Simulated call.',
  },
  {
    id: 'PR-17',
    kind: 'removeText',
    selector: '.note',
    text: 'هذه بيانات وهمية',
    reason: 'Contact sheet demo-data note.',
  },
  {
    id: 'PC-37',
    kind: 'text',
    from: 'الإجمالي التوضيحي',
    to: 'الإجمالي',
    reason: 'Breakdown total.',
  },
  {
    id: 'PC-38',
    kind: 'text',
    from: ' · تحديث محلي تجريبي',
    to: '',
    reason: 'History entries come from Dispatch.',
  },
  {
    id: 'PC-38',
    kind: 'text',
    from: ' · محاكاة',
    to: '',
    reason: 'History texts of server events.',
  },
  {
    id: 'PC-39',
    kind: 'text',
    from: 'ستظهر هنا الأحداث أثناء التجربة.',
    to: 'ستظهر هنا الأحداث.',
    reason: 'Empty history.',
  },
  {
    id: 'PC-40',
    kind: 'text',
    from: 'هذا العرض محلي؛ لا تُرسل الصور تلقائيًا إلى العميل. عند استخدام الصور الحقيقية يُفضّل التقاط الزاوية نفسها.',
    to: 'لا تُرسل الصور تلقائيًا إلى العميل. يُفضّل التقاط الزاوية نفسها.',
    reason: 'Result sheet.',
  },
  {
    id: 'PC-41',
    kind: 'text',
    from: 'اختر صورة من جهازك أو استخدم الرسم التوضيحي لإكمال التجربة.',
    to: 'اختر صورة من جهازك.',
    reason: 'Photo options (empty slot).',
  },
  {
    id: 'PC-42',
    kind: 'removeText',
    selector: '.sheet-body p',
    text: 'صورة محلية على هذا المتصفح فقط',
    reason: 'Photo options (filled slot).',
  },
  {
    id: 'PC-43',
    kind: 'text',
    from: 'نعم، وصلت · تجربة',
    to: 'نعم، وصلت',
    reason: 'Arrival confirmation.',
  },
  {
    id: 'PC-44',
    kind: 'text',
    from: 'اكتب المبلغ كاملًا للتجربة.',
    to: 'اكتب المبلغ كاملًا.',
    reason: 'Cash hint.',
  },
  {
    id: 'PC-45',
    kind: 'text',
    from: 'أؤكد استلام المبلغ كاملًا في هذا السيناريو التجريبي، وليس بمجرد انتهاء الغسيل.',
    to: 'أؤكد استلام المبلغ كاملًا، وليس بمجرد انتهاء الغسيل.',
    reason: 'Cash confirmation line.',
  },
  {
    id: 'PC-46',
    kind: 'text',
    from: 'تسجيل التحصيل · تجريبي',
    to: 'تسجيل التحصيل',
    reason: 'Cash confirm button.',
  },
  {
    id: 'PC-47',
    kind: 'text',
    from: 'يحفظ إثباتًا محليًا للتجربة فقط. ',
    to: '',
    reason: 'Cash sheet footnote first sentence.',
  },
  {
    id: 'PC-48',
    kind: 'text',
    from: ' كل ذلك محلي ولا يُرسل فعليًا.',
    to: '',
    reason: 'Issue notes are sent to Dispatch.',
  },
  {
    id: 'PC-49',
    kind: 'text',
    from: 'يسجل النموذج طلب إعادة إسناد',
    to: 'يُسجَّل طلب إعادة إسناد',
    reason: '«النموذج» (the prototype) as subject.',
  },
  {
    id: 'PC-50',
    kind: 'text',
    from: 'حفظ الملاحظة التجريبية',
    to: 'حفظ الملاحظة',
    reason: 'Issue save button.',
  },
  {
    id: 'PC-35',
    kind: 'sheetTitle',
    from: 'إشعارات العرض',
    to: 'إشعارات',
    reason: 'Notifications sheet title.',
  },
  {
    id: 'PR-16',
    kind: 'removeText',
    selector: '.sheet-body > .note',
    text: 'إشعارات ثابتة لشرح التصميم',
    reason: 'Notifications demo explanation.',
  },
]);

/** Runs in the reference page: apply DECLARED operations, return the touched regions. */
export function applyDeclaredInPage(ops) {
  const regions = [];
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x + scrollX),
      y: Math.round(r.y + scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const note = (op, el) => {
    if (el && visible(el)) regions.push({ id: op.id, ...rectOf(el) });
    else if (el) regions.push({ id: op.id, hidden: true });
  };
  const textNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const tag = walker.currentNode.parentElement?.tagName;
      if (tag !== 'SCRIPT' && tag !== 'STYLE') nodes.push(walker.currentNode);
    }
    return nodes;
  };
  const roots = [document.body];
  for (const op of ops) {
    if (op.kind === 'remove') {
      for (const el of document.querySelectorAll(op.selector)) {
        if (op.when && el.textContent.trim() !== op.when) continue;
        note(op, el);
        el.remove();
      }
    } else if (op.kind === 'removeText') {
      for (const el of document.querySelectorAll(op.selector)) {
        if (!el.textContent.includes(op.text)) continue;
        note(op, el);
        el.remove();
      }
    } else if (op.kind === 'text' || op.kind === 'regex') {
      const pattern = op.kind === 'regex' ? new RegExp(op.pattern, 'g') : null;
      for (const root of roots) {
        for (const node of textNodes(root)) {
          const before = node.nodeValue;
          const after = pattern
            ? before.replace(pattern, op.to)
            : before.split(op.from).join(op.to);
          if (after !== before) {
            note(op, node.parentElement);
            node.nodeValue = after;
          }
        }
      }
    } else if (op.kind === 'attr') {
      for (const el of document.querySelectorAll(`[${op.attr}]`)) {
        const value = el.getAttribute(op.attr);
        if (value.includes(op.from)) {
          note(op, el);
          el.setAttribute(op.attr, value.split(op.from).join(op.to));
        }
      }
    } else if (op.kind === 'html') {
      for (const el of document.querySelectorAll(op.selector)) {
        if (el.innerHTML === op.from) {
          note(op, el);
          el.innerHTML = op.to;
        }
      }
    } else if (op.kind === 'href') {
      for (const el of document.querySelectorAll(op.selector)) {
        note(op, el.closest('svg'));
        el.setAttribute('href', op.to);
      }
    } else if (op.kind === 'pill') {
      for (const el of document.querySelectorAll('.pill')) {
        for (const node of textNodes(el)) {
          if (node.nodeValue.includes(op.from)) {
            note(op, el);
            node.nodeValue = node.nodeValue.split(op.from).join(op.to);
            el.className = op.className;
          }
        }
      }
    } else if (op.kind === 'addClass') {
      for (const el of document.querySelectorAll(op.selector)) {
        note(op, el);
        el.classList.add(op.className);
      }
    } else if (op.kind === 'sheetTitle') {
      const title = document.querySelector('#sheet-title');
      if (title && title.textContent === op.from) {
        note(op, title);
        title.textContent = op.to;
      }
    } else if (op.kind === 'emptyText') {
      for (const el of document.querySelectorAll(op.selector)) {
        if (!el.textContent) continue;
        note(op, el);
        el.textContent = '';
      }
    } else if (op.kind === 'appendHtml') {
      for (const el of document.querySelectorAll(op.selector)) {
        el.insertAdjacentHTML('beforeend', op.html);
        note(op, el.lastElementChild);
      }
    } else if (op.kind === 'removeAll') {
      for (const el of document.querySelectorAll(op.selector)) {
        note(op, el);
        el.remove();
      }
    } else {
      throw new Error(`UNKNOWN_DECLARED_KIND:${op.kind}`);
    }
  }
  // Re-render from scratch so nothing rasterised before the mutation survives
  // (focus and the open dialog are preserved).
  const focused = document.activeElement;
  const scroll = [scrollX, scrollY];
  // Same computation as the reference updateDock(), which only runs on render().
  const dockHeight =
    document.querySelector('#dock')?.firstElementChild?.getBoundingClientRect().height || 86;
  document.documentElement.style.setProperty('--dock', `${Math.ceil(dockHeight)}px`);
  document.documentElement.style.display = 'none';
  void document.documentElement.offsetHeight;
  document.documentElement.style.removeProperty('display');
  if (!document.documentElement.getAttribute('style'))
    document.documentElement.removeAttribute('style');
  void document.documentElement.offsetHeight;
  if (focused instanceof HTMLElement && document.activeElement !== focused)
    focused.focus({ preventScroll: true });
  window.scrollTo(scroll[0], scroll[1]);
  return regions;
}
