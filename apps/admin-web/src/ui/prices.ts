import { CURRENCIES } from '@carwash/contracts/common';
import { VEHICLE_TYPES, type CatalogV1 } from '@carwash/contracts/catalog-v1';
import {
  parsePublishPriceBookRequestV1,
  type CurrentPriceBookV1,
  type PriceBookEntryV1,
  type PublishPriceBookRequestV1,
} from '@carwash/contracts/pricing-v1';
import { currentPriceBook, publishPriceBook } from '../api/catalog-coverage';
import { idempotencyKey } from '../api/http';
import { formatMoney, parseAmount } from '../domain/finance';
import { append, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant } from './states';
import {
  freeze,
  input,
  invalid,
  label,
  select,
  status,
  table,
  tr,
  vehicleName,
} from './domain-screen';

let pending: { readonly body: PublishPriceBookRequestV1; readonly key: string } | null = null;
export function invalidatePrices(clearPrivate = false): void {
  if (clearPrivate) pending = null;
}
interface Context {
  readonly alive: () => boolean;
  readonly unauthorized: () => void;
  readonly reload: () => void;
  readonly canPublish: () => boolean;
}
const decimal = (entry: PriceBookEntryV1): string => {
  const digits = entry.unitPrice.amountMinor.padStart(entry.unitPrice.scale + 1, '0');
  return entry.unitPrice.scale
    ? `${digits.slice(0, -entry.unitPrice.scale)}.${digits.slice(-entry.unitPrice.scale)}`
    : digits;
};
function publishDialog(
  body: PublishPriceBookRequestV1,
  catalog: CatalogV1,
  context: Context,
): void {
  let active = true,
    busy = false;
  const message = h('p', { role: 'alert', class: 'field-error' });
  const submit = h(
    'button',
    { type: 'button', class: 'primary' },
    pending
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('نشر الأسعار', 'Publish prices'),
  );
  submit.addEventListener('click', () => {
    if (busy || !context.canPublish()) return;
    const intent = pending ?? { body, key: idempotencyKey() };
    pending = intent;
    busy = true;
    submit.disabled = true;
    void publishPriceBook(intent.body, intent.key).then((result) => {
      if (!active || !context.alive()) return;
      busy = false;
      submit.disabled = false;
      if (!result.ok) {
        if (result.failure === 'UNAUTHENTICATED') {
          context.unauthorized();
          return;
        }
        if (result.failure !== 'UNKNOWN_OUTCOME') pending = null;
        message.textContent = failureMessage(result.failure);
        if (result.failure === 'CONFLICT') submit.disabled = true;
        else
          submit.textContent = pending
            ? tr('إعادة الطلب نفسه', 'Retry the same request')
            : copy().retry;
        return;
      }
      pending = null;
      closeModal();
      toast(
        tr(
          'نُشر إصدار الأسعار؛ جارٍ قراءة النسخة الحالية.',
          'Price version published; reading the current book.',
        ),
      );
      context.reload();
    });
  });
  const review = table([
    tr('الخدمة', 'Service'),
    tr('نوع السيارة', 'Vehicle type'),
    tr('السعر بعد النشر', 'Published price'),
  ]);
  for (const entry of body.entries) {
    const definition = catalog.items.find((item) => item.definitionId === entry.definitionId);
    review.rows.append(
      h(
        'tr',
        {},
        h('td', {}, definition?.name.ar ?? entry.definitionId),
        h(
          'td',
          {},
          entry.vehicleType ? vehicleName(entry.vehicleType) : tr('كل السيارات', 'All vehicles'),
        ),
        h('td', {}, formatMoney(entry.unitPrice)),
      ),
    );
  }
  openModal({
    title: tr('تأكيد إصدار الأسعار', 'Confirm price-book version'),
    body: [
      h('p', {}, `${tr('الإصدار الجديد', 'New revision')}: ${body.expectedPriceBookRevision}`),
      h(
        'p',
        {},
        `${tr('عدد قواعد الأسعار', 'Price entries')}: ${body.entries.length} · ${body.currency}`,
      ),
      review.table,
      h(
        'p',
        { class: 'muted' },
        tr(
          'نشر هذا الإصدار يحفظ بقية الأسعار المقروءة دون تغيير. عروض الأسعار السابقة تبقى حقائق مستقلة.',
          'This publication retains the other owner-read entries. Existing quotes remain independent records.',
        ),
      ),
      message,
    ],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}
function editPrice(
  catalog: CatalogV1,
  current: CurrentPriceBookV1,
  existing: PriceBookEntryV1 | null,
  context: Context,
): void {
  if (pending || !context.canPublish()) return;
  const definition = select(
    catalog.items
      .filter((item) => item.status === 'PUBLISHED' || item.definitionId === existing?.definitionId)
      .map((item) => [item.definitionId, item.name.ar, item.name.en ?? item.name.ar] as const),
    existing?.definitionId,
  );
  const vehicle = select(
    [
      ['', 'كل السيارات — سعر افتراضي', 'All vehicles — default price'],
      ...VEHICLE_TYPES.map((value) => [value, vehicleName(value), vehicleName(value)] as const),
    ],
    existing?.vehicleType ?? '',
  );
  const amount = input(existing ? decimal(existing) : '');
  amount.inputMode = 'decimal';
  amount.dir = 'ltr';
  const message = h('p', { class: 'field-error', role: 'alert' });
  const form = h(
    'form',
    { class: 'domain-form action-form' },
    label('الخدمة', 'Service', definition),
    label('نوع السيارة', 'Vehicle type', vehicle),
    label(`السعر (${current.policyCurrency})`, `Price (${current.policyCurrency})`, amount),
    message,
  );
  if (existing) {
    definition.disabled = true;
    vehicle.disabled = true;
  }
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    tr('مراجعة السعر الجديد', 'Review new price'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });
  submit.addEventListener('click', () => {
    try {
      const parsed = parseAmount(
        amount.value,
        current.policyCurrency,
        CURRENCIES[current.policyCurrency],
      );
      if (!parsed.ok) throw new Error('amount');
      const body = parsePublishPriceBookRequestV1({
        expectedPriceBookRevision: current.nextExpectedPriceBookRevision,
        currency: current.policyCurrency,
        entries: [
          ...(current.priceBook?.entries ?? []).filter(
            (entry) =>
              entry.definitionId !== definition.value ||
              entry.vehicleType !== (vehicle.value || null),
          ),
          {
            definitionId: definition.value,
            vehicleType: vehicle.value || null,
            unitPrice: parsed.value,
          },
        ],
      });
      freeze(form, true);
      publishDialog(body, catalog, context);
    } catch {
      invalid(message);
    }
  });
  openModal({
    title: tr(
      existing ? 'تعديل سعر الخدمة' : 'إضافة سعر خدمة',
      existing ? 'Edit service price' : 'Add service price',
    ),
    body: [form],
    foot: [submit],
  });
}

export async function showPrices(
  catalog: CatalogV1,
  host: HTMLElement,
  context: Context,
): Promise<void> {
  status(host, copy().loading);
  const result = await currentPriceBook();
  if (!context.alive()) return;
  if (!result.ok) {
    if (result.failure === 'UNAUTHENTICATED') {
      context.unauthorized();
      return;
    }
    status(host, failureMessage(result.failure));
    const retry = h('button', { class: 'ghost', type: 'button' }, copy().retry);
    retry.addEventListener('click', () => void showPrices(catalog, host, context));
    host.append(retry);
    return;
  }
  const current = result.value;
  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('h2', {}, tr('أسعار الخدمات', 'Service prices')),
  );
  if (pending) {
    const command = pending.body;
    const retry = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('متابعة نشر الأسعار غير المحسوم', 'Resolve uncertain price publication'),
    );
    retry.addEventListener('click', () => publishDialog(command, catalog, context));
    toolbar.append(retry);
  } else if (!current.priceBook || current.priceBook.currency === current.policyCurrency) {
    const add = h(
      'button',
      {
        class: 'primary',
        type: 'button',
        disabled: !catalog.items.some((item) => item.status === 'PUBLISHED'),
      },
      tr('+ سعر خدمة', '+ Service price'),
    );
    add.addEventListener('click', () => editPrice(catalog, current, null, context));
    toolbar.append(add);
  }
  const data = table([
    tr('الخدمة', 'Service'),
    tr('نوع السيارة', 'Vehicle type'),
    tr('السعر', 'Price'),
    tr('الإجراء', 'Action'),
  ]);
  for (const entry of current.priceBook?.entries ?? []) {
    const definition = catalog.items.find((item) => item.definitionId === entry.definitionId);
    const edit = h(
      'button',
      {
        class: 'ghost',
        type: 'button',
        disabled: Boolean(pending) || current.priceBook?.currency !== current.policyCurrency,
      },
      tr('تعديل', 'Edit'),
    );
    edit.addEventListener('click', () => editPrice(catalog, current, entry, context));
    append(
      data.rows,
      h(
        'tr',
        {},
        h('td', {}, definition?.name.ar ?? entry.definitionId),
        h(
          'td',
          {},
          entry.vehicleType ? vehicleName(entry.vehicleType) : tr('كل السيارات', 'All vehicles'),
        ),
        h('td', {}, formatMoney(entry.unitPrice)),
        h('td', {}, edit),
      ),
    );
  }
  replace(
    host,
    toolbar,
    h(
      'p',
      { class: 'muted' },
      current.priceBook
        ? `${tr('الإصدار الحالي', 'Current revision')} ${current.priceBook.priceBookRevision} · ${formatInstant(current.priceBook.publishedAt)}`
        : tr('لم يُنشر سجل أسعار بعد.', 'No price book has been published.'),
    ),
    data.table,
  );
  if (current.priceBook && current.priceBook.currency !== current.policyCurrency)
    host.append(
      h(
        'p',
        { role: 'alert' },
        tr(
          'تغيّرت سياسة العملة. يلزم تسعير جميع البنود وفق العملة الجديدة دون تحويل تلقائي.',
          'The currency policy changed. All entries require explicit repricing; no automatic conversion is applied.',
        ),
      ),
    );
}
