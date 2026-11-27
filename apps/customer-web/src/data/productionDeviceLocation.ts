import { coordinatesFromDegrees, type Coordinates } from '@carwash/contracts/common';

/** Explicit production-only device adapter. It does not send, log, store or watch the position. */
export function requestBookingLocation(): Promise<Coordinates> {
  if (!navigator.geolocation || !window.isSecureContext)
    return Promise.reject(new Error('LOCATION_UNAVAILABLE'));
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(coordinatesFromDegrees(position.coords.latitude, position.coords.longitude));
        } catch {
          reject(new Error('LOCATION_INVALID'));
        }
      },
      () => reject(new Error('LOCATION_UNAVAILABLE')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    ),
  );
}
