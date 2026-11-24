// 006:T015 of specs/006-programme (R-508; B-P3 lane c's stop, approved 2026-11-24): the composition
// roots bind the sweep and `programme.cancel`'s «pending» read.
// - `main.ts`: `booking.createBookingServices(...)` carries `programmeOrders:
//   payments.checkoutOrdersAmong`, so the API's `programme.cancel` refuses `payment_processing`.
// - `worker.ts`: the job's sweep (`programmeSweepOver(...)`) carries payments' month reader, its
//   `checkoutOrdersAmong`, its automatic charge, its `deleteProgrammeCard` and its «unverified in
//   live mode» over `config.PAYMENT_MODE`; and `advanceProgrammes(...)` is among the jobs.
// The entrypoints start a process when imported, so their source is read, parsed with TypeScript
// (as `programme-cards-binds.spec.ts`, 006:T013's precedent).
//
// Observed red: `main.ts` and `worker.ts` before the binds.
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

describe('programme.cancel reads the orders in the API (006:T015, Q-8 (a))', () => {
  it('main.ts builds booking’s services with payments’ checkoutOrdersAmong', () => {
    const calls = callsOf('main.ts', 'booking', 'createBookingServices');
    expect(calls.length).toBeGreaterThan(0);
    for (const properties of calls) {
      expect(properties.get('programmeOrders')).toBe('payments.checkoutOrdersAmong');
    }
  });
});

describe('the advance-programmes sweep, registered in the worker (006:T015, R-508)', () => {
  it('worker.ts binds the sweep over payments’ entries', () => {
    const [sweep, ...more] = callsOf('worker.ts', 'programmeJobs', 'programmeSweepOver');
    expect(more).toEqual([]);
    expect(sweep?.get('monthOrders')).toBe('payments.programmeMonthOrdersOf');
    expect(sweep?.get('orders')).toBe('payments.checkoutOrdersAmong');
    expect(sweep?.get('deleteProgrammeCard')).toBe('payments.deleteProgrammeCard');
    expect(sweep?.get('payee')).toBe(
      'payments.createProgrammePayee({ paymentMode: config.PAYMENT_MODE, cipher })',
    );
    expect(sweep?.get('charges')).toMatch(/^payments\.createProgrammeCharges\(\{/);
    expect(sweep?.get('charges')).toContain('paymentMode: config.PAYMENT_MODE');
  });

  it('worker.ts registers advance-programmes among its jobs', () => {
    expect(callsOf('worker.ts', 'programmeJobs', 'advanceProgrammes')).toHaveLength(1);
  });
});
