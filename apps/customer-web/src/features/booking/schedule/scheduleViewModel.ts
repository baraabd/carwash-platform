import { illustrativeCost } from '../../../fixtures/customerCatalogFixture.ts';
import type { CustomerSessionState } from '../../../state/customerSession.ts';
import { highlightedDay } from '../../../state/scheduleStep.ts';
import {
  COLLAPSED_TIME_COUNT,
  availableTimes,
  dateLabel,
  earliestSlot,
  scheduleDays,
  slotLabel,
  timeLabel,
  visibleTimes,
} from '../../../state/scheduling.ts';

export interface ScheduleDayOption {
  readonly key: string;
  /** «اليوم», «غدًا» or the weekday. */
  readonly label: string;
  readonly day: string;
  readonly month: string;
  /** Full date, used as the button's accessible name. */
  readonly name: string;
  readonly selected: boolean;
}

export interface ScheduleTimeOption {
  readonly time: string;
  readonly label: string;
  readonly selected: boolean;
}

export interface ScheduleStepViewModel {
  /** The address label the appointment is for. */
  readonly locationLabel: string;
  /** «الأحد، ٢٠ أيلول · 1:00 م», or the approved text when nothing is offered. */
  readonly earliestText: string;
  /** The draft's appointment is the earliest one offered. */
  readonly earliestChosen: boolean;
  readonly days: readonly ScheduleDayOption[];
  /** «مدة العناية 35 دقيقة». Informational: it does not limit the offered times. */
  readonly careDuration: string;
  /** The times shown: the first six, or all (see `visibleTimes`). */
  readonly times: readonly ScheduleTimeOption[];
  /** The highlighted day has no offered time left. */
  readonly dayExhausted: boolean;
  /** The day offers more than six times, so the expand control is shown. */
  readonly canToggleTimes: boolean;
  readonly showAllTimes: boolean;
  /** «اليوم والوقت» of the chosen appointment, or null when no time is chosen. */
  readonly summary: string | null;
  readonly footerTotal: number;
  readonly footerMinutes: number;
}

/**
 * Everything the time step shows at `now`. Pure: the same session and the same
 * instant always give the same screen, and every rule is evaluated at that one
 * instant.
 */
export function buildScheduleStepViewModel(
  state: CustomerSessionState,
  now: Date,
): ScheduleStepViewModel {
  const { draft } = state;
  const day = highlightedDay(draft, now);
  const time = draft.slot?.time ?? null;
  const first = earliestSlot(now);
  const offered = availableTimes(now, day);
  const cost = illustrativeCost(draft);
  return {
    locationLabel: draft.addressLabel || 'موقع الغسيل',
    earliestText: first ? slotLabel(first) : 'لا يوجد موعد متاح',
    earliestChosen: time !== null && first?.time === time && first.date === day,
    days: scheduleDays(now).map((item) => ({
      key: item.key,
      label: item.label,
      day: item.day,
      month: item.month,
      name: dateLabel(item.key),
      selected: item.key === day,
    })),
    careDuration: `مدة العناية ${cost.minutes} دقيقة`,
    times: visibleTimes(offered, time, state.showAllTimes).map((value) => ({
      time: value,
      label: timeLabel(value),
      selected: value === time,
    })),
    dayExhausted: offered.length === 0,
    canToggleTimes: offered.length > COLLAPSED_TIME_COUNT,
    showAllTimes: state.showAllTimes,
    summary: time === null ? null : `${dateLabel(day)} · ${timeLabel(time)}`,
    footerTotal: cost.total,
    footerMinutes: cost.minutes,
  };
}
