import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchema } from '../../dist/ownership/schema.mjs';
const cases = [
  ['string accepted', { type: 'string' }, 'yes', true],
  ['wrong string type', { type: 'string' }, 1, false],
  ['object excludes array', { type: 'object' }, [], false],
  ['object excludes null', { type: 'object' }, null, false],
  ['null only', { type: 'null' }, null, true],
  ['boolean only', { type: 'boolean' }, 'false', false],
  ['finite number', { type: 'number' }, Infinity, false],
  ['integer only', { type: 'integer' }, 1.5, false],
  ['safe integer', { type: 'integer' }, 24, true],
  ['const uses deep equality', { const: { x: 1, y: 2 } }, { y: 2, x: 1 }, true],
  ['wrong const', { const: false }, true, false],
  ['enum accepted', { enum: ['a', 'b'] }, 'b', true],
  ['enum rejected', { enum: ['a', 'b'] }, 'c', false],
  ['required missing', { type: 'object', required: ['name'] }, {}, false],
  ['required present', { type: 'object', required: ['name'] }, { name: null }, true],
  [
    'additional field rejected',
    { type: 'object', properties: {}, additionalProperties: false },
    { extra: 1 },
    false,
  ],
  ['property type', { type: 'object', properties: { a: { type: 'string' } } }, { a: 1 }, false],
  ['array item type', { type: 'array', items: { type: 'string' } }, [1], false],
  ['minItems', { type: 'array', minItems: 1 }, [], false],
  ['maxItems', { type: 'array', maxItems: 0 }, [1], false],
  ['unique primitive', { uniqueItems: true }, [1, 1], false],
  [
    'unique object key order',
    { uniqueItems: true },
    [
      { a: 1, b: 2 },
      { b: 2, a: 1 },
    ],
    false,
  ],
  ['unicode length counts codepoints', { minLength: 2 }, '😀', false],
  ['anchored pattern', { pattern: '^abc$' }, 'xabc', false],
  ['local reference', { $defs: { text: { type: 'string' } }, $ref: '#/$defs/text' }, 'hello', true],
  ['local reference rejection', { $defs: { text: { type: 'string' } }, $ref: '#/$defs/text' }, 1, false],
  [
    'ref siblings both apply',
    { $defs: { text: { type: 'string' } }, $ref: '#/$defs/text', const: 'hello' },
    'other',
    false,
  ],
  ['remote reference blocked', { $ref: 'https://example.invalid/schema.json' }, {}, false],
  ['unresolved reference', { $ref: '#/$defs/missing' }, {}, false],
  [
    'cyclic reference bounded',
    { $defs: { cycle: { $ref: '#/$defs/cycle' } }, $ref: '#/$defs/cycle' },
    {},
    false,
  ],
  ['unknown keyword fail closed', { anyOf: [] }, {}, false],
  ['unknown unused property keyword fail closed', { properties: { absent: { format: 'uri' } } }, {}, false],
  ['unknown unused definition keyword fail closed', { $defs: { absent: { maximum: 1 } } }, {}, false],
  ['bad regex schema fails', { properties: { absent: { pattern: '[' } } }, {}, false],
  ['negative length schema fails', { minLength: -1 }, 'hello', false],
  ['invalid schema type fails', { type: 'typo' }, {}, false],
  ['bad required declaration', { required: 'name' }, {}, false],
  ['duplicate required declaration', { required: ['name', 'name'] }, { name: 'x' }, false],
  ['bad items definition', { items: false }, [], false],
  ['unsupported boolean schema fails closed', true, {}, false],
];
for (const [name, schema, value, pass] of cases)
  test(name, () => {
    assert.equal(validateSchema(schema, value).length === 0, pass);
  });
