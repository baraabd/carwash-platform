import type {
  ReviewV1,
  ModerateReviewRequestV1,
  ModerationReason,
} from '@carwash/contracts/reviews-v1';
import {
  customerReviewForBooking,
  moderateCustomerReview,
  pendingCustomerReviews,
} from '../api/customer-reviews';
import { DELIVERY_STATES, notifications } from '../api/notifications';
import { idempotencyKey, UUID } from '../api/http';
import { h, append, byId, replace } from './dom';
import { copy, lang } from './i18n';
import { openModal, closeModal, toast } from './shell';
import { failureMessage, formatInstant } from './states';
import { shortRef } from '../domain/bookings';

// Functional extensions use the reference's cards, tables, toolbar and modal.
// Their new states are declared in S05 acceptance; no baseline is changed.
const tr = (ar: string, en: string): string => (lang() === 'ar' ? ar : en);
let generation = 0;
let unauthenticated = (): void => undefined;
type PendingDecision = { readonly key: string; readonly body: ModerateReviewRequestV1 };
const pending = new Map<string, PendingDecision>();

export function wireReviewNotifications(onUnauthorized: () => void): void {
  unauthenticated = onUnauthorized;
  const anchor = byId('console-state');
  for (const id of ['reviews', 'notifications']) {
    if (!document.getElementById(id))
      anchor.before(h('section', { class: 'screen', id, 'aria-labelledby': `${id}Title` }));
  }
}
export function invalidateReviewNotifications(clearPrivate = false): void {
  generation++;
  if (clearPrivate) {
    pending.clear();
    for (const id of ['reviews', 'notifications']) document.getElementById(id)?.replaceChildren();
  }
}
function frame(
  id: string,
  title: string,
  description: string,
): { host: HTMLElement; content: HTMLElement; more: HTMLElement; refresh: HTMLButtonElement } {
  const host = byId(id);
  const refresh = h('button', { class: 'ghost', type: 'button' }, tr('تحديث', 'Refresh'));
  const content = h('div', { class: 'card panel table-wrap', 'aria-live': 'polite' });
  const more = h('div', { class: 'load-more' });
  replace(
    host,
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', { id: `${id}Title` }, title), h('p', {}, description)),
      refresh,
    ),
    content,
    more,
  );
  return { host, content, more, refresh };
}
function problem(host: HTMLElement, message: string): void {
  replace(host, h('p', { class: 'state-cell', role: 'status' }, message));
}
function reviewStatus(status: ReviewV1['status']): string {
  const labels = {
    PENDING_MODERATION: ['بانتظار المراجعة', 'Awaiting moderation'],
    PRIVATE: ['خاص', 'Private'],
    PUBLISHED: ['منشور', 'Published'],
    REJECTED: ['مرفوض', 'Rejected'],
    HIDDEN: ['مخفي', 'Hidden'],
  } as const;
  return tr(labels[status][0], labels[status][1]);
}
function openReview(item: ReviewV1, changed: () => void): void {
  const openedAt = generation;
  let active = true;
  let busy = false;
  const pendingRequest = pending.get(item.reviewId);
  const decision = h('select', { 'aria-label': tr('القرار', 'Decision') });
  const reason = h('select', { 'aria-label': tr('السبب', 'Reason') });
  if (item.status === 'PENDING_MODERATION') {
    append(
      decision,
      h('option', { value: 'PUBLISH' }, tr('نشر التقييم', 'Publish review')),
      h('option', { value: 'REJECT' }, tr('رفض النشر', 'Reject publication')),
    );
  } else append(decision, h('option', { value: 'HIDE' }, tr('إخفاء التقييم', 'Hide review')));
  const reasons: readonly [ModerationReason, string, string][] = [
    ['MEETS_GUIDELINES', 'يستوفي قواعد النشر', 'Meets publication guidelines'],
    ['PERSONAL_DATA', 'يتضمن بيانات شخصية', 'Contains personal data'],
    ['OFFENSIVE', 'محتوى مسيء', 'Offensive content'],
    ['SPAM', 'محتوى غير مرغوب', 'Spam'],
    ['NOT_ABOUT_SERVICE', 'لا يتعلق بالخدمة', 'Not about the service'],
    ['CUSTOMER_WITHDREW_CONSENT', 'سحب العميل موافقته', 'Customer withdrew consent'],
  ];
  const updateReasons = (): void =>
    replace(
      reason,
      ...reasons
        .filter(([value]) => (decision.value === 'PUBLISH') === (value === 'MEETS_GUIDELINES'))
        .map(([value, ar, en]) => h('option', { value }, tr(ar, en))),
    );
  decision.addEventListener('change', updateReasons);
  updateReasons();
  if (pendingRequest) {
    decision.value = pendingRequest.body.decision;
    updateReasons();
    reason.value = pendingRequest.body.reason;
  }
  const error = h('p', { class: 'field-error', role: 'alert' });
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    pendingRequest
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('اعتماد القرار', 'Confirm decision'),
  );
  const canDecide =
    item.publicationConsent && ['PENDING_MODERATION', 'PUBLISHED'].includes(item.status);
  const setFrozen = (frozen: boolean): void => {
    decision.disabled = reason.disabled = frozen;
    submit.disabled = busy || !canDecide;
  };
  setFrozen(Boolean(pendingRequest));
  submit.addEventListener('click', () => {
    if (busy || !canDecide) return;
    const intent = pending.get(item.reviewId) ?? {
      key: idempotencyKey(),
      body: {
        expectedRevision: item.revision,
        decision: decision.value as ModerateReviewRequestV1['decision'],
        reason: reason.value as ModerationReason,
      },
    };
    pending.set(item.reviewId, intent);
    busy = true;
    setFrozen(true);
    error.textContent = '';
    void moderateCustomerReview(item.reviewId, intent.body, intent.key).then((result) => {
      if (!active || openedAt !== generation) return;
      busy = false;
      if (!result.ok) {
        if (result.failure === 'UNAUTHENTICATED') {
          unauthenticated();
          return;
        }
        if (result.failure !== 'UNKNOWN_OUTCOME') pending.delete(item.reviewId);
        error.textContent = failureMessage(result.failure);
        if (result.failure === 'CONFLICT') {
          submit.disabled = true;
          const reload = h(
            'button',
            { class: 'ghost', type: 'button' },
            tr('إعادة تحميل التقييم', 'Reload review'),
          );
          reload.addEventListener('click', () => {
            closeModal();
            changed();
          });
          append(error, reload);
        } else {
          setFrozen(pending.has(item.reviewId));
          submit.textContent = tr('إعادة المحاولة', 'Retry');
        }
        return;
      }
      if (result.value.reviewId !== item.reviewId || result.value.bookingId !== item.bookingId) {
        error.textContent = copy().unknownOutcome;
        setFrozen(true);
        return;
      }
      pending.delete(item.reviewId);
      closeModal();
      toast(tr('تم تسجيل قرار المراجعة.', 'Moderation decision recorded.'));
      changed();
    });
  });
  openModal({
    title: tr('مراجعة تقييم العميل', 'Moderate customer review'),
    body: [
      h('p', {}, `${tr('الحجز', 'Booking')}: ${shortRef(item.bookingId)}`),
      h('p', {}, `${item.rating} / 5 · ${reviewStatus(item.status)}`),
      h('p', { dir: 'auto' }, item.comment ?? tr('بدون تعليق', 'No comment')),
      h(
        'p',
        {},
        item.publicationConsent
          ? tr('وافق العميل على النشر.', 'The customer consented to publication.')
          : tr(
              'التقييم خاص؛ لا توجد موافقة على النشر.',
              'This review is private; publication consent was not given.',
            ),
      ),
      h('label', {}, tr('القرار', 'Decision'), decision),
      h('label', {}, tr('السبب', 'Reason'), reason),
      error,
    ],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}

export async function showCustomerReviews(): Promise<void> {
  const current = ++generation;
  const { host, content, more, refresh } = frame(
    'reviews',
    tr('التقييمات', 'Reviews'),
    tr(
      'مراجعة موافقة العميل ومحتوى التقييم قبل النشر.',
      'Review customer consent and content before publication.',
    ),
  );
  const lookup = h('input', {
    type: 'text',
    dir: 'ltr',
    autocomplete: 'off',
    placeholder: tr('رقم الحجز الكامل', 'Full booking reference'),
    'aria-label': tr('رقم الحجز الكامل', 'Full booking reference'),
  });
  const lookupButton = h(
    'button',
    { class: 'ghost', type: 'submit' },
    tr('فتح التقييم', 'Open review'),
  );
  const lookupStatus = h('p', { role: 'status' });
  const form = h('form', { class: 'toolbar' }, lookup, lookupButton, lookupStatus);
  content.before(form);
  const reload = (): void => {
    void showCustomerReviews();
  };
  refresh.addEventListener('click', reload);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = lookup.value.trim();
    if (!UUID.test(id)) {
      lookupStatus.textContent = copy().invalid;
      return;
    }
    lookupButton.disabled = true;
    void customerReviewForBooking(id).then((result) => {
      if (current !== generation) return;
      lookupButton.disabled = false;
      if (result.ok) {
        lookupStatus.textContent = '';
        openReview(result.value, reload);
      } else if (result.failure === 'UNAUTHENTICATED') unauthenticated();
      else lookupStatus.textContent = failureMessage(result.failure);
    });
  });
  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...[
          tr('الحجز', 'Booking'),
          tr('التقييم', 'Rating'),
          tr('التاريخ', 'Date'),
          tr('الإجراء', 'Action'),
        ].map((label) => h('th', { scope: 'col' }, label)),
      ),
    ),
  );
  const rows = h('tbody');
  append(table, rows);
  let loading = false;
  const load = async (cursor?: string): Promise<void> => {
    if (loading) return;
    loading = true;
    host.setAttribute('aria-busy', 'true');
    replace(more);
    if (!cursor) problem(content, copy().loading);
    const result = await pendingCustomerReviews(cursor);
    if (current !== generation) return;
    loading = false;
    host.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      if (result.failure === 'UNAUTHENTICATED') {
        unauthenticated();
        return;
      }
      if (cursor) append(more, h('p', { role: 'alert' }, failureMessage(result.failure)));
      else problem(content, failureMessage(result.failure));
      const retry = h('button', { class: 'ghost', type: 'button' }, copy().retry);
      retry.addEventListener('click', () => void load(cursor));
      append(more, retry);
      return;
    }
    if (!cursor) replace(content, table);
    for (const item of result.value.items) {
      const button = h('button', { class: 'ghost', type: 'button' }, tr('مراجعة', 'Review'));
      button.addEventListener('click', () => openReview(item, reload));
      append(
        rows,
        h(
          'tr',
          {},
          h('td', { title: item.bookingId }, shortRef(item.bookingId)),
          h('td', {}, `${item.rating} / 5`),
          h('td', {}, formatInstant(item.submittedAt)),
          h('td', {}, button),
        ),
      );
    }
    if (!rows.children.length)
      problem(content, tr('لا توجد تقييمات تنتظر المراجعة.', 'No reviews await moderation.'));
    if (result.value.nextCursor) {
      const cursorNext = result.value.nextCursor;
      const button = h('button', { class: 'ghost', type: 'button' }, copy().loadMore);
      button.addEventListener('click', () => void load(cursorNext));
      append(more, button);
    }
  };
  await load();
}

