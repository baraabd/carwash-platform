/**
 * Minimal safe DOM builder. Text is always assigned as text nodes: server data
 * can never become markup, so no value needs HTML escaping.
 */
type Attributes = Readonly<Record<string, string | boolean | undefined>>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: readonly Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') element.className = String(value);
    else element.setAttribute(name, value === true ? '' : value);
  }
  append(element, ...children);
  return element;
}

export function append(parent: Node, ...children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function replace(parent: Element, ...children: readonly Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MISSING_ELEMENT ${id}`);
  return element as T;
}
