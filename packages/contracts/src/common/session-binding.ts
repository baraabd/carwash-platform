import { integer, oneOf, uuid } from './wire';

/** An assertion of the session a browser command was prepared for, never authentication. */
export const SESSION_BINDING_HEADER = 'x-wg-session-binding' as const;

export interface BrowserSessionBinding {
  readonly principalKind: 'account' | 'guest';
  readonly subject: string;
  readonly sessionId: string;
  readonly authVersion: number;
}

/** Stable across refresh rotation; a new login or authorization version changes the binding. */
export function formatSessionBinding(session: BrowserSessionBinding): string {
  const kind = oneOf(session.principalKind, '$.principalKind', ['account', 'guest']);
  const subject = uuid(session.subject, '$.subject');
  const sessionId = uuid(session.sessionId, '$.sessionId');
  const version = integer(session.authVersion, '$.authVersion', 1, Number.MAX_SAFE_INTEGER);
  return `${kind}:${subject}:${sessionId}:${version}`;
}
