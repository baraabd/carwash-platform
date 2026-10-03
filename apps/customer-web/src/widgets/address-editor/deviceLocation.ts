import {
  GEOLOCATION_REQUEST_OPTIONS,
  classifyDevicePosition,
  geolocationFailureOutcome,
  type GeolocationOutcome,
} from '../../state/locationStep.ts';

/**
 * Asks the browser for the device position once and answers only with what it
 * means for the illustrative map. Call it from the customer's own tap on
 * "موقعي الحالي" and nowhere else: it is what raises the permission prompt.
 *
 * The coordinates are read inside the callback, reduced to a class and dropped.
 * They are not returned, kept in a variable that outlives the callback, logged,
 * shown, stored or sent anywhere.
 */
export function requestDevicePositionClass(): Promise<GeolocationOutcome> {
  if (!('geolocation' in navigator) || !navigator.geolocation) {
    return Promise.resolve('unsupported');
  }
  if (!window.isSecureContext) return Promise.resolve('insecure');
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve(classifyDevicePosition(position.coords.latitude, position.coords.longitude)),
      (error) => resolve(geolocationFailureOutcome(error.code)),
      GEOLOCATION_REQUEST_OPTIONS,
    );
  });
}
