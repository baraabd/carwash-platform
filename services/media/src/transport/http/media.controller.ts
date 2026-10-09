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
import { MediaService, type UploadTicket } from '../../application';
import { invalid } from '../../domain';
import type { ObjectClaim, ObjectRecord, PresignedRequest } from '../../ports';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { MediaHttpFilter } from './http-errors';

export const MEDIA_V1 = '/internal/v1/media';

interface StatusResponse {
  status(code: number): StatusResponse;
}

/** Closed body: unknown fields are refused, never ignored. */
function objectBody(
  body: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw invalid('Body must be a JSON object.');
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw invalid(`Unexpected field: ${key.slice(0, 40)}.`);
  }
  for (const key of required) if (!(key in record)) throw invalid(`Missing field: ${key}.`);
  return record;
}

/** Commands without input accept no body or `{}` only. */
function emptyBody(body: unknown): void {
  objectBody(body ?? {}, [], []);
}

function idempotencyKey(req: HeaderBag): string | undefined {
  const value = req.headers['idempotency-key'];
  return typeof value === 'string' ? value : undefined;
}

/** `ObjectView` of media.v1. No URL, key or storage detail ever appears in it. */
export function objectView(record: ObjectRecord) {
  const { object } = record;
  return {
    objectId: object.id,
    revision: object.version,
    status: object.status,
    purpose: object.purpose,
    contentType: object.contentType,
    byteLength: object.byteLength,
    sha256: object.sha256,
    ownerSubjectId: object.ownerSubject,
    rejectReason: object.rejectReason,
    claimed: record.claimed,
    createdAt: object.createdAt.toISOString(),
    finalizedAt: object.finalizedAt?.toISOString() ?? null,
    // The reservation deadline while an upload is still possible.
    expiresAt: object.status === 'RESERVED' ? object.reservationExpiresAt.toISOString() : null,
  };
}

export function presignedView(request: PresignedRequest) {
  return {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    expiresAt: request.expiresAt.toISOString(),
  };
}

function ticketView(ticket: UploadTicket) {
  return {
    ...objectView(ticket.record),
    upload: ticket.upload ? presignedView(ticket.upload) : null,
  };
}

function claimView(record: ObjectRecord, claim: ObjectClaim) {
  return {
    ...objectView(record),
    claim: {
      claimRef: claim.claimRef,
      holder: claim.holder,
      claimedAt: claim.createdAt.toISOString(),
    },
  };
}

@Controller(MEDIA_V1)
@UseFilters(MediaHttpFilter)
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  @Post('uploads')
  async reserve(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(
      body,
      ['purpose', 'contentType', 'byteLength', 'sha256'],
      ['purpose', 'contentType', 'byteLength', 'sha256'],
    );
    const result = await this.media.reserve(
      meta,
      {
        purpose: input.purpose,
        contentType: input.contentType,
        byteLength: input.byteLength,
        sha256: input.sha256,
      },
      idempotencyKey(req),
    );
    res.status(result.replayed ? 200 : 201);
    return ticketView(result.value);
  }

  @Post('objects/:id/upload-url')
  @HttpCode(200)
  async uploadUrl(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    emptyBody(body);
    return ticketView(await this.media.issueUploadUrl(meta, id));
  }

  @Post('objects/:id/finalize')
  @HttpCode(200)
  async finalize(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    emptyBody(body);
    const { value } = await this.media.finalize(meta, id, idempotencyKey(req));
    return objectView(value);
  }

  @Get('objects/:id')
  async get(@Req() req: HeaderBag, @Param('id') id: string) {
    const meta = await this.actors.resolve(req);
    return objectView(await this.media.getObject(meta, id));
  }

  @Post('objects/:id/read-url')
  @HttpCode(200)
  async readUrl(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    emptyBody(body);
    return presignedView(await this.media.issueReadUrl(meta, id));
  }

  @Post('objects/:id/claims')
  async claim(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['claimRef', 'holder'], ['claimRef', 'holder']);
    const result = await this.media.claim(meta, id, {
      claimRef: input.claimRef,
      holder: input.holder,
    });
    res.status(result.replayed ? 200 : 201);
    return claimView(result.value.record, result.value.claim);
  }
}
