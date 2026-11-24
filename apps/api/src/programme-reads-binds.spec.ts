// 006:T018 of specs/006-programme (FR-726, FR-727; the owner's approval of lane f's stop,
// 2026-11-24): the reads are bound in the API. `main.ts` starts a process when imported, so its
// composition is read as source, parsed with TypeScript (`programme-renewal-binds.spec.ts`'
// precedent): «unverified in live mode» built over `config.PAYMENT_MODE`; `programme.get`'s payments
// reads handed to `createBookingServices`, which hands them on with its transactions; the
// administrator's `programmes` services the decisions and the reads, over payments' reads; and the
// administrator context typing both.
//
// Observed red: `main.ts`, `surfaces/context.ts` and `booking-slots.service.ts` before T018's lines.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function sourceOf(file: string): ts.SourceFile {
  const text = readFileSync(path.join(here, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** A node as the printer writes it, comments left out, on one line. */
function printed(node: ts.Node, source: ts.SourceFile): string {
  return ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, node, source)
    .replace(/\s+/g, ' ');
}

/** Every call of `<callee>({ … })` in the file, by its argument's properties' printed values. */
function callsOf(file: string, callee: string): ReadonlyMap<string, string>[] {
  const found: ReadonlyMap<string, string>[] = [];
  const source = sourceOf(file);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callee) {
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

/** The printed type of `<interface>.<property>` in the file. */
function propertyType(file: string, owner: string, name: string): string | undefined {
  const source = sourceOf(file);
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === owner) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name.getText(source) === name) {
          found = member.type === undefined ? undefined : printed(member.type, source);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the reads, bound in the API (006:T018)', () => {
  it('red first: main.ts builds «unverified in live mode» over config.PAYMENT_MODE once', () => {
    const calls = callsOf('main.ts', 'payments.createProgrammePayee');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.get('paymentMode')).toBe('config.PAYMENT_MODE');
  });

  it('red first: main.ts hands programme.get’s payments reads to createBookingServices', () => {
    const [booking] = callsOf('main.ts', 'booking.createBookingServices');
    const reads = booking?.get('programmeReads') ?? '';
    expect(reads).toContain('payee: programmePayee');
    expect(reads).toContain('monthOrders: payments.programmeMonthOrdersOf');
    expect(reads).toContain('cardOf: payments.programmeCardOf');
  });

  it('red first: createBookingServices hands them on to the programme services with its transactions', () => {
    const text = readFileSync(path.join(here, 'modules/booking/booking-slots.service.ts'), 'utf8');
    expect(text).toMatch(/reads: \{ transactions, payments: programmeReads \}/);
  });

  it('red first: main.ts builds the administrator’s programmes from the decisions and the reads', () => {
    const calls = callsOf('main.ts', 'booking.createProgrammeAdminReads');
    expect(calls).toHaveLength(1);
    const payments = calls[0]?.get('payments') ?? '';
    expect(calls[0]?.get('settings')).toBe('settings');
    expect(payments).toContain('payee: programmePayee');
    expect(payments).toContain('monthOrders: payments.programmeMonthOrdersOf');
    expect(payments).toContain('ordersOf: payments.enrollmentOrdersOf');
    expect(payments).toContain('payments.releasesOf(tx, [enrollmentId])');
    expect(payments).toContain("milestone === 'assessment'");
  });

  it('red first: the administrator context types programmes as the decisions and the reads', () => {
    expect(propertyType('surfaces/context.ts', 'AdminSurfaceServices', 'programmes')).toBe(
      'ProgrammeDecisions & ProgrammeAdminReads',
    );
  });
});
