import type { CustomerSessionState } from '../../state/customerSession.ts';

export type AccountIcon =
  'user' | 'pin' | 'car' | 'qr-pay' | 'wallet' | 'spark' | 'help' | 'shield' | 'download' | 'trash';

/**
 * What a row of the account screen does in this build.
 *
 * - `addresses` opens the saved-addresses sheet (C009).
 * - `garage` goes to the garage screen (C005).
 * - `deferred` is shown exactly as approved but is not implemented yet: profile,
 *   payment codes, payment tour, motion, help, privacy, export and reset belong
 *   to the sprints that own them.
 */
export type AccountRowAction = 'addresses' | 'garage' | 'deferred';

export interface AccountRow {
  readonly id: string;
  readonly icon: AccountIcon;
  readonly title: string;
  readonly hint: string;
  readonly action: AccountRowAction;
  readonly danger: boolean;
}

export interface AccountViewModel {
  /** First letter of the profile name, or an empty string for the user icon. */
  readonly initial: string;
  readonly displayName: string;
  /** The profile phone, or an empty string when the approved placeholder shows. */
  readonly phone: string;
  readonly primaryRows: readonly AccountRow[];
  readonly secondaryRows: readonly AccountRow[];
}

const row = (
  id: string,
  icon: AccountIcon,
  title: string,
  hint: string,
  action: AccountRowAction = 'deferred',
): AccountRow => ({ id, icon, title, hint, action, danger: id === 'reset-prompt' });

/** Everything the account screen shows, derived from the session. Pure. */
export function buildAccountViewModel(state: CustomerSessionState): AccountViewModel {
  return {
    initial: state.profile.name.charAt(0),
    displayName: state.profile.name || 'أهلاً بك في WashGo',
    phone: state.profile.phone,
    primaryRows: [
      row('profile', 'user', 'بياناتي', 'الاسم ورقم التواصل'),
      row('addresses', 'pin', 'عناويني', `${state.addresses.length} عناوين محفوظة`, 'addresses'),
      row('garage-tab', 'car', 'سياراتي', `${state.vehicles.length} سيارات محفوظة`, 'garage'),
    ],
    secondaryRows: [
      row('pay-settings', 'qr-pay', 'رموز الدفع للتجربة', 'إضافة QR التاجر لكل محفظة محليًا'),
      row('pay-demo', 'wallet', 'استكشف الدفع', 'جولة تجريبية جاهزة دون مال حقيقي'),
      // The approved default; the motion setting itself is not implemented yet.
      row('motion', 'spark', 'المؤثرات الحركية', 'حركات هادئة حسب تفضيل جهازك'),
      row('help', 'help', 'دليل التجربة', 'الحجز، صور قبل وبعد، وإعادة الحجز'),
      row('privacy', 'shield', 'الخصوصية والحفظ', 'بيانات محلية دون مشاركة أو خادم'),
      row('export', 'download', 'تنزيل بيانات التجربة', 'ملف JSON دون صور'),
      row('reset-prompt', 'trash', 'إعادة ضبط التجربة', 'حذف الحجوزات والسيارات والصور'),
    ],
  };
}

export interface SavedAddressItem {
  readonly id: string;
  readonly label: string;
  readonly address: string;
}

/** The saved-addresses list, in the book's own order. Pure. */
export function buildAddressBookItems(state: CustomerSessionState): readonly SavedAddressItem[] {
  return state.addresses.map(({ id, label, address }) => ({ id, label, address }));
}
