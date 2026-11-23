// T053 of specs/004-sessions/tasks.md (SC-413; the note under T053, B43, Q4 (a) with the review's
// C1): no administrator action writes a payment, an amount or an enrollment's confirmation. Read
// as a static invariant of the whole API, so it holds for every administrator action, later ones
// too: each of the three is written by its owning path alone, and any other file that writes one,
// an administrator router first, fails the suite.
//
//   payment      `Payment` and `PaymentEvent` are written only in `modules/payments` (ADR 0007, ERD §7).
//   confirmedAt  an enrollment's `confirmedAt` only in `booking/confirmation.repository.ts`
//                (`markConfirmed`, R-HONEST-1; its reaches are T042's `confirmation-path.spec.ts`); and
//                an order's own marker, `payments.confirmed_at`, only in payments' `markOrderConfirmed`
//                (006:T006, R-502, V-3; its one reach is read there too).
//   amount       a `…Piasters` field only in `modules/payments`, and by the two owning paths outside
//                it: the enrollment's snapshot at pay (`snapshotPricePiasters`,
//                `booking/pay.repository.ts`) and a teacher's package (`pricePiasters`,
//                `catalog/packages.repository.ts`). A later writer outside `modules/payments`
//                (track 2's) is added to `allowedBecause` by name, with its task, in that
//                track's own batch: a programme package's three prices (`price30Piasters`,
//                `price45Piasters`, `price60Piasters`, the package's file, 006:T004) and the offer's
//                frozen total (`snapshotPricePiasters`, `booking/programmes.repository.ts`, 006:T007),
//                both named by PR #156 r2 Minor 2.
//
// THE DATABASE PROOFS (this spec proves the code's shape, not a run): an administrator's
// `sessions.cancel` over the real tables, its compensation case opened with no amount
// (`tests/db-integrity/session-cancel.spec.ts`, SC-413 in its head), and the restore leaving
// `confirmed_at` as it was (`tests/db-integrity/restore.spec.ts`, «sessions.restore (FR-455,
// SC-416)», its first case).
//
// WHAT IS READ. Every TypeScript file under `apps/api/src`, less `*.spec.*`, `*.test.*` and `.d.ts`,
// parsed with TypeScript. The specs and their fixtures write worlds on purpose and run no request.
//
// WHAT IS A WRITE (the note: a `create`, `update`, `upsert`, `createMany` or `updateMany` `data`, and
// raw SQL `INSERT` or `UPDATE`).
//   (1) A Prisma write: a call `<client>.<model>.<method>(…)`, the method one of `create`,
//       `createMany`, `update`, `updateMany`, `upsert` (and `createManyAndReturn`,
//       `updateManyAndReturn`, the same writes answering rows). On `payment` or `paymentEvent` the
//       call itself is a `Payment` write, whatever it carries. Its `data` (an upsert's `create` and
//       `update`) is read key by key: `confirmedAt` or `confirmed_at` is a confirmation write; a key
//       whose last word is `piasters` an amount write. Read through a spread, a conditional, an
//       array of rows (`createMany`), an object built aside in the same file (`{ data }`), and a
//       nested write through a relation (`payments: { create: … }` is a `Payment` write), and (PR
//       #156 r2 Minor 2) a call of a function of the same file, read as the objects it returns. A
//       write is named by the function holding its Prisma call, wherever its key is spelled.
//       `where`, `select`, `include` and `orderBy` are reads and never judged.
//   (2) Raw SQL in a string or template (`$executeRaw`, `$executeRawUnsafe`, `Prisma.sql`): an
//       `INSERT INTO` or `UPDATE` of `payments` or `payment_events`; of `enrollments` naming
//       `confirmed_at`; of any table naming a `…_piasters` column. A `SELECT` is a read. Comments are
//       never read.
//
// ALLOWED, by name, with its reason and its recorded decision: `allowedBecause` below. The real
// tree must show exactly the allowed sites outside `modules/payments`, so a blind scan cannot pass.
//
// NOT SEEN. Data handed in from another function (`data: input` where `input` is a parameter), or a
// spread of one (`...rest`): the owning repositories take their rows so, and the typecheck holds
// their shape. A function of another file, or one a parameter names. A Prisma delegate held under another name (`const orders = tx.payment`). SQL built by
// concatenating strings. A reach of an owning writer from an administrator action (the
// confirmation's is T042's gate; a package's price is changed by its teacher's procedure only).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Parsing the whole API: the same allowance as `confirmation-path.spec.ts` (003:T080).
vi.setConfig({ testTimeout: 15_000 });

