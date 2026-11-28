import { coordinatesFromDegrees } from '@carwash/contracts/common';
import {
  parseDefinitionDraftV1,
  parsePublishCatalogRequestV1,
  VEHICLE_TYPES,
  type CurrentCatalogV1,
  type DefinitionV1,
  type PublishCatalogRequestV1,
} from '@carwash/contracts/catalog-v1';
import {
  checkServiceability,
  currentCatalog,
  publishCatalog,
  serviceZones,
  zoneAvailability,
} from '../api/catalog-coverage';
import { idempotencyKey } from '../api/http';
import { append, h, replace } from './dom';
import { copy, lang } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant } from './states';
import {
  ensureScreen,
  frame,
  input,
  invalid,
  label,
  readFailure,
  select,
  status,
  table,
  tr,
  vehicleName,
} from './domain-screen';
import { showPrices, invalidatePrices } from './prices';

interface Wiring {
  readonly unauthenticated: () => void;
  readonly permissions: () => readonly string[];
}
let wiring: Wiring = { unauthenticated: () => undefined, permissions: () => [] };
let generation = 0;
let pendingPublication: { readonly key: string; readonly body: PublishCatalogRequestV1 } | null =
  null;

export function wireDomainScreens(value: Wiring): void {
  wiring = value;
  ensureScreen('services');
  ensureScreen('coverage');
}
export function invalidateDomainScreens(clearPrivate = false): void {
  generation++;
  invalidatePrices(clearPrivate);
  if (clearPrivate) {
    pendingPublication = null;
    for (const id of ['services', 'coverage']) document.getElementById(id)?.replaceChildren();
  }
}
const canPublish = (): boolean => wiring.permissions().includes('catalog.publish');

