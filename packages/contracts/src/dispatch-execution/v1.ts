import type { OwnerContract } from '../common/route';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, oneOf, uuid } from '../common/wire';

export const DISPATCH_EXECUTION_V1 = {
  id: 'dispatch.v1',
  owner: 'dispatch',
  prefix: '/internal/v1/dispatch',
  routes: {
    getExecution: {
      method: 'GET',
      path: '/bookings/:bookingId/execution',
      access: 'service:dispatch.assignment.read',
    },
  },
  reasons: ['ASSIGNMENT_NOT_FOUND'],
} as const satisfies OwnerContract;
export const TASK_STAGES = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'DOCUMENTING',
  'FINISHED',
  'CLOSED',
  'RELEASED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export interface ExecutionV1 {
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly revision: number;
  readonly holdId: string;
  readonly status: 'UNASSIGNED' | 'OFFERED' | 'ASSIGNED' | 'CANCELLED';
  readonly task: null | {
    readonly taskId: string;
    readonly revision: number;
    readonly stage: (typeof TASK_STAGES)[number];
    readonly completedAt: UtcTimestamp | null;
  };
}
export function parseExecutionV1(raw: unknown): ExecutionV1 {
  const e = closed(raw, '$', ['bookingId', 'assignmentId', 'revision', 'holdId', 'status', 'task']);
  const status = oneOf(e.status, '$.status', [
    'UNASSIGNED',
    'OFFERED',
    'ASSIGNED',
    'CANCELLED',
  ] as const);
  let task: ExecutionV1['task'] = null;
  if (e.task !== null) {
    const t = closed(e.task, '$.task', ['taskId', 'revision', 'stage', 'completedAt']);
    const stage = oneOf(t.stage, '$.task.stage', TASK_STAGES);
    const completedAt =
      t.completedAt === null ? null : parseUtc(t.completedAt, '$.task.completedAt');
    if ((stage === 'CLOSED') !== (completedAt !== null))
      throw new ContractViolation('INVALID_COMPLETION', '$.task');
    task = {
      taskId: uuid(t.taskId, '$.task.taskId'),
      revision: parseRevision(t.revision, '$.task.revision'),
      stage,
      completedAt,
    };
  }
  if ((status === 'ASSIGNED') !== (task !== null))
    throw new ContractViolation('INVALID_EXECUTION', '$.status');
  return {
    bookingId: uuid(e.bookingId, '$.bookingId'),
    assignmentId: uuid(e.assignmentId, '$.assignmentId'),
    revision: parseRevision(e.revision, '$.revision'),
    holdId: uuid(e.holdId, '$.holdId'),
    status,
    task,
  };
}
