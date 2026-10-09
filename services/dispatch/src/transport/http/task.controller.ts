import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseFilters,
} from '@nestjs/common';
import { TaskService, type TaskCommandResult, type TaskDetail } from '../../application';
import {
  evidenceSlot,
  invalid,
  isEvidencePhase,
  isNoteKind,
  positiveMoneyFromWire,
  type CollectionInput,
} from '../../domain';
import type { DispatchReadModel } from '../../ports';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { DispatchHttpFilter } from './http-errors';
import { bool, idempotencyKey, int, objectBody, str } from './http-input';
import { DISPATCH_READ_MODEL } from './tokens';
import { taskDetailView, taskSummary, technicianView } from './views';

const DISPATCH_V1 = '/internal/v1/dispatch';

function expectedOnly(body: unknown): number {
  const input = objectBody(body, ['expectedRevision'], ['expectedRevision']);
  return int(input.expectedRevision, 'expectedRevision');
}

function collectionInput(value: unknown): CollectionInput {
  const outer = objectBody(value, ['outcome', 'amount', 'reason'], ['outcome']);
  if (outer.outcome === 'CASH_COLLECTED') {
    objectBody(value, ['outcome', 'amount'], ['outcome', 'amount']);
    return {
      outcome: 'CASH_COLLECTED',
      amount: positiveMoneyFromWire(outer.amount, 'collection.amount'),
    };
  }
  if (outer.outcome === 'CASH_NOT_COLLECTED') {
    objectBody(value, ['outcome', 'reason'], ['outcome', 'reason']);
    return { outcome: 'CASH_NOT_COLLECTED', reason: str(outer.reason, 'collection.reason', 2000) };
  }
  if (outer.outcome === 'NOT_CASH') {
    objectBody(value, ['outcome'], ['outcome']);
    return { outcome: 'NOT_CASH' };
  }
  throw invalid('Unknown collection outcome.');
}

/**
 * Technician task routes (REQUESTED dispatch.v1 addition, interface spec C4).
 * The edge only resolves the caller, parses closed bodies and maps results;
 * authorization, fencing and every rule live in TaskService.
 */
@Controller(DISPATCH_V1)
@UseFilters(DispatchHttpFilter)
export class TaskController {
  constructor(
    @Inject(TaskService) private readonly tasks: TaskService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
    @Inject(DISPATCH_READ_MODEL) private readonly read: DispatchReadModel,
  ) {}

  @Get('me/jobs')
  async jobs(@Req() req: HeaderBag) {
    const meta = await this.actors.resolve(req);
    const jobs = await this.tasks.listMyJobs(meta);
    return {
      offers: jobs.offers.map(({ offer, assignment }) => technicianView(offer, assignment, null)),
      tasks: await Promise.all(
        jobs.tasks.map(async (task) => {
          const assignment = await this.read.findAssignment(task.assignmentId);
          return {
            ...taskSummary(task),
            zoneId: assignment?.zoneId ?? null,
            startsAt: assignment ? assignment.startsAt.toISOString() : null,
            endsAt: assignment ? assignment.endsAt.toISOString() : null,
          };
        }),
      ),
    };
  }

  /** Work evidence of the caller's own booking (consumed by Billing's WorkAuthority). */
  @Get('me/bookings/:bookingId/work')
  async work(@Req() req: HeaderBag, @Param('bookingId') bookingId: string) {
    const meta = await this.actors.resolve(req);
    const { assignment, task, workState } = await this.tasks.workForBooking(meta, bookingId);
    return {
      bookingId: assignment.bookingId,
      assignmentId: assignment.id,
      assignmentRevision: assignment.version,
      technicianSubjectId: assignment.technicianSubject,
      workState,
      taskId: task?.id ?? null,
      taskStage: task?.stage ?? null,
      taskRevision: task?.version ?? null,
    };
  }

  @Get('me/tasks/:taskId')
  async task(@Req() req: HeaderBag, @Param('taskId') taskId: string) {
    const meta = await this.actors.resolve(req);
    return this.detail(await this.tasks.getMyTask(meta, taskId));
  }

  @Post('tasks/:taskId/depart')
  @HttpCode(200)
  async depart(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return this.result(
      await this.tasks.depart(meta, taskId, expectedOnly(body), idempotencyKey(req)),
    );
  }

  @Post('tasks/:taskId/arrive')
  @HttpCode(200)
  async arrive(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return this.result(
      await this.tasks.arrive(meta, taskId, expectedOnly(body), idempotencyKey(req)),
    );
  }

  @Post('tasks/:taskId/start')
  @HttpCode(200)
  async start(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return this.result(
      await this.tasks.start(meta, taskId, expectedOnly(body), idempotencyKey(req)),
    );
  }

  @Post('tasks/:taskId/document')
  @HttpCode(200)
  async document(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return this.result(
      await this.tasks.document(meta, taskId, expectedOnly(body), idempotencyKey(req)),
    );
  }

