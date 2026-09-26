import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { IDENTITY_V1 } from '@carwash/contracts';
import { AuthFault, objectInput } from '../../domain/auth-policy';
import { IdentityAuthFilter } from './auth-filter';
import { IdentityHttpRuntime, type AuthRequest, type AuthResponse } from './auth-runtime';

export const IDENTITY_RUNTIME = Symbol('IDENTITY_RUNTIME');
@UseFilters(IdentityAuthFilter)
@Controller(IDENTITY_V1)
export class IdentityAuthController {
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityHttpRuntime) {}
  @Get('.well-known/jwks.json')
  jwks() {
    return this.runtime.signing.jwks;
  }
  @Get('csrf')
  csrf(@Req() request: AuthRequest, @Res({ passthrough: true }) response: AuthResponse) {
    return this.runtime.issueCsrf(request, response);
  }
  @Post('register')
  @HttpCode(202)
  register(@Body() body: unknown, @Req() request: AuthRequest) {
    this.runtime.assertCsrf(request);
    const input = objectInput(body, ['email', 'password']);
    return this.runtime.auth.issue(
      'REGISTER',
      input.email,
      input.password,
      this.runtime.context(request),
    );
  }
  @Post('login')
  @HttpCode(202)
  login(@Body() body: unknown, @Req() request: AuthRequest) {
    this.runtime.assertCsrf(request);
    const input = objectInput(body, ['email', 'password']);
    return this.runtime.auth.issue(
      'LOGIN',
      input.email,
      input.password,
      this.runtime.context(request),
    );
  }
  @Post('challenges/resend')
  @HttpCode(202)
  resend(@Body() body: unknown, @Req() request: AuthRequest) {
    this.runtime.assertCsrf(request);
    const input = objectInput(body, ['challengeId']);
    return this.runtime.auth.resend(input.challengeId, this.runtime.context(request));
  }
  @Post('challenges/verify')
  @HttpCode(200)
  async verify(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    this.runtime.assertCsrf(request);
    const input = objectInput(body, ['challengeId', 'code']);
    const tokens = await this.runtime.auth.verifyChallenge(
      input.challengeId,
      input.code,
      this.runtime.context(request),
    );
    this.runtime.setSession(response, tokens);
    return tokens.session;
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    this.runtime.assertCsrf(request);
    objectInput(body, []);
    const tokens = await this.runtime.auth.refresh(
      this.runtime.cookieValues(request)[this.runtime.cookies.refresh],
      this.runtime.context(request),
    );
    this.runtime.setSession(response, tokens);
    return tokens.session;
  }
  @Get('session')
  async session(@Req() request: AuthRequest) {
    return this.runtime.auth.authorize(await this.runtime.principal(request));
  }
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    this.runtime.assertCsrf(request);
    objectInput(body, []);
    await this.runtime.auth.logout(
      this.runtime.cookieValues(request)[this.runtime.cookies.refresh],
      this.runtime.context(request),
    );
    this.runtime.clearSession(response);
  }
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    this.runtime.assertCsrf(request);
    objectInput(body, []);
    await this.runtime.auth.logoutAll(
      await this.runtime.principal(request),
      this.runtime.context(request),
    );
    this.runtime.clearSession(response);
  }
  @Post('accounts/:id/status')
  @HttpCode(204)
  async status(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    this.runtime.assertCsrf(request);
    const input = objectInput(body, ['status']);
    if (input.status !== 'ACTIVE' && input.status !== 'SUSPENDED')
      throw new AuthFault('AUTH_INVALID_REQUEST');
    await this.runtime.auth.changeAccount(
      await this.runtime.principal(request),
      id,
      { status: input.status },
      this.runtime.context(request),
    );
  }
  @Post('accounts/:id/roles')
  @HttpCode(204)
  async roles(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    this.runtime.assertCsrf(request);
    const input = objectInput(body, ['roles']);
    await this.runtime.auth.changeAccount(
      await this.runtime.principal(request),
      id,
      { roles: input.roles },
      this.runtime.context(request),
    );
  }
}
@Controller('health')
export class IdentityHealthController {
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityHttpRuntime) {}
  @Get('live')
  live() {
    return { service: 'identity', live: true, capability: 'identity-security-foundation' };
  }
  @Get('ready')
  async ready(@Res() response: AuthResponse) {
    const ready = await this.runtime.ready();
    return response.status(ready ? 200 : 503).json({ service: 'identity', ready });
  }
}
