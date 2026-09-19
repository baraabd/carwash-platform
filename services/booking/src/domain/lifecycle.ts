export type BookingState = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export interface BookingSnapshot { id: string; state: BookingState; version: number }
const next: Record<BookingState, ReadonlyArray<BookingState>> = {
 PENDING_CONFIRMATION:['CONFIRMED','CANCELLED','EXPIRED'],
 CONFIRMED:['ASSIGNED','CANCELLED'], ASSIGNED:['EN_ROUTE','CANCELLED'],
 EN_ROUTE:['ARRIVED','CANCELLED'], ARRIVED:['IN_PROGRESS','CANCELLED'],
 IN_PROGRESS:['COMPLETED'], COMPLETED:[], CANCELLED:[], EXPIRED:[]
};
/** This is only the transition table. Authorization, capacity, cancellation policy,
 * verified payment conditions and optimistic locking in SQL belong to the application transaction.
 * Neither state nor expectedVersion alone authorizes a command.
 */
export function transitionBooking(booking: BookingSnapshot, target: BookingState, expectedVersion: number): BookingSnapshot {
 if (!Number.isSafeInteger(booking.version) || booking.version < 1 || booking.version === Number.MAX_SAFE_INTEGER)
   throw new Error('INVALID_VERSION');
 if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== booking.version) throw new Error('VERSION_CONFLICT');
 if (!Object.hasOwn(next, booking.state) || !next[booking.state].includes(target)) throw new Error('INVALID_TRANSITION');
 return {...booking,state:target,version:booking.version+1};
}
export interface Window { startMs: number; endMs: number }
/** [start,end) overlap helper, NOT a concurrency guard. PostgreSQL owns concurrency. */
export function windowsOverlap(a: Window,b: Window): boolean {
 for (const window of [a,b]) {
  if (!Number.isSafeInteger(window.startMs) || !Number.isSafeInteger(window.endMs) || window.startMs >= window.endMs)
    throw new Error('INVALID_WINDOW');
 }
 return a.startMs < b.endMs && b.startMs < a.endMs;
}
