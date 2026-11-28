import type { Result } from '../api/http';
import type { VehicleType } from '@carwash/contracts/common';
import { h, byId, replace } from './dom';
import { copy, lang } from './i18n';
import { failureMessage } from './states';
import './domain-screens.css';

export const tr = (ar: string, en: string): string => (lang() === 'ar' ? ar : en);
export function vehicleName(type: VehicleType): string {
  return {
    sedan: tr('سيدان', 'Sedan'),
    suv: tr('دفع رباعي', 'SUV'),
    large: tr('عائلية كبيرة', 'Large vehicle'),
    pickup: tr('بيك أب', 'Pickup'),
  }[type];
}
export function ensureScreen(id: string): void {
  if (!document.getElementById(id))
    byId('console-state').before(
      h('section', { id, class: 'screen', 'aria-labelledby': `${id}Title` }),
    );
}
export function frame(id: string, title: string, description: string) {
  const host = byId(id);
  const actions = h('div', { class: 'form-actions' });
  const refresh = h('button', { class: 'ghost', type: 'button' }, tr('تحديث', 'Refresh'));
  actions.append(refresh);
  const content = h('div', { 'aria-live': 'polite' });
  const more = h('div', { class: 'load-more' });
  replace(
    host,
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', { id: `${id}Title` }, title), h('p', {}, description)),
      actions,
    ),
    content,
    more,
  );
  return { host, actions, refresh, content, more };
}
export function status(host: Element, value: string): void {
  replace(host, h('p', { class: 'state-cell', role: 'status' }, value));
}
export function readFailure<T>(
  host: Element,
  result: Result<T>,
  unauthorized: () => void,
): boolean {
  if (result.ok) return false;
  if (result.failure === 'UNAUTHENTICATED') unauthorized();
  else status(host, failureMessage(result.failure));
  return true;
}
export function label(ar: string, en: string, input: HTMLElement): HTMLLabelElement {
  return h('label', {}, tr(ar, en), input);
}
export function input(value = '', type = 'text', maxLength = 80): HTMLInputElement {
  return h('input', { value, type, maxlength: String(maxLength), autocomplete: 'off' });
}
export function select(
  options: readonly (readonly [string, string, string])[],
  value?: string,
): HTMLSelectElement {
  const field = h(
    'select',
    {},
    ...options.map(([id, ar, en]) => h('option', { value: id }, tr(ar, en))),
  );
  if (value !== undefined) field.value = value;
  return field;
}
export function table(headers: readonly string[]) {
  const rows = h('tbody');
  return {
    rows,
    table: h(
      'div',
      { class: 'card panel table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ...headers.map((value) => h('th', { scope: 'col' }, value)))),
        rows,
      ),
    ),
  };
}
export function freeze(form: HTMLFormElement, frozen: boolean): void {
  for (const field of form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input,select,textarea'))
    field.disabled = frozen;
}
export function invalid(message: HTMLElement): void {
  message.textContent = copy().invalid;
}
