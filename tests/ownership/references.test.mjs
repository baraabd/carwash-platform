import assert from 'node:assert/strict';
import test from 'node:test';
import { collectReferences } from '../../dist/ownership/references.mjs';

const cases = [
  ['static import with comment', "import { x } from /* comment */ '@carwash/billing';", '@carwash/billing'],
  ['type import', "import type { X } from '@carwash/billing';", '@carwash/billing'],
  ['side effect', "import '@carwash/billing';", '@carwash/billing'],
  ['re-export', "export { x } from '@carwash/billing';", '@carwash/billing'],
  ['export star', "export * from '@carwash/billing';", '@carwash/billing'],
  ['dynamic string', "import('@carwash/billing');", '@carwash/billing'],
  ['backtick dynamic import', 'import(`@carwash/billing`);', '@carwash/billing'],
  ['require backtick', 'require(`@carwash/billing`);', '@carwash/billing'],
  ['require', "require('@carwash/billing');", '@carwash/billing'],
  ['require.resolve', "require.resolve('@carwash/billing');", '@carwash/billing'],
  ['module.require', "module.require('@carwash/billing');", '@carwash/billing'],
  ['import equals', "import billing = require('@carwash/billing');", '@carwash/billing'],
  ['import type expression', "type X = import('@carwash/billing').X;", '@carwash/billing'],
  ['escaped module text', "import '@carwash/bi\\u006cling';", '@carwash/billing'],
  [
    'triple slash',
    '/// <reference path="../../billing/src/index.ts" />\nexport {};',
    '../../billing/src/index.ts',
  ],
];
for (const [name, source, expected] of cases) {
  test(`AST extracts ${name}`, () => {
    const result = collectReferences('fixture.ts', source);
    assert.equal(result.syntaxErrors.length, 0);
    assert.ok(result.references.some((reference) => reference.specifier === expected));
  });
}
test('ignores fake import text in comments and ordinary strings', () => {
  const source = `// import '@carwash/billing';\n/* require('@carwash/billing') */\nconst x = "import('@carwash/billing')";`;
  assert.deepEqual(collectReferences('fixture.ts', source).references, []);
});
test('extracts imports in JSX files', () => {
  const result = collectReferences(
    'fixture.tsx',
    "import {x} from '@carwash/billing'; export const X = <div/>;",
  );
  assert.equal(result.syntaxErrors.length, 0);
  assert.equal(result.references[0].specifier, '@carwash/billing');
});
test('computed dynamic import is unreviewable rather than silently allowed', () => {
  const result = collectReferences('fixture.ts', 'import(`@carwash/${name}`);');
  assert.equal(result.references[0].specifier, null);
});
test('createRequire renamed import and renamed result remain visible', () => {
  const source =
    "import {createRequire as factory} from 'node:module'; const load = factory(import.meta.url); load('@carwash/billing');";
  assert.ok(
    collectReferences('fixture.mts', source).references.some(
      (reference) => reference.specifier === '@carwash/billing',
    ),
  );
});
test('namespace createRequire remains visible', () => {
  const source =
    "import * as moduleTools from 'node:module'; const load = moduleTools.createRequire(import.meta.url); load('@carwash/billing');";
  assert.ok(
    collectReferences('fixture.mts', source).references.some(
      (reference) => reference.specifier === '@carwash/billing',
    ),
  );
});
test('inline createRequire invocation remains visible', () => {
  const source =
    "import {createRequire} from 'node:module'; createRequire(import.meta.url)('@carwash/billing');";
  assert.ok(
    collectReferences('fixture.mts', source).references.some(
      (reference) => reference.specifier === '@carwash/billing',
    ),
  );
});
test('parser syntax errors are not treated as a clean file', () => {
  assert.ok(collectReferences('fixture.ts', 'import {').syntaxErrors.length > 0);
});
test('diagnostic positions include the real source line', () => {
  assert.equal(collectReferences('fixture.ts', "\n\nimport '@carwash/billing';").references[0].line, 3);
});
