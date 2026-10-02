import type { NavigationIntent } from './customerSession.ts';

/** Maps a navigation intent onto the C002 route table. */
export function pathForIntent(intent: NavigationIntent): string {
  switch (intent.kind) {
    case 'booking-step':
      return `/book/${intent.step}`;
    case 'order-tracking':
      return `/order/${encodeURIComponent(intent.orderId)}`;
  }
}