  @Post('tasks/:taskId/finish')
  @HttpCode(200)
  async finish(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return this.result(
      await this.tasks.finish(meta, taskId, expectedOnly(body), idempotencyKey(req)),
    );
  }

  @Put('tasks/:taskId/checklist/:code')
  async check(
    @Req() req: HeaderBag,
    @Param('taskId') taskId: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(
      body,
      ['expectedRevision', 'checked'],
      ['expectedRevision', 'checked'],
    );
    return this.result(
      await this.tasks.setCheck(
        meta,
        taskId,
        str(code, 'code', 40),
        {
          expectedRevision: int(input.expectedRevision, 'expectedRevision'),
          checked: bool(input.checked, 'checked'),
        },
        idempotencyKey(req),
      ),
    );
  }

  @Put('tasks/:taskId/condition-note')
  async conditionNote(
    @Req() req: HeaderBag,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['expectedRevision', 'text'], ['expectedRevision', 'text']);
    return this.result(
      await this.tasks.setConditionNote(
        meta,
        taskId,
        {
          expectedRevision: int(input.expectedRevision, 'expectedRevision'),
          text: str(input.text, 'text', 4000),
        },
        idempotencyKey(req),
      ),
    );
  }

  @Put('tasks/:taskId/evidence/:phase/:slot')
  async attach(
    @Req() req: HeaderBag,
    @Param('taskId') taskId: string,
    @Param('phase') phase: string,
    @Param('slot') slot: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    if (!isEvidencePhase(phase)) throw invalid('phase must be BEFORE or AFTER.');
    const input = objectBody(
      body,
      ['expectedRevision', 'mediaObjectId'],
      ['expectedRevision', 'mediaObjectId'],
    );
    return this.result(
      await this.tasks.attachEvidence(
        meta,
        taskId,
        phase,
        evidenceSlot(slot),
        {
          expectedRevision: int(input.expectedRevision, 'expectedRevision'),
          mediaObjectId: str(input.mediaObjectId, 'mediaObjectId'),
        },
        idempotencyKey(req),
      ),
    );
  }

  @Delete('tasks/:taskId/evidence/:phase/:slot')
  async remove(
    @Req() req: HeaderBag,
    @Param('taskId') taskId: string,
    @Param('phase') phase: string,
    @Param('slot') slot: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    if (!isEvidencePhase(phase)) throw invalid('phase must be BEFORE or AFTER.');
    return this.result(
      await this.tasks.removeEvidence(
        meta,
        taskId,
        phase,
        evidenceSlot(slot),
        { expectedRevision: expectedOnly(body) },
        idempotencyKey(req),
      ),
    );
  }

  @Post('tasks/:taskId/close')
  @HttpCode(200)
  async close(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(
      body,
      ['expectedRevision', 'collection'],
      ['expectedRevision', 'collection'],
    );
    return this.result(
      await this.tasks.close(
        meta,
        taskId,
        {
          expectedRevision: int(input.expectedRevision, 'expectedRevision'),
          collection: collectionInput(input.collection),
        },
        idempotencyKey(req),
      ),
    );
  }

  @Post('tasks/:taskId/cash-collection')
  @HttpCode(200)
  async lateCash(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['expectedRevision', 'amount'], ['expectedRevision', 'amount']);
    return this.result(
      await this.tasks.declareLateCash(
        meta,
        taskId,
        {
          expectedRevision: int(input.expectedRevision, 'expectedRevision'),
          amount: positiveMoneyFromWire(input.amount, 'amount'),
        },
        idempotencyKey(req),
      ),
    );
  }

  @Post('tasks/:taskId/release')
  @HttpCode(200)
  async release(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['expectedRevision', 'reason'], ['expectedRevision', 'reason']);
    return this.result(
      await this.tasks.release(
        meta,
        taskId,
        {
          expectedRevision: int(input.expectedRevision, 'expectedRevision'),
          reason: str(input.reason, 'reason', 2000),
        },
        idempotencyKey(req),
      ),
    );
  }

  @Post('tasks/:taskId/notes')
  @HttpCode(200)
  async note(@Req() req: HeaderBag, @Param('taskId') taskId: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['kind', 'text'], ['kind', 'text']);
    if (!isNoteKind(input.kind)) throw invalid('Unknown note kind.');
    return this.result(
      await this.tasks.addNote(
        meta,
        taskId,
        { kind: input.kind, text: str(input.text, 'text', 2000) },
        idempotencyKey(req),
      ),
    );
  }

  private async result(result: TaskCommandResult) {
    return this.detail(result.value);
  }

  private async detail(detail: TaskDetail) {
    const assignment = await this.read.findAssignment(detail.task.assignmentId);
    return taskDetailView(detail, assignment);
  }
}
