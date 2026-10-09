/**
 * DOM helpers ported from the approved reference
 * (design/reference/approved/washgo-technician-interactive.html, `$`, `$$`,
 * `escape`, `I`). Markup strings keep the reference's exact structure.
 *
 * Inline `style="..."` attributes in the reference are emitted here as
 * `data-style="..."` and applied through the CSSOM by `applyInlineStyles`,
 * because the production CSP (`style-src 'self'`) blocks style attributes
 * parsed from markup. The rendered declarations are identical.
 */

export const $ = <T extends Element = HTMLElement>(
  q: string,
  root: ParentNode = document,
): T | null => root.querySelector<T>(q as never);

export const $$ = <T extends Element = HTMLElement>(q: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(q as never)] as T[];

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escape = (value: string | number | boolean | null | undefined): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Reference `I(name, cls)`: an icon from the inline SVG sprite. */
export const I = (name: string, cls = ''): string =>
  `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Replace the reference `style="..."` attribute in a markup template. */
export const st = (css: string): string => `data-style="${escape(css)}"`;

/** CSP-safe application of the reference inline declarations (CSSOM, not markup). */
export function applyInlineStyles(root: ParentNode): void {
  const host = root as Element;
  const list: Element[] = [];
  if (typeof host.hasAttribute === 'function' && host.hasAttribute('data-style')) list.push(host);
  list.push(...root.querySelectorAll('[data-style]'));
  for (const element of list) {
    const css = element.getAttribute('data-style') ?? '';
    element.removeAttribute('data-style');
    (element as HTMLElement | SVGElement).style.cssText = css;
  }
}

/** Set markup and apply its inline declarations in one step. */
export function setHtml(element: Element, markup: string): void {
  element.innerHTML = markup;
  applyInlineStyles(element);
}

export function must<T extends Element>(q: string): T {
  const element = document.querySelector<T>(q as never);
  if (!element) throw new Error(`BOOT_ELEMENT_MISSING:${q}`);
  return element;
}
