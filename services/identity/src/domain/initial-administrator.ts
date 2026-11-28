import { normalizeEmail, uuidInput } from './auth-policy';

export class InitialAdministratorFault extends Error {
  constructor(
    readonly code:
      | 'BOOTSTRAP_INVALID_REQUEST'
      | 'BOOTSTRAP_TARGET_INVALID'
      | 'BOOTSTRAP_VERIFICATION_REQUIRED'
      | 'BOOTSTRAP_ADMIN_EXISTS'
      | 'BOOTSTRAP_ALREADY_USED'
      | 'BOOTSTRAP_REQUEST_CONFLICT'
      | 'BOOTSTRAP_GRANT_CHANGED',
  ) {
    super(code);
    this.name = 'InitialAdministratorFault';
  }
}

export interface InitialAdministratorCommand {
  readonly accountId: string;
  readonly expectedEmail: string;
  readonly requestId: string;
  readonly reason: string;
}

/** Explicit operator inputs; this command neither registers nor verifies an account. */
export function initialAdministratorCommand(input: {
  accountId: unknown;
  expectedEmail: unknown;
  requestId: unknown;
  reason: unknown;
}): InitialAdministratorCommand {
  try {
    if (
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 10 ||
      input.reason.trim().length > 512 ||
      [...input.reason].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error('INVALID_REASON');
    return {
      accountId: uuidInput(input.accountId).toLowerCase(),
      expectedEmail: normalizeEmail(input.expectedEmail),
      requestId: uuidInput(input.requestId).toLowerCase(),
      reason: input.reason.trim(),
    };
  } catch {
    throw new InitialAdministratorFault('BOOTSTRAP_INVALID_REQUEST');
  }
}

export function initialAdministratorFingerprint(command: InitialAdministratorCommand): string {
  return JSON.stringify([
    command.accountId,
    command.expectedEmail,
    command.requestId,
    command.reason,
  ]);
}
