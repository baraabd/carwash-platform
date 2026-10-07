import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAddressChanges,
  applyProfileChanges,
  canonicalDecimal,
  contactChanged,
  CustomerDomainError,
  parseAddressDetails,
  parseCoordinates,
  parseDisplayName,
  parsePhone,
  type Address,
  type CustomerProfile,
} from '../../src/domain';

function refused(code: string, work: () => unknown): void {
  assert.throws(
    work,
    (error: unknown) => error instanceof CustomerDomainError && error.code === code,
  );
}

const profile: CustomerProfile = {
  id: '6f1c4f3e-8a55-4a77-9c1d-2f4ad0b8e001',
  principal: { kind: 'account', subject: '0e8f6a43-1f7b-4d44-8d38-3b8f4c2a9001' },
  displayName: null,
  phone: null,
  preferredLocale: 'ar',
  revision: 1,
  createdAt: new Date('2026-10-07T08:00:00.000Z'),
  updatedAt: new Date('2026-10-07T08:00:00.000Z'),
};

test('display name: trimmed, inner whitespace collapsed, 2..60 code points', () => {
  assert.equal(parseDisplayName('  سامر   التجريبي '), 'سامر التجريبي');
  refused('INVALID_DISPLAY_NAME', () => parseDisplayName(' س '));
  refused('INVALID_DISPLAY_NAME', () => parseDisplayName('x'.repeat(61)));
  refused('INVALID_DISPLAY_NAME', () => parseDisplayName('ab\u0007c'));
  refused('INVALID_DISPLAY_NAME', () => parseDisplayName(42));
});

test('phone: Arabic-Indic digits and separators accepted, 8-15 digits, optional plus', () => {
  assert.equal(parsePhone('٠٩٠٠ ٠٠٠ ٠٠٠'), '0900000000');
  assert.equal(parsePhone('+963 (9) 11-222-333'), '+963911222333');
  assert.equal(parsePhone('۰۹۱۲۳۴۵۶۷۸'), '0912345678');
  refused('INVALID_PHONE', () => parsePhone('1234567'));
  refused('INVALID_PHONE', () => parsePhone('1234567890123456'));
  refused('INVALID_PHONE', () => parsePhone('09-ab-0000'));
  refused('INVALID_PHONE', () => parsePhone('++0912345678'));
  refused('INVALID_PHONE', () => parsePhone('0'.repeat(25)));
});

test('coordinates: exact decimal strings, finite, in range, at most six decimals', () => {
  assert.deepEqual(
    parseCoordinates({ crs: 'EPSG:4326', latitude: '36.200000', longitude: '-0.000' }),
    { crs: 'EPSG:4326', latitude: '36.2', longitude: '0' },
  );
  assert.deepEqual(parseCoordinates({ crs: 'EPSG:4326', latitude: '-90', longitude: '180' }), {
    crs: 'EPSG:4326',
    latitude: '-90',
    longitude: '180',
  });
  for (const bad of [
    { crs: 'EPSG:4326', latitude: '90.000001', longitude: '0' },
    { crs: 'EPSG:4326', latitude: '0', longitude: '-180.000001' },
    { crs: 'EPSG:4326', latitude: 'NaN', longitude: '0' },
    { crs: 'EPSG:4326', latitude: 'Infinity', longitude: '0' },
    { crs: 'EPSG:4326', latitude: '1e1', longitude: '0' },
    { crs: 'EPSG:4326', latitude: '36.1234567', longitude: '0' },
    { crs: 'EPSG:4326', latitude: 36.2, longitude: 37.1 },
    { crs: 'EPSG:3857', latitude: '0', longitude: '0' },
    { crs: 'EPSG:4326', latitude: '0', longitude: '0', x: 1 },
    { latitude: '0', longitude: '0' },
  ]) {
    refused('INVALID_COORDINATES', () => parseCoordinates(bad));
  }
  assert.equal(canonicalDecimal('-0.000000'), '0');
  assert.equal(canonicalDecimal('-12.500'), '-12.5');
});

test('address: caps, manual location, artwork x/y refused', () => {
  const details = parseAddressDetails({
    label: ' البيت ',
    line: 'حي   الشهباء، شارع 5',
    accessNote: '   ',
    location: { kind: 'manual' },
  });
  assert.deepEqual(details, {
    label: 'البيت',
    line: 'حي الشهباء، شارع 5',
    accessNote: null,
    location: { kind: 'manual' },
  });
  refused('INVALID_ADDRESS_LABEL', () =>
    parseAddressDetails({ label: 'x'.repeat(31), line: 'a', location: { kind: 'manual' } }),
  );
  refused('INVALID_ADDRESS_LINE', () =>
    parseAddressDetails({ label: 'a', line: '', location: { kind: 'manual' } }),
  );
  refused('INVALID_ACCESS_NOTE', () =>
    parseAddressDetails({
      label: 'a',
      line: 'b',
      accessNote: 'x'.repeat(161),
      location: { kind: 'manual' },
    }),
  );
  refused('INVALID_LOCATION', () =>
    parseAddressDetails({ label: 'a', line: 'b', location: { x: 350, y: 240 } }),
  );
  refused('INVALID_LOCATION', () =>
    parseAddressDetails({
      label: 'a',
      line: 'b',
      location: {
        kind: 'manual',
        coordinates: { crs: 'EPSG:4326', latitude: '1', longitude: '1' },
      },
    }),
  );
  refused('INVALID_LOCATION', () =>
    parseAddressDetails({
      label: 'a',
      line: 'b',
      location: {
        kind: 'coordinates',
        source: 'guess',
        coordinates: { crs: 'EPSG:4326', latitude: '1', longitude: '1' },
      },
    }),
  );
});

test('address: an archived address cannot be edited', () => {
  const archived: Address = {
    id: 'a7d1e7a2-3f0c-4f5e-9d61-0e2b2b7f0001',
    customerId: profile.id,
    label: 'a',
    line: 'b',
    accessNote: null,
    location: { kind: 'manual' },
    status: 'ARCHIVED',
    revision: 2,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
  refused('ADDRESS_ARCHIVED', () => applyAddressChanges(archived, { label: 'c' }));
});

test('profile: partial changes, null clears, unknown keys refused', () => {
  const next = applyProfileChanges(profile, { displayName: 'سامر', phone: '0900000000' });
  assert.deepEqual(next, { displayName: 'سامر', phone: '0900000000', preferredLocale: 'ar' });
  assert.equal(contactChanged(profile, next), true);
  const localeOnly = applyProfileChanges(profile, { preferredLocale: 'en' });
  assert.equal(contactChanged(profile, localeOnly), false);
  refused('INVALID_INPUT', () => applyProfileChanges(profile, {}));
  refused('INVALID_INPUT', () => applyProfileChanges(profile, { customerId: 'x' }));
  refused('INVALID_LOCALE', () => applyProfileChanges(profile, { preferredLocale: 'fr' }));
  const cleared = applyProfileChanges({ ...profile, phone: '0900000000' }, { phone: null });
  assert.equal(cleared.phone, null);
});
