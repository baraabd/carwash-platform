/** Text normalisation shared by the customer domain rules. */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic-Indic and Eastern Arabic-Indic digits become Latin digits; nothing else changes. */
export function latinDigits(value: string): string {
  let out = '';
  for (const char of value) {
    const arabic = ARABIC_INDIC.indexOf(char);
    const eastern = EASTERN_ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) out += String(arabic);
    else if (eastern >= 0) out += String(eastern);
    else out += char;
  }
  return out;
}

/** Control characters (C0, DEL, C1) are never valid in stored customer text. */
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
