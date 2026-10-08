import { text } from './wire';

/** Syrian mobile in E.164 (+9639XXXXXXXX). Other countries are a contract change. */
export const SY_MOBILE = /^\+9639[0-9]{8}$/;

export function parseSyrianMobile(value: unknown, path: string): string {
  return text(value, path, { max: 13, pattern: SY_MOBILE });
}
