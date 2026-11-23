import {
  CASE_KINDS,
  CASE_STATUSES,
  CaseRuleError,
  oneOf,
  type CaseKind,
  type CaseStatus,
} from '../domain';
import {
  OwnerReadError,
  type BillingOwner,
  type BookingOwner,
  type BookingState,
  type CaseDetail,
  type CaseReader,
  type CaseRecord,
  type Clock,
  type ObligationState,
  type OnBehalfOf,
  type VerifiedSession,
} from '../ports';
import { readableKinds, requireAnyRead, requireRead } from './access';
import { SupportApplicationError, uuid } from './errors';

const MAX_PAGE = 100;
const DEFAULT_PAGE = 25;

export interface CasePage {
  readonly items: readonly CaseRecord[];
  readonly nextCursor: string | null;
}

/** What the owner says NOW about a case's subject; Support keeps none of it. */
export type CurrentState =
  | { readonly owner: 'billing'; readonly readAt: string; readonly obligation: ObligationState }
  | { readonly owner: 'booking'; readonly readAt: string; readonly booking: BookingState };

function list<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 400) throw new CaseRuleError('INVALID_KIND');
  return [...new Set(value.split(','))].map((item) => oneOf(item, allowed, 'INVALID_KIND'));
}

function limit(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > MAX_PAGE)
    throw new SupportApplicationError('REQUEST_INVALID');
  return Number(value);
}

export function encodeCursor(record: CaseRecord): string {
  return Buffer.from(`${record.openedAt.toISOString()}|${record.id}`, 'utf8').toString('base64url');
}

function cursor(value: unknown): { openedAt: Date; id: string } | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(value))
    throw new SupportApplicationError('REQUEST_INVALID');
  const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const openedAt = new Date(at ?? '');
  if (Number.isNaN(openedAt.getTime()) || !id) throw new SupportApplicationError('REQUEST_INVALID');
  return { openedAt, id: uuid(id) };
}

/**
 * The exception queue (oldest first) and case detail. Each reader sees only
 * the kinds of its own desk; a filter naming another desk's kind is refused,
 * not silently narrowed.
 */
export class CaseQueries {
  constructor(
    private readonly reader: CaseReader,
    private readonly billing: BillingOwner,
    private readonly booking: BookingOwner,
    private readonly clock: Clock,
  ) {}

  async list(
    session: VerifiedSession,
    query: {
      kind?: unknown;
      status?: unknown;
      subjectType?: unknown;
      subjectId?: unknown;
      limit?: unknown;
      cursor?: unknown;
    },
  ): Promise<CasePage> {
    requireAnyRead(session);
    const readable = readableKinds(session);
    const requested = list<CaseKind>(query.kind, CASE_KINDS);
    if (requested) for (const kind of requested) requireRead(session, kind);
    const statuses = list<CaseStatus>(query.status, CASE_STATUSES);
    const hasType = query.subjectType !== undefined;
    if (hasType !== (query.subjectId !== undefined))
      throw new SupportApplicationError('REQUEST_INVALID');
    const subject = hasType
      ? {
          type: oneOf(
            query.subjectType,
            ['billing.payment-attempt', 'billing.obligation', 'booking'],
            'INVALID_SUBJECT',
          ),
          id: uuid(query.subjectId),
        }
      : null;
    const size = limit(query.limit);
    const items = await this.reader.list({
      kinds: requested ?? readable,
      statuses,
      subject,
      limit: size + 1,
      cursor: cursor(query.cursor),
    });
    const page = items.slice(0, size);
    const last = page.at(-1);
    return { items: page, nextCursor: items.length > size && last ? encodeCursor(last) : null };
  }

  async detail(session: VerifiedSession, rawId: unknown): Promise<CaseDetail> {
    requireAnyRead(session);
    const detail = await this.reader.detail(uuid(rawId));
    // Another desk's case is indistinguishable from a missing one.
    if (!detail || !readableKinds(session).includes(detail.record.kind))
      throw new SupportApplicationError('NOT_FOUND');
    return detail;
  }

  /** The subject's authoritative current state, read from its owner as the caller. */
  async current(session: VerifiedSession, auth: OnBehalfOf, rawId: unknown): Promise<CurrentState> {
    const { record } = await this.detail(session, rawId);
    const readAt = this.clock.now().toISOString();
    try {
      if (record.subject.type === 'booking') {
        const booking = await this.booking.booking(auth, record.subject.id);
        if (!booking) throw new SupportApplicationError('SUBJECT_NOT_FOUND');
        return { owner: 'booking', readAt, booking };
      }
      const obligation = await this.billing.obligation(
        auth,
        record.subject.parentId ?? record.subject.id,
      );
      if (!obligation) throw new SupportApplicationError('SUBJECT_NOT_FOUND');
      return { owner: 'billing', readAt, obligation };
    } catch (error) {
      if (error instanceof OwnerReadError)
        throw new SupportApplicationError(
          error.code === 'OWNER_FORBIDDEN' ? 'OWNER_FORBIDDEN' : 'OWNER_UNAVAILABLE',
        );
      throw error;
    }
  }
}
