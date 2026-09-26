import type { INestApplication } from '@nestjs/common';
import { createIdentityHttpApplication } from '../../identity-runtime';

/** Identity owns its opt-in auth composition; other shells remain unchanged. */
export function createHttpApplication(): Promise<INestApplication> {
  return createIdentityHttpApplication();
}
