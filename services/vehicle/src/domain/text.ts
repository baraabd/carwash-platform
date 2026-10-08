/** Text normalisation shared by the vehicle domain rules. */

/**
 * Control characters are never valid in stored vehicle text: C0 except TAB, LF
 * and CR (which collapse to a space), DEL and C1.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

export function hasControlCharacters(value: string): boolean {
  return CONTROL.test(value);
}

/** NFC, trimmed, inner whitespace runs collapsed to one space. */
export function singleLine(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Length in user-perceived code points rather than UTF-16 units. */
export function codePointLength(value: string): number {
  return [...value].length;
}
