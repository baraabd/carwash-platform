import type { Failure } from '../api/http';
import type { Freshness } from '../api/operations';
import { h } from './dom';
import { copy } from './i18n';

export function failureMessage(failure: Failure): string {
  const c = copy();
  switch (failure) {
    case 'UNAUTHENTICATED':
      return c.unauthenticated;
    case 'FORBIDDEN':
      return c.forbidden;
    case 'NOT_FOUND':
      return c.notFound;
    case 'RATE_LIMITED':
      return c.rateLimited;
    case 'MALFORMED':
      return c.malformed;
    case 'INVALID':
      return c.invalid;
    case 'CONFLICT':
      return c.conflict;
    case 'UNKNOWN_OUTCOME':
      return c.unknownOutcome;
    case 'UNAVAILABLE':
      return c.unavailable;
  }
}

const TONE = { FRESH: 's-green', STALE: 's-amber', NO_DATA: 's-red' } as const;

function sourceLabel(source: string): string {
  const c = copy();
  if (source === 'booking') return c.sourceBooking;
  if (source === 'scheduling') return c.sourceScheduling;
  if (source === 'workforce') return c.sourceWorkforce;
  if (source === 'dispatch') return c.sourceDispatch;
  if (source === 'billing') return c.sourceBilling;
  return source;
}

export function formatInstant(value: string): string {
  return new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'ar-SY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/**
 * Freshness of each source the rows were derived from. It is rendered apart
 * from the rows so nobody mistakes a projection for the owner's record.
 */
export function freshnessStrip(freshness: readonly Freshness[]): Node[] {
  const c = copy();
  const status = { FRESH: c.fresh, STALE: c.stale, NO_DATA: c.noData };
  return [
    h('span', {}, `${c.freshness}:`),
    ...freshness.map((f) =>
      h(
        'span',
        {
          class: `status ${TONE[f.status]}`,
          'data-source': f.source,
          'data-freshness': f.status,
          title: f.lastAppliedAt
            ? `${c.lastApplied}: ${formatInstant(f.lastAppliedAt)}`
            : undefined,
        },
        `${sourceLabel(f.source)} · ${status[f.status]}`,
      ),
    ),
    h('span', {}, c.derivedNotice),
  ];
}