const root = path.resolve(__dirname, '..', '..');

/** A source file as the spec reads it: its path from the repository root, `/`-separated. */
export interface PathFile {
  readonly path: string;
  readonly text: string;
}

export type Kind = 'payment' | 'confirmedAt' | 'amount';

export interface Write {
  readonly kind: Kind;
  readonly path: string;
  readonly line: number;
  /** The function the write sits in, or null at a file's top level. */
  readonly within: string | null;
  /** The model written (`payment`), the key (`snapshotPricePiasters`), or `SQL <table>.<column>`. */
  readonly name: string;
}

const PAYMENTS = 'apps/api/src/modules/payments/';
const CONFIRMATION = 'apps/api/src/modules/booking/confirmation.repository.ts';
const PAY = 'apps/api/src/modules/booking/pay.repository.ts';
const PACKAGES = 'apps/api/src/modules/catalog/packages.repository.ts';
/** 006:T006: payments' repository, where an order's own marker is written. */
const PAYMENTS_REPOSITORY = `${PAYMENTS}payments.repository.ts`;
/** 006:T007: booking's programmes repository, where the offer freezes the enrollment's snapshot. */
const PROGRAMMES_REPOSITORY = 'apps/api/src/modules/booking/programmes.repository.ts';
/** 006:T004: a programme package's three prices, one per session length (data-model.md). */
const PROGRAMME_PRICE_KEYS: ReadonlySet<string> = new Set([
  'price30Piasters',
  'price45Piasters',
  'price60Piasters',
]);

/** The writes SC-413 allows, each by name, with its reason; every other write is refused. */
export function allowedBecause(write: Write): string | null {
  if (write.path.startsWith(PAYMENTS) && write.kind !== 'confirmedAt') {
    return 'ADR 0007, ERD §7: the payments module owns the gateway orders, their signed events and the amounts the gateway reports (the note under T053, Q4 (a))';
  }
  if (
    write.path === PAYMENTS_REPOSITORY &&
    write.kind === 'confirmedAt' &&
    write.within === 'markOrderConfirmed'
  ) {
    return "006:T006 (R-502, V-3; FR-718): an order's own marker, payments.confirmed_at, that the confirm step processed it, never an enrollment's confirmation; written by markOrderConfirmed, reached only by the confirm-enrollment job (PR #156 r1)";
  }
  if (write.path === CONFIRMATION && write.kind === 'confirmedAt') {
    return 'R-HONEST-1, FR-366: markConfirmed, reached only by the confirm-enrollment job on a signature-verified paid event (T042; the note under T053, Q4 (a))';
  }
  if (write.path === PAY && write.kind === 'amount' && write.name === 'snapshotPricePiasters') {
    return "the enrollment's price snapshot at pay, enrollments.snapshot_price_piasters (prisma/schema/booking.prisma:59), copied from the package (the note under T053, Q4 (a) with C1)";
  }
  if (write.path === PACKAGES && write.kind === 'amount' && write.name === 'pricePiasters') {
    return "a teacher's package price, packages.price_piasters (prisma/schema/catalog.prisma:50), written by the package's own repository (the note under T053, Q4 (a) with C1)";
  }
  if (write.path === PACKAGES && write.kind === 'amount' && PROGRAMME_PRICE_KEYS.has(write.name)) {
    return "006:T004 (R-503, DEC-93): a programme package's three prices, packages.price_30/45/60_piasters, written by the package's own repository (PR #156 r2 Minor 2, carried into 006:T007)";
  }
  if (
    write.path === PROGRAMMES_REPOSITORY &&
    write.kind === 'amount' &&
    write.name === 'snapshotPricePiasters'
  ) {
    return "006:T007 (FR-705, R-506): the offer's total frozen on the enrollment's snapshot, enrollments.snapshot_price_piasters, written once with the offer by booking's programmes repository from payments' amounts (K-5; PR #156 r2 Minor 2)";
  }
  return null;
}