export async function showNotifications(): Promise<void> {
  const current = ++generation;
  const { host, content, more, refresh } = frame(
    'notifications',
    tr('الإشعارات', 'Notifications'),
    tr(
      'حالة تسليم الرسائل حسب آخر تحديث من نظام الإرسال.',
      'Delivery status from the latest messaging update.',
    ),
  );
  const booking = h('input', {
    dir: 'ltr',
    placeholder: tr('رقم الحجز — اختياري', 'Booking reference — optional'),
    'aria-label': tr('رقم الحجز', 'Booking reference'),
  });
  const state = h(
    'select',
    { 'aria-label': tr('الحالة', 'State') },
    h('option', { value: '' }, tr('جميع الحالات', 'All states')),
    ...DELIVERY_STATES.map((value) => h('option', { value }, copy().delivery[value])),
  );
  const apply = h('button', { class: 'primary', type: 'submit' }, tr('تطبيق', 'Apply'));
  const form = h('form', { class: 'toolbar' }, booking, state, apply);
  content.before(form);
  let requestGeneration = 0;
  let filter: { bookingId?: string; state?: string } = {};
  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...[
          tr('المرجع', 'Reference'),
          tr('القناة', 'Channel'),
          tr('الحالة', 'State'),
          tr('المحاولات', 'Attempts'),
          tr('آخر تحديث', 'Last updated'),
        ].map((label) => h('th', { scope: 'col' }, label)),
      ),
    ),
  );
  const rows = h('tbody');
  append(table, rows);
  const load = async (cursor?: string): Promise<void> => {
    const request = ++requestGeneration;
    host.setAttribute('aria-busy', 'true');
    replace(more);
    if (!cursor) {
      replace(rows);
      problem(content, copy().loading);
    }
    const result = await notifications({ ...filter, ...(cursor ? { cursor } : {}) });
    if (current !== generation || request !== requestGeneration) return;
    host.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      if (result.failure === 'UNAUTHENTICATED') {
        unauthenticated();
        return;
      }
      if (cursor) append(more, h('p', { role: 'alert' }, failureMessage(result.failure)));
      else problem(content, failureMessage(result.failure));
      const retry = h('button', { class: 'ghost', type: 'button' }, copy().retry);
      retry.addEventListener('click', () => void load(cursor));
      append(more, retry);
      return;
    }
    if (!cursor) replace(content, table);
    for (const item of result.value.items)
      append(
        rows,
        h(
          'tr',
          {},
          h('td', { title: item.subject?.ref ?? item.id }, shortRef(item.subject?.ref ?? item.id)),
          h('td', {}, item.channel),
          h('td', {}, copy().delivery[item.state]),
          h('td', {}, String(item.attemptCount)),
          h('td', {}, formatInstant(item.updatedAt)),
        ),
      );
    if (!rows.children.length)
      problem(content, tr('لا توجد إشعارات تطابق البحث.', 'No notifications match these filters.'));
    if (result.value.nextCursor) {
      const next = result.value.nextCursor;
      const button = h('button', { class: 'ghost', type: 'button' }, copy().loadMore);
      button.addEventListener('click', () => {
        button.disabled = true;
        void load(next);
      });
      append(more, button);
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = booking.value.trim();
    if (id && !UUID.test(id)) {
      problem(content, copy().invalid);
      return;
    }
    filter = { ...(id ? { bookingId: id } : {}), ...(state.value ? { state: state.value } : {}) };
    void load();
  });
  refresh.addEventListener('click', () => void load());
  await load();
}
