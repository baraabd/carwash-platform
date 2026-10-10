import { append, byId, h, replace } from './dom';
import { SEARCH_PLACEHOLDER, SHELL, copy, lang, setLang, type Lang } from './i18n';

/**
 * Shell behaviour of the approved reference (navigation, mobile menu, language
 * toggle, modal and toast), with keyboard and focus handling added. Screens
 * the console does not implement keep their navigation entry, disabled.
 */
const LANG_KEY = 'washgo.admin.lang';

export function applyLanguage(next: Lang): void {
  setLang(next);
  const root = document.documentElement;
  root.lang = next;
  root.dir = next === 'ar' ? 'rtl' : 'ltr';
  const button = byId<HTMLButtonElement>('langBtn');
  button.textContent = next === 'ar' ? 'EN' : 'AR';
  button.lang = next === 'ar' ? 'en' : 'ar';
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n ?? '';
    const value = SHELL[next][key];
    if (value) element.textContent = value;
  }
  const search = byId<HTMLInputElement>('globalSearch');
  search.placeholder = SEARCH_PLACEHOLDER[next];
  search.setAttribute('aria-label', SEARCH_PLACEHOLDER[next]);
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // A per-viewer preference only; the console works without storage.
  }
}

export function storedLanguage(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function markActive(screen: string | null): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.nav button[data-screen]')) {
    const active = button.dataset.screen === screen;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll<HTMLElement>('.screen'))
    section.classList.toggle('active', section.id === (screen ?? 'console-state'));
}

export function wireShell(onLanguage: () => void): void {
  const sidebar = byId('sidebar');
  const menu = byId<HTMLButtonElement>('menuBtn');
  menu.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('.nav button[data-screen]')) {
    if (button.disabled) button.title = copy().pendingScreen;
    button.addEventListener('click', () => {
      sidebar.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
      location.hash = `#/${button.dataset.screen ?? ''}`;
    });
  }
  byId('langBtn').addEventListener('click', () => {
    applyLanguage(lang() === 'ar' ? 'en' : 'ar');
    onLanguage();
  });
  const backdrop = byId('modalBackdrop');
  byId('modalClose').addEventListener('click', closeModal);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
    if (event.key === 'Tab' && backdrop.classList.contains('open')) trapFocus(event);
  });
}

/* ---------------------------------- modal ---------------------------------- */

let returnFocus: HTMLElement | null = null;
let onClose: (() => void) | null = null;

export interface ModalContent {
  readonly title: string;
  readonly body: readonly Node[];
  readonly foot: readonly Node[];
  readonly onClose?: () => void;
}

export function openModal(content: ModalContent): void {
  const backdrop = byId('modalBackdrop');
  if (!backdrop.classList.contains('open'))
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  onClose = content.onClose ?? null;
  byId('modalTitle').textContent = content.title;
  replace(byId('modalBody'), ...content.body);
  replace(byId('modalFoot'), ...content.foot);
  byId('modalClose').setAttribute('aria-label', copy().close);
  backdrop.classList.add('open');
  const first = focusable()[1] ?? focusable()[0];
  first?.focus();
}

export function closeModal(): void {
  const backdrop = byId('modalBackdrop');
  if (!backdrop.classList.contains('open')) return;
  backdrop.classList.remove('open');
  replace(byId('modalBody'));
  replace(byId('modalFoot'));
  const callback = onClose;
  onClose = null;
  callback?.();
  returnFocus?.focus();
  returnFocus = null;
}

function focusable(): HTMLElement[] {
  return [
    ...byId('modalBackdrop').querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ),
  ];
}

function trapFocus(event: KeyboardEvent): void {
  const items = focusable();
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ---------------------------------- toast ---------------------------------- */

let toastTimer: number | undefined;

export function toast(message: string): void {
  const element = byId('toast');
  element.textContent = message;
  element.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('show'), 4_000);
}

/* --------------------------- whole-console states --------------------------- */

export function showConsoleState(
  message: string,
  action?: { label: string; run: () => void },
): void {
  const state = byId('console-state');
  const panel = h('div', { class: 'card state-panel' }, h('p', {}, message));
  if (action) {
    const button = h('button', { class: 'primary', type: 'button' }, action.label);
    button.addEventListener('click', action.run);
    append(panel, button);
  }
  replace(state, panel);
  markActive(null);
}
