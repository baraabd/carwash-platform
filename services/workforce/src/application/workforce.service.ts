import { createHash } from 'node:crypto';
import {
  ELIGIBILITY_CHANGED_V1,
  SHIFT_UPDATED_V1,
  WORKFORCE_EVENTS_EXCHANGE,
  WorkforceError,
  approveVerification,
  cancelShift,
  changeProfile,
  createOperator,
  createShift,
  createVerificationCase,
  eligibilityEvent,
  operationalReadiness,
  rejectVerification,
  setEmployment,
  setSuspension,
  setVerificationProjection,
  shiftEvent,
  withdrawVerification,
  type DecisionReason,
  type EmploymentStatus,
  type OperatorState,
  type ShiftState,
  type SuspensionReason,
  type VerificationCaseState,
} from '../domain';
import type {
  Actor,
  Clock,
  IdGenerator,
  RequestMeta,
  WorkforceReadModel,
  WorkforceTransaction,
  WorkforceUnitOfWork,
} from '../ports';
import { requirePermission, requireScope, requireSelf, requireUser } from './authorization';

function requestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function requester(actor: Actor): string {
  if (actor.kind === 'USER') return `user:${actor.subject}`;
  if (actor.kind === 'SERVICE') return `service:${actor.clientId}`;
  return `system:${actor.component}`;
}

function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new WorkforceError('INVALID_INPUT', 'Invalid Idempotency-Key.');
  }
}

function skillCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9.-]{1,39}$/.test(normalized)) {
    throw new WorkforceError('INVALID_INPUT', 'Invalid skill code.');
  }
  return normalized;
}

