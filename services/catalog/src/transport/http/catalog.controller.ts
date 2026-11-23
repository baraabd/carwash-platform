import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { createLogger } from '@carwash/service-kit';
import {
  CatalogService,
  type CatalogView,
  type DefinitionView,
  type RequestContext,
} from '../../application';
import { envelope, requestIds, traceParent, type IdentifiedRequest } from './error-envelope';

export const CATALOG_SERVICE = 'CATALOG_SERVICE';
export const CATALOG_V1_PREFIX = '/internal/v1/catalog';

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

function single(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * catalog.v1 HTTP adapter (prefix /internal/v1/catalog):
 *
 * - GET  /definitions                 public: the complete current snapshot.
 * - GET  /definitions/:definitionId   public: one definition, retired included.
 * - POST /publications                permission:catalog.publish, Idempotency-Key,
 *                                     body expectedCatalogRevision.
 *
 * The transport only extracts credential, ids and key and renders results;
 * every decision is in CatalogService. Errors use the shared envelope.
 */
@Controller(CATALOG_V1_PREFIX)
export class CatalogController {
  private readonly logger = createLogger({
    service: 'catalog',
    base: { component: 'catalog-http' },
  });

  constructor(@Inject(CATALOG_SERVICE) private readonly catalog: CatalogService) {}

  @Get('definitions')
  published(@Res({ passthrough: true }) response: HttpResponse): Promise<CatalogView> {
    response.setHeader('cache-control', 'no-store');
    return this.catalog.published();
  }

  @Get('definitions/:definitionId')
  definition(
    @Param('definitionId') definitionId: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<DefinitionView> {
    response.setHeader('cache-control', 'no-store');
    return this.catalog.definition(definitionId);
  }

  @Post('publications')
  async publish(
    @Req() request: IdentifiedRequest,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const ids = requestIds(request);
    const context: RequestContext = {
      credential: single(request.headers.authorization),
      correlationId: ids.correlationId,
      traceParent: traceParent(request),
    };
    const result = await this.catalog.publish(
      context,
      single(request.headers['idempotency-key']),
      body,
    );
    this.logger.info('catalog_publish_outcome', {
      status: result.status,
      replayed: result.replayed,
      code: 'rejection' in result ? result.rejection.code : null,
      correlationId: ids.correlationId,
    });
    response.setHeader('cache-control', 'no-store');
    response.setHeader('idempotency-replayed', String(result.replayed));
    if ('rejection' in result) {
      // A recorded rejection is re-rendered with THIS request's ids.
      const rendered = envelope(result.rejection, ids);
      response.status(rendered.status).json(rendered.body);
      return;
    }
    response.status(result.status).json(result.published);
  }
}
