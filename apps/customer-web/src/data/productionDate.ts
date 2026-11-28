/** Formatting server instants and civil dates, never an implicit wall-clock read. */
export function damascusDate(instant: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
export function damascusTime(instant: string): string {
  return new Date(instant).toLocaleTimeString('ar-SY', {
    timeZone: 'Asia/Damascus',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export function damascusSlot(instant: string): string {
  return new Date(instant).toLocaleString('ar-SY', {
    timeZone: 'Asia/Damascus',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export function bookingDays(now: number) {
  const today = damascusDate(now);
  return Array.from({ length: 7 }, (_, index) => {
    const stamp = new Date(`${today}T12:00:00Z`);
    stamp.setUTCDate(stamp.getUTCDate() + index);
    return {
      date: stamp.toISOString().slice(0, 10),
      weekday: stamp.toLocaleDateString('ar-SY', { weekday: 'short', timeZone: 'Asia/Damascus' }),
      month: stamp.toLocaleDateString('ar-SY', { month: 'short', timeZone: 'Asia/Damascus' }),
    };
  });
}
