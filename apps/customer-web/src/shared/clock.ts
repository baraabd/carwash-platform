/**
 * The one place the customer app reads the wall clock. Call it at an interaction
 * or render boundary and pass the result down: scheduling rules are pure
 * functions of that instant, so one decision never mixes two readings.
 */
export function currentInstant(): Date {
  return new Date();
}