function publicationDialog(currentCatalog: CurrentCatalogV1, existing: DefinitionV1 | null): void {
  if (!canPublish() || pendingPublication) return;
  const catalog = currentCatalog.catalog;
  const opened = generation;
  let active = true;
  const name = input(existing?.name.ar ?? ''),
    english = input(existing?.name.en ?? '');
  const code = input(existing?.code ?? '', 'text', 40);
  const duration = input(String(existing?.durationMinutes ?? 30), 'number');
  duration.min = '5';
  duration.max = '480';
  const order = input(String(existing?.sortOrder ?? catalog?.items.length ?? 0), 'number');
  order.min = '0';
  order.max = '10000';
  const kind = select(
    [
      ['PACKAGE', 'باقة', 'Package'],
      ['EXTRA', 'إضافة', 'Extra'],
    ],
    existing?.kind,
  );
  const publication = select(
    [
      ['PUBLISHED', 'منشور', 'Published'],
      ['RETIRED', 'متوقف', 'Retired'],
    ],
    existing?.status,
  );
  const description = h(
    'textarea',
    { maxlength: '500', rows: '3' },
    existing?.description.ar ?? '',
  );
  const descriptionEn = h(
    'textarea',
    { maxlength: '500', rows: '3' },
    existing?.description.en ?? '',
  );
  const choices = VEHICLE_TYPES.map((type) => {
    const field = h('input', {
      type: 'checkbox',
      value: type,
      checked: existing?.vehicleTypes.includes(type) ?? true,
    });
    return { type, field };
  });
  const reason = input('', 'text', 64);
  reason.placeholder = 'CATALOG_UPDATE';
  reason.dir = 'ltr';
  const message = h('p', { class: 'field-error', role: 'alert' });
  const form = h(
    'form',
    { class: 'action-form domain-form' },
    label('النوع', 'Kind', kind),
    label('رمز الخدمة', 'Service code', code),
    label('الاسم بالعربية', 'Arabic name', name),
    label('الاسم بالإنجليزية — اختياري', 'English name — optional', english),
    label('الوصف بالعربية', 'Arabic description', description),
    label('الوصف بالإنجليزية — اختياري', 'English description — optional', descriptionEn),
    label('المدة بالدقائق', 'Duration in minutes', duration),
    label('الترتيب', 'Display order', order),
    h(
      'fieldset',
      { class: 'domain-choices' },
      h('legend', {}, tr('السيارات المشمولة', 'Eligible vehicles')),
      ...choices.map(({ type, field }) => h('label', {}, field, vehicleName(type))),
    ),
    label('حالة النشر', 'Publication state', publication),
    label('سبب التغيير — رمز إداري', 'Change reason — administrative code', reason),
    h(
      'p',
      { class: 'muted' },
      tr(
        'سيُنشر إصدار جديد مع الاحتفاظ ببقية الخدمات. التسعير تملكه خدمة الأسعار.',
        'A new version retains every other service. Prices are managed by Pricing.',
      ),
    ),
    message,
  );
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    tr('مراجعة النشر', 'Review publication'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });
  submit.addEventListener('click', () => {
    let body: PublishCatalogRequestV1;
    try {
      const item = parseDefinitionDraftV1({
        definitionId: existing?.definitionId ?? crypto.randomUUID(),
        kind: kind.value,
        code: code.value.trim(),
        name: { ar: name.value.trim(), en: english.value.trim() || null },
        description: { ar: description.value.trim(), en: descriptionEn.value.trim() || null },
        durationMinutes: Number(duration.value),
        vehicleTypes: choices.filter((choice) => choice.field.checked).map((choice) => choice.type),
        status: publication.value,
        sortOrder: Number(order.value),
      });
      const definitions = (catalog?.items ?? [])
        .map(
          ({
            definitionId,
            kind,
            code,
            name,
            description,
            durationMinutes,
            vehicleTypes,
            status,
            sortOrder,
          }) => ({
            definitionId,
            kind,
            code,
            name,
            description,
            durationMinutes,
            vehicleTypes,
            status,
            sortOrder,
          }),
        )
        .filter((draft) => draft.definitionId !== item.definitionId);
      body = parsePublishCatalogRequestV1({
        expectedCatalogRevision: currentCatalog.expectedCatalogRevision,
        definitions: [...definitions, item],
        reasonCode: reason.value.trim(),
      });
    } catch {
      invalid(message);
      return;
    }
    if (!active || opened !== generation) return;
    confirmPublication(body);
  });
  openModal({
    title: tr(existing ? 'تعديل الخدمة' : 'إضافة خدمة', existing ? 'Edit service' : 'Add service'),
    body: [form],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}

function confirmPublication(body: PublishCatalogRequestV1): void {
  const current = generation;
  let active = true,
    busy = false;
  const message = h('p', { role: 'alert', class: 'field-error' });
  const submit = h(
    'button',
    { type: 'button', class: 'primary' },
    pendingPublication
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('نشر الإصدار', 'Publish version'),
  );
  const execute = (): void => {
    if (busy || !canPublish()) return;
    const intent = pendingPublication ?? { body, key: idempotencyKey() };
    pendingPublication = intent;
    busy = true;
    submit.disabled = true;
    void publishCatalog(intent.body, intent.key).then((result) => {
      if (!active || current !== generation) return;
      busy = false;
      submit.disabled = false;
      if (!result.ok) {
        if (result.failure === 'UNAUTHENTICATED') {
          wiring.unauthenticated();
          return;
        }
        if (result.failure !== 'UNKNOWN_OUTCOME') pendingPublication = null;
        message.textContent = failureMessage(result.failure);
        if (result.failure === 'CONFLICT') submit.disabled = true;
        else submit.textContent = tr('إعادة الطلب نفسه', 'Retry the same request');
        return;
      }
      pendingPublication = null;
      closeModal();
      toast(tr('تم نشر إصدار الخدمات.', 'Catalog version published.'));
      void showServices();
    });
  };
  submit.addEventListener('click', execute);
  openModal({
    title: tr('تأكيد نشر الخدمات', 'Confirm catalog publication'),
    body: [
      h('p', {}, `${tr('الإصدار الحالي', 'Current revision')}: ${body.expectedCatalogRevision}`),
      h(
        'p',
        {},
        `${tr('عدد الخدمات في الإصدار', 'Definitions in version')}: ${body.definitions.length}`,
      ),
      h('p', {}, `${tr('السبب', 'Reason')}: ${body.reasonCode}`),
      message,
    ],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}

export async function showServices(): Promise<void> {
  const current = ++generation;
  const view = frame(
    'services',
    tr('الخدمات والباقات', 'Services & packages'),
    tr(
      'التعريفات والمدد والسيارات المشمولة من سجل الخدمات المنشور.',
      'Published service definitions, durations and eligible vehicles.',
    ),
  );
  view.refresh.addEventListener('click', () => void showServices());
  status(view.content, copy().loading);
  if (pendingPublication && canPublish()) {
    const body = pendingPublication.body;
    const retry = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('متابعة النشر غير المحسوم', 'Resolve uncertain publication'),
    );
    retry.addEventListener('click', () => confirmPublication(body));
    view.actions.append(retry);
  }
  const result = await currentCatalog();
  if (current !== generation) return;
  if (readFailure(view.content, result, wiring.unauthenticated) || !result.ok) return;
  const currentState = result.value;
  const catalog = currentState.catalog;
  if (canPublish() && !pendingPublication) {
    const create = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('+ خدمة جديدة', '+ New service'),
    );
    create.addEventListener('click', () => publicationDialog(currentState, null));
    view.actions.append(create);
  }
  const grid = h('div', { class: 'grid section-grid' });
  for (const item of catalog?.items ?? []) {
    const card = h(
      'div',
      { class: 'card simple' },
      h('h3', {}, lang() === 'en' ? (item.name.en ?? item.name.ar) : item.name.ar),
      h(
        'p',
        {},
        `${item.durationMinutes} ${tr('دقيقة', 'minutes')} · ${item.kind === 'PACKAGE' ? tr('باقة', 'Package') : tr('إضافة', 'Extra')}`,
      ),
      h('p', {}, item.status === 'PUBLISHED' ? tr('منشور', 'Published') : tr('متوقف', 'Retired')),
      h('p', {}, item.vehicleTypes.map(vehicleName).join(' · ')),
    );
    if (canPublish() && !pendingPublication) {
      const edit = h('button', { type: 'button', class: 'ghost' }, tr('تعديل', 'Edit'));
      edit.addEventListener('click', () => publicationDialog(currentState, item));
      card.append(edit);
    }
    grid.append(card);
  }
  replace(
    view.content,
    h(
      'p',
      { class: 'muted' },
      catalog
        ? `${tr('الإصدار', 'Revision')} ${catalog.catalogRevision} · ${formatInstant(catalog.publishedAt)}`
        : tr(
            'لم يُنشر كتالوج بعد. يمكن لصاحب صلاحية النشر إنشاء الخدمة الأولى.',
            'The catalog is unpublished. A publisher can create the first service.',
          ),
    ),
    grid,
  );
  if (!catalog?.items.length)
    status(grid, tr('لم تُنشر خدمات بعد.', 'No services are published yet.'));
  if (catalog && wiring.permissions().includes('pricing.prices.publish')) {
    const prices = h('section', { class: 'card panel lookup-panel' });
    view.content.append(prices);
    void showPrices(catalog, prices, {
      alive: () => current === generation,
      unauthorized: wiring.unauthenticated,
      reload: () => {
        void showServices();
      },
      canPublish: () => wiring.permissions().includes('pricing.prices.publish'),
    });
  }
}

export async function showCoverage(): Promise<void> {
  const current = ++generation;
  const view = frame(
    'coverage',
    tr('المناطق والتغطية', 'Areas & coverage'),
    tr(
      'مناطق الخدمة والمواعيد المتاحة من الجهات المالكة.',
      'Owner-reported service zones and available slots.',
    ),
  );
  view.refresh.addEventListener('click', () => void showCoverage());
  status(view.content, copy().loading);
  const result = await serviceZones();
  if (current !== generation) return;
  if (readFailure(view.content, result, wiring.unauthenticated) || !result.ok) return;
  const zones = result.value;
  const grid = h(
    'div',
    { class: 'grid section-grid' },
    ...zones.map((zone) =>
      h(
        'div',
        { class: 'card simple' },
        h('h3', {}, lang() === 'en' ? (zone.name.en ?? zone.name.ar) : zone.name.ar),
        h(
          'p',
          {},
          `${tr('الإصدار', 'Revision')} ${zone.revision} · ${zone.status === 'ACTIVE' ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}`,
        ),
      ),
    ),
  );
  const latitude = input('', 'number'),
    longitude = input('', 'number');
  latitude.step = longitude.step = '0.000001';
  latitude.min = '-90';
  latitude.max = '90';
  longitude.min = '-180';
  longitude.max = '180';
  latitude.setAttribute('aria-label', tr('خط العرض', 'Latitude'));
  longitude.setAttribute('aria-label', tr('خط الطول', 'Longitude'));
  latitude.placeholder = tr('خط العرض', 'Latitude');
  longitude.placeholder = tr('خط الطول', 'Longitude');
  const check = h(
    'button',
    { type: 'submit', class: 'primary' },
    tr('التحقق من الموقع', 'Check location'),
  );
  const pointResult = h('p', { role: 'status' });
  const pointForm = h('form', { class: 'toolbar' }, latitude, longitude, check);
  pointForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let point;
    try {
      if (!latitude.value.trim() || !longitude.value.trim()) throw new Error('point');
      point = coordinatesFromDegrees(Number(latitude.value), Number(longitude.value));
    } catch {
      invalid(pointResult);
      return;
    }
    check.disabled = true;
    void checkServiceability(point).then((value) => {
      if (current !== generation) return;
      check.disabled = false;
      if (!value.ok) {
        if (value.failure === 'UNAUTHENTICATED') wiring.unauthenticated();
        else pointResult.textContent = failureMessage(value.failure);
        return;
      }
      pointResult.textContent =
        value.value.decision === 'SERVICEABLE'
          ? `${tr('الموقع داخل التغطية', 'Location is covered')} · ${zones.find((zone) => zone.zoneId === value.value.zoneId)?.name.ar ?? value.value.zoneId} · ${formatInstant(value.value.checkedAt)}`
          : value.value.decision === 'OUTSIDE_ZONE'
            ? tr('الموقع خارج التغطية.', 'Location is outside coverage.')
            : tr('تعذر حسم التغطية؛ لا تُعد المنطقة متاحة.', 'Coverage could not be determined.');
    });
  });
  const zone = select(
    zones.map((item) => [item.zoneId, item.name.ar, item.name.en ?? item.name.ar] as const),
  );
  zone.setAttribute('aria-label', tr('المنطقة', 'Zone'));
  const date = input('', 'date');
  date.setAttribute('aria-label', tr('التاريخ', 'Date'));
  const duration = input('30', 'number');
  duration.min = '5';
  duration.max = '480';
  duration.setAttribute('aria-label', tr('المدة بالدقائق', 'Duration in minutes'));
  const load = h(
    'button',
    { class: 'primary', type: 'submit', disabled: !zones.length },
    tr('عرض المواعيد', 'Show slots'),
  );
  const slots = h('div', { 'aria-live': 'polite' });
  const slotForm = h('form', { class: 'toolbar' }, zone, date, duration, load);
  let query = 0;
  slotForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!zone.value || !date.value || !Number.isInteger(Number(duration.value))) {
      status(slots, copy().invalid);
      return;
    }
    const sequence = ++query;
    load.disabled = true;
    status(slots, copy().loading);
    void zoneAvailability(zone.value, date.value, Number(duration.value)).then((value) => {
      if (current !== generation || sequence !== query) return;
      load.disabled = false;
      if (readFailure(slots, value, wiring.unauthenticated) || !value.ok) return;
      const data = table([
        tr('البداية — توقيت دمشق', 'Start — Damascus time'),
        tr('النهاية', 'End'),
        tr('التوفر', 'Availability'),
      ]);
      const time = (instant: string): string =>
        new Intl.DateTimeFormat(lang() === 'ar' ? 'ar-SY' : 'en-GB', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Asia/Damascus',
        }).format(new Date(instant));
      for (const slot of value.value.slots)
        append(
          data.rows,
          h(
            'tr',
            {},
            h('td', {}, time(slot.startsAt)),
            h('td', {}, time(slot.endsAt)),
            h(
              'td',
              {},
              slot.availability === 'AVAILABLE'
                ? tr('متاح', 'Available')
                : tr('غير متاح', 'Unavailable'),
            ),
          ),
        );
      replace(
        slots,
        h(
          'p',
          { class: 'muted' },
          `${tr('آخر قراءة', 'Read at')}: ${formatInstant(value.value.asOf)}`,
        ),
        data.table,
      );
      if (!value.value.slots.length)
        status(slots, tr('لا توجد مواعيد لهذا الاختيار.', 'No slots match this selection.'));
    });
  });
  replace(
    view.content,
    grid,
    h(
      'section',
      { class: 'card panel' },
      h('h2', {}, tr('فحص نقطة الخدمة', 'Check a service location')),
      pointForm,
      pointResult,
    ),
    h(
      'section',
      { class: 'card panel lookup-panel' },
      h('h2', {}, tr('المواعيد المتاحة', 'Available slots')),
      slotForm,
      slots,
    ),
  );
}