/** The Prisma methods that write their `data` (the note's five, and the two answering rows). */
const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);
/**
 * The delegates of the two models, and the relations another model reaches `Payment` through
 * (`Enrollment.payments`, `EnrollmentEvent.payment`, `prisma/schema/booking.prisma:99, 135`).
 */
const PAYMENT_MODELS = new Set(['payment', 'paymentEvent']);
const PAYMENT_RELATIONS = new Set(['payment', 'payments']);
/** The nested write operations of a relation field. */
const NESTED_WRITES = new Set([
  'create',
  'createMany',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
]);
const CONFIRMED_AT_KEYS = new Set(['confirmedAt', 'confirmed_at']);

/** An `INSERT INTO` or `UPDATE` of a table, then the statement up to its end. */
const SQL_WRITE = /\b(insert\s+into|update)\s+(?:"?public"?\s*\.\s*)?"?(\w+)"?(?![\w"])([^;]*)/gi;
const PIASTERS_COLUMN = /\b\w+_piasters\b/gi;

/** A name's words, lowercase, split on camelCase and on any non-alphanumeric run. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/** Whether a key is an amount: its last word is `piasters`. */
const isAmountKey = (key: string): boolean => wordsOf(key).at(-1) === 'piasters';

/** A property's name when it can be read: plain, quoted or a computed string. */
function keyOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return null;
}

/** An expression through `as`, `satisfies`, `!`, `<T>` and parentheses. */
function bare(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The function a node sits in: a declared function or method by its name, an arrow or function
 * expression by the variable it is given to; else the outermost variable around it, or null.
 */
function withinOf(node: ts.Node): string | null {
  let variable: string | null = null;
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name !== undefined
    ) {
      return current.name.getText();
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      const initializer = current.initializer && bare(current.initializer);
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        return current.name.text;
      }
      variable = current.name.text;
    }
  }
  return variable;
}

/** A template's text with each substitution as `$n`. */
function templateText(template: ts.TemplateExpression): string {
  return [
    template.head.text,
    ...template.templateSpans.map((span, index) => `$${index + 1}${span.literal.text}`),
  ].join('');
}

/** The writes of one SQL text: the table, then each column judged (`SET`'s for an update). */
function sqlWrites(text: string): { kind: Kind; name: string }[] {
  return [...text.matchAll(SQL_WRITE)].flatMap(([, verb = '', table = '', rest = '']) => {
    const lowerTable = table.toLowerCase();
    if (lowerTable === 'payments' || lowerTable === 'payment_events') {
      return [{ kind: 'payment' as const, name: `SQL ${lowerTable}` }];
    }
    const written = /^update/i.test(verb)
      ? (/\bset\b([\s\S]*?)(?:\bwhere\b|\breturning\b|\bfrom\b|$)/i.exec(rest)?.[1] ?? '')
      : rest;
    const columns: { kind: Kind; name: string }[] = [];
    if (lowerTable === 'enrollments' && /\bconfirmed_at\b/i.test(written)) {
      columns.push({ kind: 'confirmedAt', name: `SQL ${lowerTable}.confirmed_at` });
    }
    for (const [column] of written.matchAll(PIASTERS_COLUMN)) {
      columns.push({ kind: 'amount', name: `SQL ${lowerTable}.${column.toLowerCase()}` });
    }
    return columns;
  });
}

