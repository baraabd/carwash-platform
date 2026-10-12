// Loads TypeScript provider modules from the exact source of this tree (no copy)
// for provider-conformance tests. Relative imports are transpiled recursively;
// named bare specifiers can be replaced by stubs (framework decorators, kits);
// every other bare specifier resolves from the importing module (its package).
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function createTsLoader(root, stubs = {}) {
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  const cache = new Map();

  function resolveTs(from, specifier) {
    const base = path.resolve(path.dirname(from), specifier);
    for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`TS_MODULE_NOT_FOUND ${specifier} from ${from}`);
  }

  function load(file) {
    const cached = cache.get(file);
    if (cached) return cached.exports;
    const source = readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        emitDecoratorMetadata: false,
        esModuleInterop: true,
      },
    });
    const module = { exports: {} };
    cache.set(file, module);
    const localRequire = (specifier) => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      if (specifier.startsWith('.')) return load(resolveTs(file, specifier));
      return createRequire(file)(specifier);
    };
    const wrapper = vm.runInThisContext(
      `(function (exports, require, module, __filename, __dirname) {${outputText}\n})`,
      { filename: file },
    );
    wrapper(module.exports, localRequire, module, file, path.dirname(file));
    return module.exports;
  }

  return (relative) => load(path.join(root, relative));
}

/** No-op Nest decorators: enough to construct and call a controller directly. */
export function nestStub() {
  const decorator = () => () => undefined;
  return new Proxy(
    {},
    {
      get: (_target, name) => (name === '__esModule' ? false : decorator),
    },
  );
}
