import { closed, list, type Coordinates } from '@carwash/contracts/common';
import {
  parseCatalogV1,
  parseCurrentCatalogV1,
  parsePublishCatalogRequestV1,
  type CatalogV1,
  type PublishCatalogRequestV1,
} from '@carwash/contracts/catalog-v1';
import {
  parseServiceabilityRequestV1,
  parseServiceabilityDecisionV1,
  parseServiceZoneV1,
} from '@carwash/contracts/geo-v1';
import { parseAvailabilityV1 } from '@carwash/contracts/scheduling-v1';
import {
  parseCurrentPriceBookV1,
  parsePublishPriceBookRequestV1,
  parsePriceBookPublicationV1,
  type PublishPriceBookRequestV1,
} from '@carwash/contracts/pricing-v1';
import { request, type Result } from './http';

export const publishedCatalog = (): Promise<Result<CatalogV1>> =>
  request('/admin/catalog', { read: parseCatalogV1 });
export const currentCatalog = () =>
  request('/admin/catalog/current', { read: parseCurrentCatalogV1 });

/** The complete version is retained; editing a definition never deletes the other definitions. */
export function publishCatalog(
  value: PublishCatalogRequestV1,
  key: string,
): Promise<Result<CatalogV1>> {
  const body = parsePublishCatalogRequestV1(value);
  return request('/admin/catalog/publications', {
    method: 'POST',
    body,
    idempotencyKey: key,
    read: (raw) => {
      const catalog = parseCatalogV1(raw);
      if (
        catalog.catalogRevision !== body.expectedCatalogRevision + 1 ||
        catalog.items.length !== body.definitions.length
      )
        throw new Error('catalog publication context');
      for (const definition of body.definitions) {
        const found = catalog.items.find((item) => item.definitionId === definition.definitionId);
        if (
          !found ||
          found.code !== definition.code ||
          found.status !== definition.status ||
          found.kind !== definition.kind ||
          found.name.ar !== definition.name.ar ||
          found.name.en !== definition.name.en ||
          found.description.ar !== definition.description.ar ||
          found.description.en !== definition.description.en ||
          found.durationMinutes !== definition.durationMinutes ||
          found.sortOrder !== definition.sortOrder ||
          found.vehicleTypes.length !== definition.vehicleTypes.length ||
          definition.vehicleTypes.some((type) => !found.vehicleTypes.includes(type))
        )
          throw new Error('catalog publication definition');
      }
      return catalog;
    },
  });
}

export function serviceZones() {
  return request('/admin/service-zones', {
    read: (raw) => {
      const value = closed(raw, '$', ['items']);
      const items = list(value.items, '$.items', 1000, parseServiceZoneV1);
      if (new Set(items.map((item) => item.zoneId)).size !== items.length)
        throw new Error('duplicate zone');
      return items;
    },
  });
}

export function checkServiceability(point: Coordinates) {
  const body = parseServiceabilityRequestV1({ point });
  return request('/admin/serviceability', {
    method: 'POST',
    body,
    read: (raw) => {
      const value = parseServiceabilityDecisionV1(raw);
      if (value.point.latitude !== point.latitude || value.point.longitude !== point.longitude)
        throw new Error('serviceability point');
      return value;
    },
  });
}

export function zoneAvailability(zoneId: string, date: string, durationMinutes: number) {
  return request('/admin/availability', {
    query: { zoneId, date, durationMinutes: String(durationMinutes) },
    read: (raw) => {
      const value = parseAvailabilityV1(raw);
      if (
        value.zoneId !== zoneId ||
        value.date !== date ||
        value.durationMinutes !== durationMinutes
      )
        throw new Error('availability query context');
      return value;
    },
  });
}

export const currentPriceBook = () =>
  request('/admin/price-books/current', { read: parseCurrentPriceBookV1 });
export function publishPriceBook(command: PublishPriceBookRequestV1, key: string) {
  const body = parsePublishPriceBookRequestV1(command);
  return request('/admin/price-books', {
    method: 'POST',
    body,
    idempotencyKey: key,
    read: (raw) => {
      const receipt = parsePriceBookPublicationV1(raw);
      if (
        receipt.priceBookRevision !== body.expectedPriceBookRevision ||
        receipt.currency !== body.currency ||
        receipt.entryCount !== body.entries.length
      )
        throw new Error('price book publication context');
      return receipt;
    },
  });
}