/** The writes of one TypeScript file. */
function sourceWrites(file: PathFile): Write[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const writes: Write[] = [];
  // `site` is the write's own call: the function holding it names the write (`within`), so a key
  // reached through a helper or an object built aside is named where it is written (PR #156 r2
  // Minor 2); the line is the key's.
  const write = (kind: Kind, node: ts.Node, name: string, site: ts.Node = node) =>
    writes.push({
      kind,
      path: file.path,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      within: withinOf(site),
      name,
    });

  // Objects built aside: every variable of the file given an object literal, by its name; and
  // (PR #156 r2 Minor 2) every function of the file, declared or given to a variable, by its name.
  const aside = new Map<string, ts.Expression>();
  const helpers = new Map<string, ts.FunctionLikeDeclaration>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      aside.set(node.name.text, node.initializer);
      const initializer = bare(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        helpers.set(node.name.text, initializer);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      helpers.set(node.name.text, node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  /** What a function of the file returns: its expression body, or each of its own `return`s. */
  const returnsOf = (helper: ts.FunctionLikeDeclaration): ts.Expression[] => {
    const body = helper.body;
    if (body === undefined) return [];
    if (!ts.isBlock(body)) return [body as ts.Expression];
    const returned: ts.Expression[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        returned.push(node.expression);
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(body, walk);
    return returned;
  };

  /** An expression as the object, array or branches it stands for; a parameter is not seen. */
  const values = (expression: ts.Expression, seen = new Set<string>()): ts.Expression[] => {
    const value = bare(expression);
    if (ts.isConditionalExpression(value)) {
      return [...values(value.whenTrue, seen), ...values(value.whenFalse, seen)];
    }
    // PR #156 r2 Minor 2: a same-file function's call stands for the objects it returns.
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
      const name = value.expression.text;
      const helper = helpers.get(name);
      if (helper === undefined || seen.has(`${name}()`)) return [];
      const inner = new Set([...seen, `${name}()`]);
      return returnsOf(helper).flatMap((returned) => values(returned, inner));
    }
    if (ts.isArrayLiteralExpression(value)) {
      return value.elements.flatMap((element) =>
        ts.isSpreadElement(element) ? values(element.expression, seen) : values(element, seen),
      );
    }
    if (ts.isIdentifier(value) && !seen.has(value.text)) {
      const initializer = aside.get(value.text);
      return initializer === undefined ? [] : values(initializer, new Set([...seen, value.text]));
    }
    return ts.isObjectLiteralExpression(value) ? [value] : [];
  };

  /** The property of an object literal named `key`, as a value. */
  const member = (object: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property) && keyOf(property.name) === key) {
        return property.initializer;
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
        return property.name;
      }
    }
    return undefined;
  };

  /** The data objects one nested write operation carries. */
  const nestedData = (operation: string, argument: ts.Expression): ts.Expression[] =>
    values(argument).flatMap((object) => {
      if (!ts.isObjectLiteralExpression(object)) return [];
      switch (operation) {
        case 'create':
          return [object];
        case 'createMany':
        case 'update':
        case 'updateMany': {
          const data = member(object, 'data');
          // A to-one `update` carries the data itself; a to-many one `{ where, data }`.
          return data === undefined ? (operation === 'update' ? [object] : []) : [data];
        }
        case 'upsert':
        case 'connectOrCreate':
          return ['create', 'update'].flatMap((key) => {
            const part = member(object, key);
            return part === undefined ? [] : [part];
          });
        default:
          return [];
      }
    });

  /** Judges one write's data, key by key, through spreads and nested writes. */
  const judgeData = (data: ts.Expression, site: ts.Node): void => {
    for (const object of values(data)) {
      if (!ts.isObjectLiteralExpression(object)) continue;
      for (const property of object.properties) {
        if (ts.isSpreadAssignment(property)) {
          judgeData(property.expression, site);
          continue;
        }
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
          continue;
        }
        const key = keyOf(property.name);
        if (key === null) continue;
        if (CONFIRMED_AT_KEYS.has(key)) write('confirmedAt', property, key, site);
        if (isAmountKey(key)) write('amount', property, key, site);
        if (!ts.isPropertyAssignment(property)) continue;
        for (const relation of values(property.initializer)) {
          if (!ts.isObjectLiteralExpression(relation)) continue;
          for (const operation of relation.properties) {
            const name = ts.isPropertyAssignment(operation) ? keyOf(operation.name) : null;
            if (name === null || !NESTED_WRITES.has(name) || !ts.isPropertyAssignment(operation)) {
              continue;
            }
            if (PAYMENT_RELATIONS.has(key)) write('payment', operation, `${key}.${name}`, site);
            for (const nested of nestedData(name, operation.initializer)) judgeData(nested, site);
          }
        }
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const delegate = bare(node.expression.expression);
      const model = ts.isPropertyAccessExpression(delegate)
        ? delegate.name.text
        : ts.isElementAccessExpression(delegate) &&
            ts.isStringLiteralLike(delegate.argumentExpression)
          ? delegate.argumentExpression.text
          : null;
      if (model !== null) {
        if (PAYMENT_MODELS.has(model)) write('payment', node, model);
        const argument = node.arguments[0];
        for (const object of argument === undefined ? [] : values(argument)) {
          if (!ts.isObjectLiteralExpression(object)) continue;
          for (const key of method === 'upsert' ? ['create', 'update'] : ['data']) {
            const data = member(object, key);
            if (data !== undefined) judgeData(data, node);
          }
        }
      }
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const text = ts.isTemplateExpression(node) ? templateText(node) : node.text;
      for (const { kind, name } of sqlWrites(text)) write(kind, node, name);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return writes;
}

/** Every write of `files`, allowed or not. */
export function findWrites(files: readonly PathFile[]): Write[] {
  return files.flatMap(sourceWrites);
}

/** The writes SC-413 refuses. */
export function findViolations(files: readonly PathFile[]): Write[] {
  return findWrites(files).filter((write) => allowedBecause(write) === null);
}

// ---------------------------------------------------------------------------------------------
// The fixtures: each one an administrator router (or an owning file) that writes what it may not,
// and one that only reads.

const FIXTURES = 'tests/money-gates/sc413';

function fixture(relative: string): PathFile {
  const text = readFileSync(path.join(root, FIXTURES, `${relative}.txt`), 'utf8');
  return { path: relative, text };
}

const refused: readonly [string, readonly Kind[]][] = [
  ['apps/api/src/modules/sessions/refunds-admin.router.ts', ['payment']],
  ['apps/api/src/modules/moderation/events-admin.router.ts', ['payment']],
  ['apps/api/src/modules/booking/orders-admin.router.ts', ['payment']],
  ['apps/api/src/modules/sessions/orders-sql-admin.router.ts', ['payment']],
  ['apps/api/src/modules/booking/confirm-admin.router.ts', ['confirmedAt']],
  ['apps/api/src/modules/booking/confirm-sql-admin.router.ts', ['confirmedAt']],
  ['apps/api/src/modules/catalog/prices-admin.router.ts', ['amount']],
  ['apps/api/src/modules/booking/snapshot-admin.router.ts', ['amount']],
  ['apps/api/src/modules/sessions/amount-sql-admin.router.ts', ['amount']],
  ['apps/api/src/modules/catalog/price-aside-admin.router.ts', ['amount', 'amount']],
  [PAY, ['amount', 'confirmedAt']],
  [PACKAGES, ['amount']],
];

describe('SC-413: a payment, an amount or a confirmation written off its owning path is refused', () => {
  it.each(refused)('%s writes %j', (relative, kinds) => {
    expect(
      findViolations([fixture(relative)])
        .map(({ kind }) => kind)
        .sort(),
    ).toEqual([...kinds].sort());
  });

  it('allows the owning file its own field and nothing else', () => {
    const owning = findWrites([fixture(PAY), fixture(PACKAGES)])
      .filter((write) => allowedBecause(write) !== null)
      .map(({ path: where, name }) => `${where} ${name}`);
    expect(owning).toEqual([`${PAY} snapshotPricePiasters`, `${PACKAGES} pricePiasters`]);
  });

  it('leaves reads, shown values, other columns, SELECTs and comments alone', () => {
    expect(findWrites([fixture('apps/api/src/modules/sessions/reads-admin.router.ts')])).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// PR #156 r2 Minor 2 (carried into 006:T007, Q-6 (a)): a key reached through a same-file function's
// returned object is read as if written inline, and attributed to the function holding the write.

/** M-G7: a price written from an administrator's file through a helper's return. */
const PRICE_THROUGH_A_HELPER: PathFile = {
  path: 'apps/api/src/modules/admin/settings.service.ts',
  text: `
function pricesOf(price) {
  if (price === null) return {};
  return { price30Piasters: price };
}
const pricesAside = (price) => ({ price45Piasters: price });
export async function sneak(tx, id, price) {
  await tx.package.updateMany({ where: { id }, data: pricesOf(price) });
  await tx.package.update({ where: { id }, data: { isActive: true, ...pricesAside(price) } });
}
`,
};

/** The package's own file writing the three programme prices through a helper (006:T004). */
const PRICES_IN_THE_OWNER: PathFile = {
  path: PACKAGES,
  text: `
function priceColumnsOf(prices) {
  return { price30Piasters: prices.a, price45Piasters: prices.b, price60Piasters: prices.c };
}
export async function changePackage(tx, id, prices) {
  await tx.package.updateMany({ where: { id }, data: { ...(prices ? priceColumnsOf(prices) : {}) } });
}
`,
};

/** The offer's snapshot from booking's programmes file (006:T007), and the same key elsewhere. */
const OFFER_SNAPSHOT = (where: string): PathFile => ({
  path: where,
  text: `
export async function writeOffer(tx, id, offer) {
  await tx.enrollment.updateMany({ where: { id }, data: { snapshotPricePiasters: offer.total } });
}
`,
});

describe('SC-413 reads a write through a same-file helper (PR #156 r2 Minor 2, 006:T007)', () => {
  it('refuses a price written from an administrator’s file through a helper’s return (M-G7)', () => {
    expect(
      findViolations([PRICE_THROUGH_A_HELPER]).map(
        ({ kind, within, name }) => `${kind} ${within ?? '-'} ${name}`,
      ),
    ).toEqual(['amount sneak price30Piasters', 'amount sneak price45Piasters']);
  });

  it('allows the package’s own file its three prices through a helper, named at the write', () => {
    const writes = findWrites([PRICES_IN_THE_OWNER]);
    expect(writes.map(({ within, name }) => `${within ?? '-'} ${name}`)).toEqual([
      'changePackage price30Piasters',
      'changePackage price45Piasters',
      'changePackage price60Piasters',
    ]);
    for (const write of writes) expect(allowedBecause(write)).toContain('006:T004');
  });

  it('refuses the three prices from any other file of catalog', () => {
    const elsewhere = {
      ...PRICES_IN_THE_OWNER,
      path: 'apps/api/src/modules/catalog/packages.service.ts',
    };
    expect(findViolations([elsewhere]).map(({ name }) => name)).toEqual([
      'price30Piasters',
      'price45Piasters',
      'price60Piasters',
    ]);
  });

  it('allows the offer’s snapshot price from booking’s programmes file alone', () => {
    const [own] = findWrites([OFFER_SNAPSHOT(PROGRAMMES_REPOSITORY)]);
    expect(own).toBeDefined();
    expect(allowedBecause(own!)).toContain('006:T007');
    expect(
      findViolations([OFFER_SNAPSHOT('apps/api/src/modules/booking/programmes.service.ts')]).map(
        ({ name }) => name,
      ),
    ).toEqual(['snapshotPricePiasters']);
  });
});

// ---------------------------------------------------------------------------------------------
// The repository as it is.

const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build', 'coverage']);

function isRead(relative: string): boolean {
  if (!/\.(ts|tsx|mts|cts)$/.test(relative) || relative.endsWith('.d.ts')) return false;
  return !/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(relative);
}

function filesUnder(relative: string): PathFile[] {
  const entries = readdirSync(path.join(root, relative), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : filesUnder(child);
    return isRead(child)
      ? [{ path: child, text: readFileSync(path.join(root, child), 'utf8') }]
      : [];
  });
}

describe('the repository’s writes of payments, amounts and the confirmation (SC-413)', () => {
  const files = filesUnder('apps/api/src');

  it('reads the API: the owning files, the administrator routers, and no spec', () => {
    const read = new Set(files.map(({ path: where }) => where));
    for (const expected of [
      CONFIRMATION,
      PAY,
      PACKAGES,
      'apps/api/src/modules/payments/payments.repository.ts',
      'apps/api/src/modules/sessions/sessions-admin.router.ts',
      'apps/api/src/surfaces/admin.router.ts',
    ]) {
      expect(read).toContain(expected);
    }
    expect([...read].some((where) => /\.(spec|test)\./.test(where))).toBe(false);
  });

  it('has no write of a payment, an amount or a confirmation off its owning path', () => {
    expect(findViolations(files)).toEqual([]);
  });

  it('has exactly the owning writes outside modules/payments, and payments writes its own records', () => {
    const writes = findWrites(files);
    expect(
      writes
        .filter(({ path: where }) => !where.startsWith(PAYMENTS))
        .map(({ kind, path: where, within, name }) => `${kind} ${where} ${within ?? '-'} ${name}`)
        .sort(),
    ).toEqual(
      [
        `confirmedAt ${CONFIRMATION} markConfirmed confirmedAt`,
        `amount ${PAY} insertEnrollment snapshotPricePiasters`,
        // 006:T004, pinned again by PR #156 r2 Minor 2 (006:T007): the insert's and the change's
        // terms reached through the file's helpers, each named at the write. `pricePiasters` twice
        // in each: today's price, and the programme's NULL terms (`NO_FIXED_TERMS`).
        `amount ${PACKAGES} insertPackage pricePiasters`,
        `amount ${PACKAGES} insertPackage pricePiasters`,
        `amount ${PACKAGES} insertPackage price30Piasters`,
        `amount ${PACKAGES} insertPackage price45Piasters`,
        `amount ${PACKAGES} insertPackage price60Piasters`,
        `amount ${PACKAGES} changePackage pricePiasters`,
        `amount ${PACKAGES} changePackage pricePiasters`,
        `amount ${PACKAGES} changePackage price30Piasters`,
        `amount ${PACKAGES} changePackage price45Piasters`,
        `amount ${PACKAGES} changePackage price60Piasters`,
        // 006:T007: the offer's frozen total.
        `amount ${PROGRAMMES_REPOSITORY} writeOffer snapshotPricePiasters`,
      ].sort(),
    );
    const kindsInPayments = new Set(
      writes.filter(({ path: where }) => where.startsWith(PAYMENTS)).map(({ kind }) => kind),
    );
    // 006:T006 (PR #156 r1): with an order's own marker, markOrderConfirmed's.
    expect([...kindsInPayments].sort()).toEqual(['amount', 'confirmedAt', 'payment']);
  });
});
