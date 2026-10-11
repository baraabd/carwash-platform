import { parseCustody, parseProfile } from './api/profile-parse';
import type { CustodyView, ProfileView } from './api/types';

/**
 * Offline read cache (P05-C2). It holds ONLY the technician's own operational
 * profile and own custody position — never a job, customer detail, address,
 * phone, photo, signed URL, token or note. It exists so the profile screen can
 * say what the server last confirmed while the device is offline; it never
 * stands in for a server answer to a mutation.
 *
 * - bound to the Identity subject it was read for: a different subject
 *   discards it; an unknown subject (offline boot) may show it as stale;
 * - expires after 24 hours;
 * - re-validated with the same closed parsers on load (a corrupt or older
 *   shape is dropped);
 * - cleared on 401/403 and when the session changes.
 */
const KEY = 'washgo-operator-profile-cache-v1';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedRead {
  readonly subject: string;
  readonly savedAt: string;
  readonly profile: ProfileView;
  readonly custody: CustodyView | null;
}

export function saveCache(entry: CachedRead): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...entry }));
  } catch {
    // The cache is a convenience; an unavailable store simply means no offline view.
  }
}

export function clearCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

/** The cached read, or null when absent, expired, malformed or for another subject. */
export function loadCache(subject: string | null, now: number): CachedRead | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.v !== 1 || typeof data.subject !== 'string' || typeof data.savedAt !== 'string') {
      throw new Error('CACHE_SHAPE');
    }
    const savedAt = Date.parse(data.savedAt);
    if (!Number.isFinite(savedAt) || now - savedAt > CACHE_TTL_MS || savedAt > now + 60_000) {
      throw new Error('CACHE_EXPIRED');
    }
    if (subject !== null && subject !== data.subject) throw new Error('CACHE_SUBJECT');
    return {
      subject: data.subject,
      savedAt: data.savedAt,
      profile: parseProfile(data.profile),
      custody: data.custody === null ? null : parseCustody(data.custody),
    };
  } catch {
    clearCache();
    return null;
  }
}
