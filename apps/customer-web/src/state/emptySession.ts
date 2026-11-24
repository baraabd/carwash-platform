import { blankBookingDraft } from './bookingDraft.ts';
import type { CustomerSessionState } from './customerSession.ts';

/** A fresh production session never invents a customer, order or saved record. */
export function emptySession(): CustomerSessionState {
  return {
    runtimeMode: 'production',
    profile: { name: '', phone: '' },
    orders: [],
    vehicles: [],
    vehicleSequence: 0,
    addresses: [],
    addressSequence: 0,
    draft: blankBookingDraft(),
    draftStep: 0,
    bookingMode: 'standard',
    showAllTimes: false,
    reviewEditing: false,
    notice: null,
    announcement: null,
    orderSequence: 0,
    draftGeneration: 0,
    confirmationReceipts: [],
    pendingHandoff: null,
  };
}
