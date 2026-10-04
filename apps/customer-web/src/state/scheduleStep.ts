import type { BookingDraft } from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';
import {
  dateLabel,
  defaultScheduleDay,
  earliestSlot,
  isScheduleDay,
  isSlotAvailable,
  timeLabel,
} from './scheduling.ts';

/**
 * Commands of the fourth booking step. Each one edits only the local, unsent
 * draft: picking a day or a time reserves nothing, creates no booking and
 * contacts no service. Every command that depends on the time of day takes the
 * instant it is evaluated at; none reads the clock.
 *
 * Draft model:
 * - `scheduleDay` is the highlighted day. It may be set while no time is chosen.
 * - `slot` is a complete appointment, or null. When it is not null its date is
 *   the highlighted day.
 */

export const LOCATION_STEP_INDEX = 2;
export const TIME_STEP_INDEX = 3;
export const CONTACT_STEP_INDEX = 4;

export const TIME_REQUIRED_MESSAGE = 'اختر موعدًا متاحًا، أو استخدم أقرب موعد.';

function withDraft(state: CustomerSessionState, changes: Partial<BookingDraft>) {
  return { ...state, draft: { ...state.draft, ...changes, touched: true } };
}

/** The day the time step highlights: the recorded one, else the default for `now`. */
export function highlightedDay(draft: Pick<BookingDraft, 'scheduleDay'>, now: Date): string {
  return draft.scheduleDay ?? defaultScheduleDay(now);
}

/** Whether the draft holds an appointment that is offered at `now`. */
export function hasAvailableSlot(draft: Pick<BookingDraft, 'slot'>, now: Date): boolean {
  return draft.slot !== null && isSlotAvailable(now, draft.slot.date, draft.slot.time);
}

/**
 * Starting a booking: a draft whose day is not one of the offered days (or was
 * never recorded) starts on the default day with no time, as in the reference.
 * A day and time that are still offered are kept.
 */
export function draftWithCurrentSchedule(draft: BookingDraft, now: Date): BookingDraft {
  if (isScheduleDay(now, draft.scheduleDay)) return draft;
  return { ...draft, scheduleDay: defaultScheduleDay(now), slot: null };
}

/**
 * Tap on a day: highlight it, clear the time and collapse the list — also when
 * the same day is tapped again. A day that is not offered is ignored.
 */
export function selectScheduleDay(
  state: CustomerSessionState,
  day: string,
  now: Date,
): CustomerSessionState {
  if (!isScheduleDay(now, day)) return state;
  return { ...withDraft(state, { scheduleDay: day, slot: null }), showAllTimes: false };
}

/**
 * Tap on a time: complete the appointment on the highlighted day. A time that is
 * unknown, excluded or no longer offered is ignored. Nothing navigates.
 */
export function selectScheduleTime(
  state: CustomerSessionState,
  time: string,
  now: Date,
): CustomerSessionState {
  const day = highlightedDay(state.draft, now);
  if (!isSlotAvailable(now, day, time)) return state;
  return withDraft(state, { scheduleDay: day, slot: { date: day, time } });
}

/**
 * «أقرب موعد متاح»: take the earliest offered day and time and say which one.
 * When nothing is offered the draft is left alone and no notice is raised.
 */
export function chooseEarliestSlot(state: CustomerSessionState, now: Date): CustomerSessionState {
  const slot = earliestSlot(now);
  if (!slot) return state;
  return {
    ...withDraft(state, { scheduleDay: slot.date, slot }),
    showAllTimes: false,
    notice: {
      message: `الموعد: ${dateLabel(slot.date)}، ${timeLabel(slot.time)}.`,
      sequence: (state.notice?.sequence ?? 0) + 1,
    },
  };
}

/** «عرض كل الأوقات» / «عرض أوقات أقل». Presentation only; the draft is untouched. */
export function toggleAllTimes(state: CustomerSessionState): CustomerSessionState {
  return { ...state, showAllTimes: !state.showAllTimes };
}

export interface ScheduleStepSubmission extends SessionTransition {
  /** Validation message for the time, or null when the step may advance. */
  readonly timeError: string | null;
}

/**
 * «بيانات التواصل»: the appointment is checked again at the moment of the tap. A
 * missing time, or one that stopped being offered while the screen was open,
 * keeps the customer here with the approved message; the stored choice is not
 * replaced by another one. Otherwise the draft moves on. Nothing is submitted.
 */
export function submitScheduleStep(state: CustomerSessionState, now: Date): ScheduleStepSubmission {
  if (!hasAvailableSlot(state.draft, now)) {
    return {
      state: {
        ...state,
        announcement: {
          message: TIME_REQUIRED_MESSAGE,
          sequence: (state.announcement?.sequence ?? 0) + 1,
        },
      },
      intent: null,
      timeError: TIME_REQUIRED_MESSAGE,
    };
  }
  return {
    state: { ...withDraft(state, {}), draftStep: CONTACT_STEP_INDEX },
    intent: { kind: 'booking-step', step: CONTACT_STEP_INDEX },
    timeError: null,
  };
}

/** Header back and «تغيير»: return to the location step. The draft is untouched. */
export function returnToLocationStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'booking-step', step: LOCATION_STEP_INDEX } };
}
