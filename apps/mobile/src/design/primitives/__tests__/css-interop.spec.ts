// T102: NativeWind's JSX runtime wraps every element and drops a `style` written as a function on
// `Pressable` (nativewind/nativewind#1128), which left every button, card and row unstyled on the
// device. Each such Pressable opts out with `cssInterop={false}`; this scan of the phone's source
// with the TypeScript compiler refuses one that does not, naming its file and line.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';

const sourceRoot = path.resolve(__dirname, '../../..');

function tsxFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** The names under which a file reaches React Native's `Pressable`: `Pressable`, `P`, `RN.Pressable`. */
function pressableNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'react-native') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.Pressable`);
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'Pressable') names.add(element.name.text);
    }
  }
  return names;
}

function attribute(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
}

function expressionOf(node: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const initializer = node?.initializer;
  if (initializer === undefined || !ts.isJsxExpression(initializer)) return undefined;
  let expression = initializer.expression;
  while (expression !== undefined && ts.isParenthesizedExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function hasFunctionStyle(attributes: ts.JsxAttributes): boolean {
  const style = expressionOf(attribute(attributes, 'style'));
  return style !== undefined && (ts.isArrowFunction(style) || ts.isFunctionExpression(style));
}

function optsOut(attributes: ts.JsxAttributes): boolean {
  return expressionOf(attribute(attributes, 'cssInterop'))?.kind === ts.SyntaxKind.FalseKeyword;
}

interface Site {
  readonly where: string;
  readonly optsOut: boolean;
}

/** Every Pressable in the file whose `style` is a function, with its file and line. */
function functionStylePressables(fileName: string): Site[] {
  const file = ts.createSourceFile(
    fileName,
    readFileSync(fileName, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = pressableNames(file);
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      names.has(node.tagName.getText(file)) &&
      hasFunctionStyle(node.attributes)
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      sites.push({
        where: `${path.relative(sourceRoot, fileName).split(path.sep).join('/')}:${line + 1}`,
        optsOut: optsOut(node.attributes),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

describe('a Pressable styled by a function', () => {
  const sites = tsxFiles(sourceRoot).flatMap(functionStylePressables);

  it('is found by the scan', () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it('opts out of NativeWind with cssInterop={false}', () => {
    expect(sites.filter((site) => !site.optsOut).map((site) => site.where)).toEqual([]);
  });
});