export class WorkforceService {
  constructor(
    private readonly uow: WorkforceUnitOfWork,
    private readonly read: WorkforceReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createOperator(
    meta: RequestMeta,
    input: { identitySubject: string; displayName: string; homeZoneId: string },
  ): Promise<OperatorState> {
    requirePermission(meta.actor, 'operations.dispatch');
    const now = this.clock.now();
    const state = createOperator({ id: this.ids.next(), ...input, now });
    return this.uow.run(async (tx) => {
      const result = await tx.insertOperator(state);
      if (result !== 'CREATED') throw new WorkforceError('OPERATOR_EXISTS', 'Operator already exists.');
      await tx.appendAudit({
        action: 'OPERATOR_CREATED',
        actor: meta.actor,
        targetType: 'OPERATOR',
        targetId: state.id,
        correlationId: meta.correlationId,
        details: { homeZoneId: state.homeZoneId },
      });
      return state;
    });
  }

  async me(meta: RequestMeta): Promise<{ operator: OperatorState; skillCodes: string[] }> {
    const user = requirePermission(meta.actor, 'work.read:assigned');
    const operator = await this.read.findOperatorBySubject(user.subject);
    if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
    return { operator, skillCodes: await this.read.listSkills(operator.id) };
  }

  async updateMe(
    meta: RequestMeta,
    input: { displayName?: string; homeZoneId?: string },
  ): Promise<OperatorState> {
    const user = requirePermission(meta.actor, 'work.read:assigned');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.lockOperatorBySubject(user.subject);
      if (!current) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      const next = changeProfile(current, input, now);
      if (next.version !== current.version) {
        await tx.updateOperator(next, current.version);
        await tx.appendAudit({
          action: 'PROFILE_UPDATED',
          actor: meta.actor,
          targetType: 'OPERATOR',
          targetId: current.id,
          correlationId: meta.correlationId,
          details: { version: next.version },
        });
      }
      return next;
    });
  }

  async submitVerification(
    meta: RequestMeta,
    evidenceRefs: readonly string[],
    idempotencyKey: string,
  ): Promise<VerificationCaseState> {
    const user = requirePermission(meta.actor, 'work.read:assigned');
    assertIdempotencyKey(idempotencyKey);
    const requestBy = requester(meta.actor);
    const fingerprint = requestFingerprint({ evidenceRefs: [...evidenceRefs].sort() });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.lockOperatorBySubject(user.subject);
      if (!current) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      requireSelf(meta.actor, current.identitySubject);
      const replay = await tx.findCaseByIdempotency(requestBy, idempotencyKey);
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) {
          throw new WorkforceError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with different input.');
        }
        return replay;
      }
      if (await tx.findPendingCase(current.id)) {
        throw new WorkforceError('PENDING_CASE_EXISTS', 'A verification case is already pending.');
      }
      const state = createVerificationCase({
        id: this.ids.next(),
        operator: current,
        evidenceRefs,
        submittedBy: user.subject,
        requester: requestBy,
        idempotencyKey,
        requestFingerprint: fingerprint,
        now,
      });
      const inserted = await tx.insertVerificationCase(state);
      if (inserted !== 'CREATED') {
        const replayAfterRace = await tx.findCaseByIdempotency(requestBy, idempotencyKey);
        if (replayAfterRace?.requestFingerprint === fingerprint) return replayAfterRace;
        throw new WorkforceError('PENDING_CASE_EXISTS', 'A verification case is already pending.');
      }
      const projected = setVerificationProjection(current, 'PENDING', null, now);
      await tx.updateOperator(projected, current.version);
      await this.appendEligibility(tx, meta, projected);
      await tx.appendAudit({
        action: 'VERIFICATION_SUBMITTED',
        actor: meta.actor,
        targetType: 'VERIFICATION_CASE',
        targetId: state.id,
        correlationId: meta.correlationId,
        details: { operatorId: current.id, evidenceCount: state.evidenceRefs.length },
      });
      return state;
    });
  }

  async reviewVerification(
    meta: RequestMeta,
    caseId: string,
    input:
      | { decision: 'APPROVE'; validUntil: Date }
      | { decision: 'REJECT'; reason: DecisionReason },
  ): Promise<VerificationCaseState> {
    const reviewer = requirePermission(meta.actor, 'verification.review');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const verification = await tx.lockVerificationCase(caseId);
      if (!verification) throw new WorkforceError('CASE_NOT_FOUND', 'Verification case not found.');
      const operator = await tx.lockOperator(verification.operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      const next =
        input.decision === 'APPROVE'
          ? approveVerification(verification, operator, reviewer.subject, input.validUntil, now)
          : rejectVerification(verification, operator, reviewer.subject, input.reason, now);
      await tx.updateVerificationCase(next, verification.version);
      const projected =
        next.status === 'APPROVED'
          ? setVerificationProjection(operator, 'VERIFIED', next.validUntil, now)
          : setVerificationProjection(operator, 'REJECTED', null, now);
      await tx.updateOperator(projected, operator.version);
      await this.appendEligibility(tx, meta, projected);
      await tx.appendAudit({
        action: next.status === 'APPROVED' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        actor: meta.actor,
        targetType: 'VERIFICATION_CASE',
        targetId: next.id,
        correlationId: meta.correlationId,
        details: { operatorId: operator.id },
      });
      return next;
    });
  }

  async withdrawVerification(meta: RequestMeta, caseId: string): Promise<VerificationCaseState> {
    const user = requirePermission(meta.actor, 'work.read:assigned');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const verification = await tx.lockVerificationCase(caseId);
      if (!verification) throw new WorkforceError('CASE_NOT_FOUND', 'Verification case not found.');
      const operator = await tx.lockOperator(verification.operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      const next = withdrawVerification(verification, user.subject, operator, now);
      await tx.updateVerificationCase(next, verification.version);
      const projected = setVerificationProjection(operator, 'UNVERIFIED', null, now);
      await tx.updateOperator(projected, operator.version);
      await this.appendEligibility(tx, meta, projected);
      return next;
    });
  }

  async grantSkill(meta: RequestMeta, operatorId: string, rawSkillCode: string): Promise<string[]> {
    const admin = requirePermission(meta.actor, 'operations.dispatch');
    const code = skillCode(rawSkillCode);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await tx.lockOperator(operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      const currentSkills = await tx.listSkills(operator.id);
      if (currentSkills.includes(code)) throw new WorkforceError('SKILL_EXISTS', 'Skill already granted.');
      await tx.insertSkill({
        id: this.ids.next(),
        operatorId: operator.id,
        skillCode: code,
        grantedBy: admin.subject,
        grantedAt: now,
      });
      const next = { ...operator, version: operator.version + 1, updatedAt: now };
      await tx.updateOperator(next, operator.version);
      const skills = [...currentSkills, code].sort();
      await this.appendEligibility(tx, meta, next, skills);
      await tx.appendAudit({
        action: 'SKILL_GRANTED',
        actor: meta.actor,
        targetType: 'WORK_GRANT',
        targetId: operator.id,
        correlationId: meta.correlationId,
        details: { skillCode: code },
      });
      return skills;
    });
  }

  async revokeSkill(meta: RequestMeta, operatorId: string, rawSkillCode: string): Promise<string[]> {
    requirePermission(meta.actor, 'operations.dispatch');
    const code = skillCode(rawSkillCode);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await tx.lockOperator(operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      if (!(await tx.removeSkill(operator.id, code))) {
        throw new WorkforceError('SKILL_NOT_FOUND', 'Skill is not granted.');
      }
      const next = { ...operator, version: operator.version + 1, updatedAt: now };
      await tx.updateOperator(next, operator.version);
      const skills = await tx.listSkills(operator.id);
      await this.appendEligibility(tx, meta, next, skills);
      await tx.appendAudit({
        action: 'SKILL_REVOKED',
        actor: meta.actor,
        targetType: 'WORK_GRANT',
        targetId: operator.id,
        correlationId: meta.correlationId,
        details: { skillCode: code },
      });
      return skills;
    });
  }

  async setOperatorState(
    meta: RequestMeta,
    operatorId: string,
    input: { employmentStatus?: EmploymentStatus; suspensionReason?: SuspensionReason | null },
  ): Promise<OperatorState> {
    requirePermission(meta.actor, 'operations.dispatch');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.lockOperator(operatorId);
      if (!current) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      let next = current;
      if (input.employmentStatus !== undefined) next = setEmployment(next, input.employmentStatus, now);
      if (input.suspensionReason !== undefined) next = setSuspension(next, input.suspensionReason, now);
      if (next.version !== current.version) {
        await tx.updateOperator(next, current.version);
        await this.appendEligibility(tx, meta, next);
      }
      return next;
    });
  }

  async readiness(meta: RequestMeta, operatorId: string) {
    if (meta.actor.kind === 'USER') requirePermission(meta.actor, 'operations.dispatch');
    else requireScope(meta.actor, 'workforce.eligibility.read');
    const operator = await this.read.findOperator(operatorId);
    if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
    const skills = await this.read.listSkills(operator.id);
    return { operatorId: operator.id, ...operationalReadiness(operator, skills, this.clock.now()), skillCodes: skills };
  }

  async createShift(
    meta: RequestMeta,
    operatorId: string,
    input: { zoneId: string; startsAt: Date; endsAt: Date },
    idempotencyKey: string,
  ): Promise<ShiftState> {
    assertIdempotencyKey(idempotencyKey);
    const requestBy = requester(meta.actor);
    const fingerprint = requestFingerprint({
      operatorId,
      zoneId: input.zoneId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
    });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const operator = await tx.lockOperator(operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      if (meta.actor.kind === 'USER') {
        requirePermission(meta.actor, 'work.read:assigned');
        requireSelf(meta.actor, operator.identitySubject);
      } else {
        requireScope(meta.actor, 'workforce.operator.read');
      }
      const replay = await tx.findShiftByIdempotency(requestBy, idempotencyKey);
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) {
          throw new WorkforceError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with different input.');
        }
        return replay;
      }
      const shift = createShift({
        id: this.ids.next(),
        operatorId: operator.id,
        ...input,
        requester: requestBy,
        idempotencyKey,
        requestFingerprint: fingerprint,
        now,
      });
      const inserted = await tx.insertShift(shift);
      if (inserted === 'OVERLAPS') throw new WorkforceError('SHIFT_OVERLAPS', 'Shift overlaps an active shift.');
      if (inserted !== 'CREATED') {
        const again = await tx.findShiftByIdempotency(requestBy, idempotencyKey);
        if (again?.requestFingerprint === fingerprint) return again;
        throw new WorkforceError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused.');
      }
      await this.appendShift(tx, meta, shift);
      return shift;
    });
  }

  async cancelShift(meta: RequestMeta, shiftId: string): Promise<ShiftState> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.lockShift(shiftId);
      if (!current) throw new WorkforceError('SHIFT_NOT_FOUND', 'Shift not found.');
      const operator = await tx.lockOperator(current.operatorId);
      if (!operator) throw new WorkforceError('OPERATOR_NOT_FOUND', 'Operator profile not found.');
      if (meta.actor.kind === 'USER') {
        requirePermission(meta.actor, 'work.read:assigned');
        requireSelf(meta.actor, operator.identitySubject);
      } else {
        requireScope(meta.actor, 'workforce.operator.read');
      }
      const next = cancelShift(current, now);
      await tx.updateShift(next, current.version);
      await this.appendShift(tx, meta, next);
      return next;
    });
  }

  async eligible(meta: RequestMeta, input: { zoneId: string; at: Date; skillCode?: string }) {
    requireScope(meta.actor, 'workforce.eligibility.read');
    const code = input.skillCode === undefined ? undefined : skillCode(input.skillCode);
    const candidates = await this.read.eligibleOperators({ ...input, skillCode: code });
    return candidates
      .map((candidate) => ({
        operatorId: candidate.operator.id,
        skillCodes: candidate.skillCodes,
        readiness: operationalReadiness(candidate.operator, candidate.skillCodes, input.at),
      }))
      .filter((candidate) => candidate.readiness.ready);
  }

  private async appendEligibility(
    tx: WorkforceTransaction,
    meta: RequestMeta,
    operator: OperatorState,
    knownSkills?: readonly string[],
  ): Promise<void> {
    const skills = knownSkills ?? (await tx.listSkills(operator.id));
    const readiness = operationalReadiness(operator, skills, this.clock.now());
    const event = eligibilityEvent({
      eventId: this.ids.next(),
      occurredAt: this.clock.now().toISOString(),
      correlationId: meta.correlationId,
      aggregateVersion: operator.version,
      data: {
        operatorId: operator.id,
        eligible: readiness.ready,
        employmentStatus: operator.employmentStatus,
        verificationStatus: operator.verificationStatus,
        suspended: operator.suspensionReason !== null,
        skillCodes: skills,
      },
    });
    await tx.appendEvent({
      event,
      exchange: WORKFORCE_EVENTS_EXCHANGE,
      routingKey: ELIGIBILITY_CHANGED_V1,
    });
  }

  private async appendShift(tx: WorkforceTransaction, meta: RequestMeta, shift: ShiftState): Promise<void> {
    const event = shiftEvent({
      eventId: this.ids.next(),
      occurredAt: this.clock.now().toISOString(),
      correlationId: meta.correlationId,
      aggregateVersion: shift.version,
      data: {
        shiftId: shift.id,
        operatorId: shift.operatorId,
        zoneId: shift.zoneId,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        status: shift.status,
      },
    });
    await tx.appendEvent({ event, exchange: WORKFORCE_EVENTS_EXCHANGE, routingKey: SHIFT_UPDATED_V1 });
  }
}
