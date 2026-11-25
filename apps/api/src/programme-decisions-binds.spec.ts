// 006:T021 of specs/006-programme (SRS DEC-113; B-P4's conflict check, Q-1 (a) amended; the owner's
// approval of lane s's stop, 2026-11-25, «Approve both»): the API binds payments' three entries a
// `charge_unknown` decision is handed (booking imports no payments): the month's orders, the order's
// lock with its status, and the expiry. Without them the decision fails loudly («the charge entries
// are not bound»). `main.ts` starts a process when imported, so its composition is read as source,
// parsed with TypeScript (`programme-renewal-binds.spec.ts`' precedent): every call of
// `booking.createProgrammeDecisions(...)` must carry those `charges`.
//
// Observed red: `main.ts` before this bind (no `charges`).
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

describe('the charge_unknown decision’s payments entries, bound in the API (006:T021)', () => {
  it('red first: main.ts hands booking’s decisions payments’ orders, the order’s lock and the expiry', () => {
    const calls = callsOf('main.ts', 'booking', 'createProgrammeDecisions');
    expect(calls).toHaveLength(1);
    for (const properties of calls) {
      expect(properties.get('charges')).toBe(
        '{ monthOrders: payments.programmeMonthOrdersOf, lockOrder: payments.lockedAutomaticOrderStatus, expireOrder: payments.expireAutomaticOrder, }',
      );
    }
  });
});
