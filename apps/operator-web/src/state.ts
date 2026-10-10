import type { AvailabilityView, SessionView } from './api/types';
import type { Job } from './model';

/**
 * In-memory UI state. Server facts (`jobs`, `availability`, `session`) are
 * replaced on every read. localStorage holds only two UI preferences: the
 * motion switch and the current task/collection filter. No token, signed URL,
 * job, image or note is ever written to browser storage.
 */

export type View = 'home' | 'tasks' | 'collections' | 'profile' | 'task';
export type TaskFilter = 'active' | 'done' | 'follow';
export type CollectionFilter = 'all' | 'cash' | 'follow';

/** Production states without an approved design (TI-D03), see copy.ts. */
export type ConnectionState =
  'loading' | 'ok' | 'offline' | 'unknown' | 'auth' | 'forbidden' | 'error';

export interface ReadUrlEntry {
  readonly url: string;
  readonly expiresAt: number;
}

export const S = {
  session: null as SessionView | null,
  availability: null as AvailabilityView | null,
  jobs: [] as Job[],
  loaded: false,
  connection: 'loading' as ConnectionState,
  motion: true,
  view: 'home' as View,
  selectedId: null as string | null,
  taskFilter: 'active' as TaskFilter,
  collectionFilter: 'all' as CollectionFilter,
  photoBusy: false,
  photoRevision: 0,
  /** Short-lived presigned read URLs, memory only, keyed by media object id. */
  mediaUrls: new Map<string, ReadUrlEntry>(),
};

export const ready = (): boolean => S.availability?.status === 'AVAILABLE';
export const job = (): Job | undefined => S.jobs.find((j) => j.id === S.selectedId);

const PREF_KEY = 'washgo-operator-preferences-v1';

export function loadPreferences(): void {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.motion === 'boolean') S.motion = data.motion;
    if (
      data.taskFilter === 'active' ||
      data.taskFilter === 'done' ||
      data.taskFilter === 'follow'
    ) {
      S.taskFilter = data.taskFilter;
    }
    if (
      data.collectionFilter === 'all' ||
      data.collectionFilter === 'cash' ||
      data.collectionFilter === 'follow'
    ) {
      S.collectionFilter = data.collectionFilter;
    }
  } catch {
    // Preferences are conveniences; an unavailable or corrupt store keeps defaults.
  }
}

export function savePreferences(): void {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        motion: S.motion,
        taskFilter: S.taskFilter,
        collectionFilter: S.collectionFilter,
      }),
    );
  } catch {
    // Session-only preferences are acceptable.
  }
}
