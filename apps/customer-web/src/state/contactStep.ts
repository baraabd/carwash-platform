import {
  isContactNameAcceptable,
  isContactPhoneAcceptable,
  type BookingDraft,
} from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

/**
 * Commands of the fifth booking step. Each one edits only the local, unsent
 * draft: no account is created, nothing is verified, no message or call is sent
 * and the account profile is not written. Confirmation (which in the reference
 * also copies these details into the profile) is a later sprint.
 *
 * `contactName`, `contactPhone` and `note` are the reference's `name`, `phone`
 * and `note`. `note` is the note for the technician; it is unrelated to
 * `locationNote`, the access note of the address.
 */

export const TIME_STEP_INDEX = 3;
export const CONTACT_STEP_INDEX = 4;
export const PAYMENT_STEP_INDEX = 5;

export const CONTACT_NAME_MAX_LENGTH = 60;
export const CONTACT_PHONE_MAX_LENGTH = 24;
export const TECHNICIAN_NOTE_MAX_LENGTH = 300;

export const NAME_REQUIRED_MESSAGE = 'أدخل اسمًا من حرفين على الأقل.';
export const PHONE_REQUIRED_MESSAGE = 'أدخل رقمًا تجريبيًا من 8 إلى 15 رقمًا.';
export const DEMO_CONTACT_NOTICE = 'تم إدخال بيانات توضيحية. لا تُرسل رسالة أو مكالمة.';
/** The reference's sample contact. Synthetic; not a real person or number. */
export const DEMO_CONTACT = { contactName: 'سامر التجريبي', contactPhone: '0900000000' } as const;

/** The only fields this step edits from typing. */
export type ContactField = 'contactName' | 'contactPhone' | 'note';

const fieldLimits: Readonly<Record<ContactField, number>> = {
  contactName: CONTACT_NAME_MAX_LENGTH,
  contactPhone: CONTACT_PHONE_MAX_LENGTH,
  note: TECHNICIAN_NOTE_MAX_LENGTH,
};

function withDraft(state: CustomerSessionState, changes: Partial<BookingDraft>) {
  return { ...state, draft: { ...state.draft, ...changes, touched: true } };
}

/**
 * Typing in a field: the value is stored as typed — not trimmed, digits not
 * converted, formatting kept — only capped at the field's length, as the
 * reference's input handler does. An unknown field changes nothing.
 */
export function editContactField(
  state: CustomerSessionState,
  field: ContactField,
  value: string,
): CustomerSessionState {
  if (!Object.hasOwn(fieldLimits, field)) return state;
  return withDraft(state, { [field]: String(value).slice(0, fieldLimits[field]) });
}

/**
 * «ملء تجريبي»: fill the sample name and number. The technician note, the
 * appointment and everything else stay as they are; nothing is sent or saved.
 */
export function fillDemoContact(state: CustomerSessionState): CustomerSessionState {
  return {
    ...withDraft(state, { ...DEMO_CONTACT }),
    notice: { message: DEMO_CONTACT_NOTICE, sequence: (state.notice?.sequence ?? 0) + 1 },
  };
}

export interface ContactErrors {
  readonly contactName: string | null;
  readonly contactPhone: string | null;
}

export const NO_CONTACT_ERRORS: ContactErrors = { contactName: null, contactPhone: null };

/** The step's errors for a draft, in the reference's order: name, then number. */
export function validateContact(
  draft: Pick<BookingDraft, 'contactName' | 'contactPhone'>,
): ContactErrors {
  return {
    contactName: isContactNameAcceptable(draft.contactName) ? null : NAME_REQUIRED_MESSAGE,
    contactPhone: isContactPhoneAcceptable(draft.contactPhone) ? null : PHONE_REQUIRED_MESSAGE,
  };
}

export interface ContactStepSubmission extends SessionTransition {
  readonly errors: ContactErrors;
  /** The first field to focus when refused, or null when the step may advance. */
  readonly firstInvalid: 'contactName' | 'contactPhone' | null;
}

/**
 * «اختيار الدفع»: validate on activation. Invalid input keeps the customer here
 * with the approved messages and the values as typed; otherwise the draft moves
 * to the payment step. Nothing is submitted, normalised or saved.
 */
export function submitContactStep(state: CustomerSessionState): ContactStepSubmission {
  const errors = validateContact(state.draft);
  const firstInvalid = errors.contactName
    ? 'contactName'
    : errors.contactPhone
      ? 'contactPhone'
      : null;
  if (firstInvalid) {
    return {
      state: {
        ...state,
        announcement: {
          message: errors[firstInvalid]!,
          sequence: (state.announcement?.sequence ?? 0) + 1,
        },
      },
      intent: null,
      errors,
      firstInvalid,
    };
  }
  return {
    state: { ...withDraft(state, {}), draftStep: PAYMENT_STEP_INDEX },
    intent: { kind: 'booking-step', step: PAYMENT_STEP_INDEX },
    errors,
    firstInvalid: null,
  };
}

/** Header back: return to the time step. The draft is untouched. */
export function returnToTimeStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'booking-step', step: TIME_STEP_INDEX } };
}
