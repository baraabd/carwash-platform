import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  OperatorProfileService,
  type OperatorProfile,
  type ScheduleApplication,
} from '../../application';
import {
  invalid,
  type AvailabilityExceptionState,
  type EquipmentState,
  type ServiceAreaState,
  type ShiftState,
  type WeeklyScheduleState,
} from '../../domain';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { WorkforceHttpFilter } from './http-errors';
import { WORKFORCE_V1 } from './workforce.controller';

interface StatusResponse {
  status(code: number): StatusResponse;
}

function header(req: HeaderBag, name: string): string {
  const value = req.headers[name];
  return typeof value === 'string' ? value : '';
}

function emptyBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    invalid('Body must be empty.');
  }
}

// ---------------------------------------------------------------------------
// Views (requested contract CR-P05-C1; closed shapes, UTC instants)
// ---------------------------------------------------------------------------

function scheduleView(state: WeeklyScheduleState) {
  return {
    timeZone: state.timeZone,
    windows: state.windows.map((window) => ({
      weekday: window.weekday,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
      zoneId: window.zoneId,
    })),
    revision: state.revision,
    updatedAt: state.updatedAt?.toISOString() ?? null,
  };
}

function serviceAreaView(homeZoneId: string, state: ServiceAreaState) {
  return {
    homeZoneId,
    zoneIds: [...new Set([homeZoneId, ...state.extraZoneIds])].sort(),
    revision: state.revision,
    updatedAt: state.updatedAt?.toISOString() ?? null,
  };
}

function exceptionView(state: AvailabilityExceptionState) {
  return {
    exceptionId: state.id,
    startsAt: state.startsAt.toISOString(),
    endsAt: state.endsAt.toISOString(),
    reason: state.reason,
    status: state.status,
    version: state.version,
  };
}

function equipmentView(state: EquipmentState) {
  return {
    kind: state.kind,
    required: state.required,
    status: state.status,
    issue: state.issue,
    revision: state.revision,
    updatedAt: state.updatedAt.toISOString(),
  };
}

function shiftSlotView(state: ShiftState) {
  return {
    shiftId: state.id,
    zoneId: state.zoneId,
    startsAt: state.startsAt.toISOString(),
    endsAt: state.endsAt.toISOString(),
  };
}

/**
 * The technician profile. No Identity subject, no suspension reason detail
 * beyond the readiness reasons the technician needs to understand why it gets
 * no work, no reviewer id and no evidence references.
 */
function profileView(profile: OperatorProfile) {
  const { operator, latestVerification } = profile;
  return {
    operatorId: operator.id,
    displayName: operator.displayName,
    employmentStatus: operator.employmentStatus,
    suspended: operator.suspensionReason !== null,
    verification: {
      status: operator.verificationStatus,
      verifiedUntil: operator.verifiedUntil?.toISOString() ?? null,
      latestCase:
        latestVerification === null
          ? null
          : {
              caseId: latestVerification.id,
              status: latestVerification.status,
              submittedAt: latestVerification.submittedAt.toISOString(),
              decidedAt: latestVerification.decidedAt?.toISOString() ?? null,
              decisionReason: latestVerification.decisionReason,
            },
    },
    skillCodes: [...profile.skillCodes],
    readiness: { ready: profile.readiness.ready, reasons: [...profile.readiness.reasons] },
    availability: {
      status: profile.availability.status,
      revision: profile.availability.revision,
      updatedAt: profile.availability.updatedAt?.toISOString() ?? null,
    },
    serviceArea: serviceAreaView(operator.homeZoneId, profile.serviceArea),
    schedule: scheduleView(profile.schedule),
    upcomingShifts: profile.upcomingShifts.map(shiftSlotView),
    exceptions: profile.exceptions.map(exceptionView),
    equipment: profile.equipment.map(equipmentView),
    version: operator.version,
    asOf: profile.asOf.toISOString(),
  };
}

function applicationView(result: ScheduleApplication) {
  return {
    created: result.created.map(shiftSlotView),
    existing: result.existing.map(shiftSlotView),
    skipped: result.skipped.map((skip) => ({
      weekday: skip.window.weekday,
      startMinute: skip.window.startMinute,
      zoneId: skip.window.zoneId,
      startsAt: skip.startsAt.toISOString(),
      endsAt: skip.endsAt.toISOString(),
      reason: skip.reason,
    })),
  };
}

/**
 * P05-C1 operational profile routes. Self routes resolve the operator from the
 * Identity subject only; operations routes take an operator id and require
 * `operations.dispatch` (checked in the application, before any body use).
 */
@Controller(WORKFORCE_V1)
@UseFilters(WorkforceHttpFilter)
export class OperatorProfileController {
  constructor(
    @Inject(OperatorProfileService) private readonly profiles: OperatorProfileService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  @Get('me/profile')
  async myProfile(@Req() req: HeaderBag) {
    return profileView(await this.profiles.myProfile(await this.actors.resolve(req)));
  }

  @Put('me/schedule')
  async setSchedule(@Req() req: HeaderBag, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return scheduleView(await this.profiles.setSchedule(meta, body));
  }

  @Post('me/schedule/apply')
  @HttpCode(200)
  async applySchedule(@Req() req: HeaderBag, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    return applicationView(await this.profiles.applySchedule(meta, body));
  }

  @Post('me/availability-exceptions')
  async createMyException(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const result = await this.profiles.createMyException(
      meta,
      body,
      header(req, 'idempotency-key'),
    );
    res.status(201);
    return exceptionView(result);
  }

  @Post('availability-exceptions/:id/cancel')
  @HttpCode(200)
  async cancelException(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    emptyBody(body);
    return exceptionView(await this.profiles.cancelException(meta, id));
  }

  @Put('me/equipment/:kind/status')
  async reportMyEquipment(
    @Req() req: HeaderBag,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    return equipmentView(await this.profiles.reportMyEquipment(meta, kind, body));
  }

  // --- operations -----------------------------------------------------------

  @Get('operators/:id/profile')
  async operatorProfile(@Req() req: HeaderBag, @Param('id') id: string) {
    const meta = await this.actors.resolve(req);
    return profileView(await this.profiles.operatorProfile(meta, id));
  }

  @Put('operators/:id/service-area')
  async setServiceArea(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const result = await this.profiles.setServiceArea(meta, id, body);
    return serviceAreaView(result.operator.homeZoneId, result.area);
  }

  @Post('operators/:id/availability-exceptions')
  async createOperatorException(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const result = await this.profiles.createOperatorException(
      meta,
      id,
      body,
      header(req, 'idempotency-key'),
    );
    res.status(201);
    return exceptionView(result);
  }

  @Post('operators/:id/equipment')
  async registerEquipment(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const result = await this.profiles.registerEquipment(meta, id, body);
    res.status(201);
    return equipmentView(result);
  }

  @Put('operators/:id/equipment/:kind')
  async setEquipmentRequirement(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    return equipmentView(await this.profiles.setEquipmentRequirement(meta, id, kind, body));
  }

  @Put('operators/:id/equipment/:kind/status')
  async reportOperatorEquipment(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    return equipmentView(await this.profiles.reportOperatorEquipment(meta, id, kind, body));
  }
}
