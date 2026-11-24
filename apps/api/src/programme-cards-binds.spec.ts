// 006:T013 of specs/006-programme (R-510; FR-719; SRS DEC-112, Q-B2 (a); the note under T013): the
// composition roots bind payments' card entry and the log into booking's close hook, so a close the
// worker runs deletes the card and writes its line (ids and a reason) as the API's does; and the
// payment webhook is handed the column cipher a saved card's token is encrypted with.
//
// WHAT IS READ. `main.ts` and `worker.ts` are entrypoints that start a process when imported, so
// their composition is read as source, parsed with TypeScript: every call of
// `booking.createEnrollmentSide(...)` must carry `programmes: { deleteProgrammeCard:
// payments.deleteProgrammeCard, log }`; `payments.createPaymentWebhookRoute(...)` must carry
// `cipher`, and `booking.createBookingServices(...)` must carry `deleteProgrammeCard:
// payments.deleteProgrammeCard`. A call bound some other way (a stub, no log) is red.
//
// Observed red: `worker.ts` before T013 (its `createEnrollmentSide({ settings })`, the close hook's
// silent default), `main.ts` before T013 (the webhook with no cipher) and before the bind of
// `createBookingServices` (its `programme.cancel` on the silent default).
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

describe('the close hook’s card entry and log, bound in both processes (006:T013, DEC-112 Q-B2 (a))', () => {
  it.each(['main.ts', 'worker.ts'])(
    '%s builds sessions’ EnrollmentSide with payments’ deleteProgrammeCard and the log',
    (file) => {
      const calls = callsOf(file, 'booking', 'createEnrollmentSide');
      expect(calls.length).toBeGreaterThan(0);
      for (const properties of calls) {
        expect(properties.get('programmes')).toBe(
          '{ deleteProgrammeCard: payments.deleteProgrammeCard, log }',
        );
      }
    },
  );
});

describe('the payment webhook’s column cipher (006:T013, R-510, R-DB-8)', () => {
  it('main.ts hands the webhook the column cipher a saved card’s token is encrypted with', () => {
    const calls = callsOf('main.ts', 'payments', 'createPaymentWebhookRoute');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.get('cipher')).toBe('cipher');
  });
});

describe('the API’s programme.cancel deletes the card through payments’ entry (006:T013, DEC-112 Q-B2 (a))', () => {
  it('main.ts hands booking’s services payments’ deleteProgrammeCard', () => {
    const calls = callsOf('main.ts', 'booking', 'createBookingServices');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.get('deleteProgrammeCard')).toBe('payments.deleteProgrammeCard');
  });
});
