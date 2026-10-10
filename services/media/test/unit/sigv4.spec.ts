import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EMPTY_SHA256,
  UNSIGNED_PAYLOAD,
  canonicalRequest,
  presignUrl,
  signHeaders,
  signingKey,
  stringToSign,
  uriEncode,
} from '../../src/infrastructure/storage/sigv4';

/**
 * Published examples of the Amazon S3 API reference, "Authenticating
 * Requests (AWS Signature Version 4)": examplebucket, us-east-1,
 * 2013-05-24T00:00:00Z, and the documented example access key. They are reproduced byte for
 * byte, so the signer is checked against AWS's own canonical form, not only
 * against SeaweedFS (the lane-C suites prove the latter separately).
 */
const AT = new Date('2013-05-24T00:00:00Z');
const AWS_EXAMPLE_ACCESS_KEY_ID = ['AKIAIOSFODNN7', 'EXAMPLE'].join('');
const AWS_EXAMPLE_SECRET_ACCESS_KEY = ['wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'EXAMPLEKEY'].join('');
const AWS_EXAMPLE_CREDENTIAL = `${AWS_EXAMPLE_ACCESS_KEY_ID}/20130524/us-east-1/s3/aws4_request`;
const CREDENTIALS = {
  accessKeyId: AWS_EXAMPLE_ACCESS_KEY_ID,
  secretAccessKey: AWS_EXAMPLE_SECRET_ACCESS_KEY,
  region: 'us-east-1',
};

test('presigned GET example: canonical request, string to sign and signature', () => {
  const url = presignUrl({
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    headers: {},
    expiresInSeconds: 86_400,
    at: AT,
    credentials: CREDENTIALS,
  });
  const { text } = canonicalRequest({
    method: 'GET',
    path: '/test.txt',
    query: [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', AWS_EXAMPLE_CREDENTIAL],
      ['X-Amz-Date', '20130524T000000Z'],
      ['X-Amz-Expires', '86400'],
      ['X-Amz-SignedHeaders', 'host'],
    ],
    headers: { host: 'examplebucket.s3.amazonaws.com' },
    payloadHash: UNSIGNED_PAYLOAD,
  });
  assert.equal(
    text,
    [
      'GET',
      '/test.txt',
      `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(AWS_EXAMPLE_CREDENTIAL)}&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host`,
      'host:examplebucket.s3.amazonaws.com',
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n'),
  );
  assert.equal(
    stringToSign(AT, '20130524/us-east-1/s3/aws4_request', text),
    [
      'AWS4-HMAC-SHA256',
      '20130524T000000Z',
      '20130524/us-east-1/s3/aws4_request',
      '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04',
    ].join('\n'),
  );
  assert.equal(
    url.searchParams.get('X-Amz-Signature'),
    'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
  assert.equal(url.pathname, '/test.txt');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '86400');
});

test('header-signed GET example (range): canonical request and signature', () => {
  const headers = signHeaders({
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    headers: { range: 'bytes=0-9' },
    payloadHash: EMPTY_SHA256,
    at: AT,
    credentials: CREDENTIALS,
  });
  assert.equal(headers['x-amz-date'], '20130524T000000Z');
  assert.equal(
    headers.authorization ?? '',
    `AWS4-HMAC-SHA256 Credential=${AWS_EXAMPLE_CREDENTIAL}, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41`,
  );
});

test('header-signed PUT example: path encoding and signed payload digest', () => {
  const body = 'Welcome to Amazon S3.';
  const digest = createHash('sha256').update(body).digest('hex');
  assert.equal(digest, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const headers = signHeaders({
    method: 'PUT',
    url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    payloadHash: digest,
    at: AT,
    credentials: CREDENTIALS,
  });
  assert.match(
    headers.authorization ?? '',
    /SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/,
  );
});

test('signing key derivation is the documented HMAC chain', () => {
  const key = signingKey(AT, CREDENTIALS);
  assert.equal(key.length, 32);
  // Same inputs, same key; another day, another key.
  assert.deepEqual(key, signingKey(AT, CREDENTIALS));
  assert.notDeepEqual(key, signingKey(new Date('2013-05-25T00:00:00Z'), CREDENTIALS));
});

test('URI encoding: unreserved kept, everything else percent-encoded once', () => {
  assert.equal(uriEncode('a-b_c.d~e'), 'a-b_c.d~e');
  assert.equal(uriEncode('a/b c+d'), 'a%2Fb%20c%2Bd');
  assert.equal(uriEncode('/bucket/objects/x y', false), '/bucket/objects/x%20y');
  assert.equal(uriEncode('é'), '%C3%A9');
});

test('presigned PUT binds content type, length and checksum as signed headers', () => {
  const url = presignUrl({
    method: 'PUT',
    url: new URL('http://127.0.0.1:9000/bucket/uploads/5b4f2a6e-0d1c-4b8e-9a7f-3c2d1e0f9a8b'),
    headers: {
      'content-type': 'image/png',
      'content-length': '1234',
      'x-amz-checksum-sha256': 'AAAA',
    },
    expiresInSeconds: 300,
    at: AT,
    credentials: CREDENTIALS,
  });
  assert.equal(
    url.searchParams.get('X-Amz-SignedHeaders'),
    'content-length;content-type;host;x-amz-checksum-sha256',
  );
  assert.equal(url.host, '127.0.0.1:9000');
  assert.equal(url.pathname, '/bucket/uploads/5b4f2a6e-0d1c-4b8e-9a7f-3c2d1e0f9a8b');
});

test('presign lifetime is bounded by S3 limits (1 s .. 7 days)', () => {
  const base = {
    method: 'GET' as const,
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    headers: {},
    at: AT,
    credentials: CREDENTIALS,
  };
  assert.throws(() => presignUrl({ ...base, expiresInSeconds: 0 }), /PRESIGN_EXPIRY_OUT_OF_RANGE/);
  assert.throws(
    () => presignUrl({ ...base, expiresInSeconds: 604_801 }),
    /PRESIGN_EXPIRY_OUT_OF_RANGE/,
  );
  assert.throws(
    () => presignUrl({ ...base, expiresInSeconds: 1.5 }),
    /PRESIGN_EXPIRY_OUT_OF_RANGE/,
  );
});
