import ts from 'typescript';
export interface Reference {
  readonly specifier: string | null;
  readonly kind: string;
  readonly line: number;
  readonly column: number;
}
export interface ParseResult {
  readonly references: readonly Reference[];
  readonly syntaxErrors: readonly string[];
}
/** Read module syntax, not text that happens to resemble an import. */
export function collectReferences(file: string, text: string): ParseResult {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const references: Reference[] = [];
  const factories = new Set(['createRequire']);
  const loaders = new Set(['require']);
  const moduleNamespaces = new Set<string>();
  const literal = (node: ts.Node | undefined): string | null => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      return node.text;
    }
    return null;
  };
  const add = (node: ts.Node, argument: ts.Node | undefined, kind: string): void => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    references.push({
      specifier: literal(argument),
      kind,
      line: position.line + 1,
      column: position.character + 1,
    });
  };
  const factoryCall = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    const callee = node.expression;
    return (
      (ts.isIdentifier(callee) && factories.has(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        moduleNamespaces.has(callee.expression.text) &&
        callee.name.text === 'createRequire')
    );
  };
  // Resolve loader names before walking calls, including renamed createRequire imports.
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !['module', 'node:module'].includes(literal(statement.moduleSpecifier) ?? '')
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === 'createRequire') factories.add(element.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      moduleNamespaces.add(bindings.name.text);
    }
    if (statement.importClause?.name) moduleNamespaces.add(statement.importClause.name.text);
  }
  const collectLoaders = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (factoryCall(node.initializer)) loaders.add(node.name.text);
    }
    ts.forEachChild(node, collectLoaders);
  };
  collectLoaders(source);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier)
        add(node, node.moduleSpecifier, ts.isImportDeclaration(node) ? 'import' : 're-export');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, 'import-equals');
    } else if (ts.isImportTypeNode(node)) {
      add(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, 'import-type');
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        add(node, node.arguments[0], 'dynamic-import');
      } else if (ts.isIdentifier(callee) && loaders.has(callee.text)) {
        add(node, node.arguments[0], 'require');
      } else if (factoryCall(callee)) {
        add(node, node.arguments[0], 'createRequire-call');
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        ((loaders.has(callee.expression.text) && callee.name.text === 'resolve') ||
          (callee.expression.text === 'module' && callee.name.text === 'require'))
      ) {
        add(node, node.arguments[0], 'require-property');
      } else if (ts.isIdentifier(callee) && ['eval', 'Function'].includes(callee.text)) {
        add(node, undefined, 'opaque-code-loader');
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      (loaders.has(node.initializer.text) || factories.has(node.initializer.text))
    ) {
      add(node, undefined, 'aliased-loader');
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Function'
    ) {
      add(node, undefined, 'opaque-code-loader');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const reference of [...source.referencedFiles, ...source.typeReferenceDirectives]) {
    const position = source.getLineAndCharacterOfPosition(reference.pos);
    references.push({
      specifier: reference.fileName,
      kind: 'triple-slash',
      line: position.line + 1,
      column: position.character + 1,
    });
  }
  // parseDiagnostics is the compiler's parser result (pinned and regression tested).
  const parsed = source as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  };
  return {
    references,
    syntaxErrors: parsed.parseDiagnostics.map((error) =>
      ts.flattenDiagnosticMessageText(error.messageText, '\n'),
    ),
  };
}
