// 006:T016 of specs/006-programme (FR-716, FR-720; PR #153 r3 Minor 1, r4 Minor 2; the owner's approval
// of lane d's stop, 2026-11-24): the API binds the payment mode into payments' checkout, over which
// T008's «unverified in live mode» refuses `programme.pay` and `programme.renew` `payee_unverified`
// before the gateway. `main.ts` starts a process when imported, so its composition is read as source,
// parsed with TypeScript (`programme-cards-binds.spec.ts`' precedent): every call of
// `payments.createCheckoutServices(...)` must carry `paymentMode: config.PAYMENT_MODE`.
//
// Observed red: `main.ts` before T016 (no payment mode).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function sourceOf(file: string): ts.SourceFile {
  const text = readFileSync(path.join(here, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** A call's first argument, an object literal: each property's name and its value's text. */
type Bound = ReadonlyMap<string, string>;

/** Every call of `<object>.<method>({ … })` in the file, by its argument's properties. */
function callsOf(file: string, object: string, method: string): Bound[] {
  const found: Bound[] = [];
  const source = sourceOf(file);
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method &&
      node.expression.expression.getText(source) === object
    ) {
      const [argument] = node.arguments;
      const properties = new Map<string, string>();
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (ts.isPropertyAssignment(property)) {
            properties.set(property.name.getText(source), printed(property.initializer, source));
          } else if (ts.isShorthandPropertyAssignment(property)) {
            properties.set(property.name.text, property.name.text);
          }
        }
      }
      found.push(properties);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A value as the printer writes it, comments left out, on one line. */
function printed(node: ts.Node, source: ts.SourceFile): string {
  return ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Expression, node, source)
    .replace(/\s+/g, ' ');
}

describe('the checkout’s payment mode, bound in the API (006:T016)', () => {
  it('red first: main.ts builds payments’ checkout with config.PAYMENT_MODE', () => {
    const calls = callsOf('main.ts', 'payments', 'createCheckoutServices');
    expect(calls).toHaveLength(1);
    for (const properties of calls) {
      expect(properties.get('paymentMode')).toBe('config.PAYMENT_MODE');
    }
  });
});
