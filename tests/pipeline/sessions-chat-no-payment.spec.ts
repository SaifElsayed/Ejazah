// T053 of specs/004-sessions/tasks.md (FR-498; SC-409; the note under T053, B43, Q3 (a)): sessions
// and chat name no payment, no amount and no gateway order. The money stays in `modules/payments`
// (ADR 0007, R-MONEY-6): a session and a chat message know an enrollment, never what it cost or
// which gateway order paid for it.
//
// WHAT IS READ. Every TypeScript file under `apps/api/src/modules/sessions` and
// `apps/api/src/modules/chat`, less `*.spec.*`, `*.test.*` and `.d.ts`: the specs build worlds with
// packages and prices on purpose and run no request. Each file is parsed with TypeScript.
//
// BY NAMES, NOT WORDS (Q3 (a)). A comment is never read, and prose in a string is never read, so
// «rows locked in id order» or «the price is the teacher's» in a sentence trips nothing. What is
// judged: every identifier (a declaration, a reference, a property, a type, an import's name), a
// quoted property name or string key, and in a string or template's text the snake_case names
// (`gateway_order_id`, `price_piasters`) and the tables raw SQL reads or writes. A name is split
// into words on camelCase and on `_`, compared lowercase, as `boundaries/no-money-vocabulary` does.
//
// WHAT IS REFUSED, each kind red under its own fixture (`tests/money-gates/sc409/`):
//   import  an import, a re-export, `import()`, `require` or an import type of `modules/payments`
//           or `platform/ports/payment`, or of any module whose path names a payment
//           (`payment-reader`), unless it is allowed below;
//   model   the `Payment` or `PaymentEvent` model: a delegate (`.payment`, `.paymentEvent`), the
//           relation (`payments`) as a member or a key of a Prisma argument, a generated type or enum
//           (`Payment`, `PaymentEvent`, `PaymentStatus`), or the `payments` or `payment_events`
//           table in raw SQL;
//   amount  a name carrying `price` or `piasters` (`price`, `pricePiasters`, `amount_piasters`, the
//           `Piasters` brand);
//   order   a gateway order reference: `order` followed by `id`, `ref` or `number` (`orderId`,
//           `merchantOrderId`, `gateway_order_id`), or `order` beside `gateway` or `merchant`
//           (`gatewayOrder`). `orderBy`, `partiesInOrder` and `order_failed` are not one.
//
// ALLOWED, by name, with its reason and its recorded decision: `ALLOWED_IMPORTS` below. The real
// tree must reach each allowed module, so an allowance nothing uses is red too.
//
// NOT SEEN. A name built at run time (`tx[name]`, a SQL string concatenated from parts); a Prisma
// delegate handed to these modules by a caller under another name; the money a dependency handed in
// by `main.ts` carries behind a port whose own file names none (the port's file is read).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Parsing two modules' sources: the same allowance as `confirmation-path.spec.ts` (003:T080).
vi.setConfig({ testTimeout: 15_000 });

const root = path.resolve(__dirname, '..', '..');

/** A source file as the spec reads it: its path from the repository root, `/`-separated. */
export interface PathFile {
  readonly path: string;
  readonly text: string;
}

export type Kind = 'import' | 'model' | 'amount' | 'order';

export interface Site {
  readonly kind: Kind;
  readonly path: string;
  readonly line: number;
  /** The name, or the module an import lands on, or the SQL table. */
  readonly name: string;
  /** The reason an allowed site is allowed; null when it is refused. */
  readonly allowedBecause: string | null;
}

/** The two modules SC-409 reads. */
export const SCANNED = ['apps/api/src/modules/sessions', 'apps/api/src/modules/chat'] as const;

/** The modules sessions and chat may import although their names speak of payments. */
export const ALLOWED_IMPORTS: ReadonlyMap<string, string> = new Map([
  [
    'apps/api/src/modules/sessions/enrollment-payments.port',
    'T073 (FR-507; the note under T073, Q4 (a), N3): the restore asks whether an order of the enrollment was refunded; a yes or no, no amount and no record; payments implements it and the admin module hands it in, since sessions may not import payments',
  ],
]);

/** The modules that own the money: an import of either is refused. */
const PAYMENT_MODULES = ['apps/api/src/modules/payments', 'apps/api/src/platform/ports/payment'];

/** The Prisma model's delegates and relations: `tx.payment`, `enrollment.payments`. */
const MODEL_MEMBERS = new Set(['payment', 'payments', 'paymentEvent', 'paymentEvents']);
/** A generated type or enum of the two models: `Payment`, `PaymentEvent`, `PaymentStatus`. */
const MODEL_TYPE = /^Payment(?:[A-Z_]|$)/;
/** The keys of a Prisma argument under which a relation's name is a model access. */
const PRISMA_KEYS = new Set([
  'where',
  'select',
  'include',
  'orderBy',
  'data',
  'create',
  'update',
  'connect',
  'some',
  'every',
  'none',
  'is',
  '_count',
]);
/** A table of the two models after a SQL keyword that reads or writes it. */
const MODEL_TABLE =
  /\b(?:from|join|into|update|table)\s+(?:"?public"?\s*\.\s*)?"?(payments|payment_events)"?(?![\w"])/gi;
/** A snake_case name inside a string or template: `price_piasters`, `gateway_order_id`. */
const SNAKE_NAME = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;

/** A name's words, lowercase, split on camelCase and on any non-alphanumeric run. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

const AMOUNT_WORDS = new Set(['price', 'prices', 'piasters']);
const ORDER_REFERENCE_WORDS = new Set(['id', 'ids', 'ref', 'refs', 'reference', 'number']);
const ORDER_OWNER_WORDS = new Set(['gateway', 'merchant']);

/** The kind a name is refused as, judged on its words; null when it names none of the four. */
function nameKind(name: string): 'amount' | 'order' | null {
  const words = wordsOf(name);
  if (words.some((word) => AMOUNT_WORDS.has(word))) return 'amount';
  const order = words.flatMap((word, index) => (word === 'order' ? [index] : []));
  if (
    order.some((index) => ORDER_REFERENCE_WORDS.has(words[index + 1] ?? '')) ||
    (order.length > 0 && words.some((word) => ORDER_OWNER_WORDS.has(word)))
  ) {
    return 'order';
  }
  return null;
}

/** The repository-relative module a specifier lands on, with no extension or `/index`. */
function landing(from: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return joined.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '');
}

/** Whether a module is one sessions and chat may not import: the money's owners, or a payment by name. */
function isPaymentModule(module: string): boolean {
  return (
    PAYMENT_MODULES.some((owner) => module === owner || module.startsWith(`${owner}/`)) ||
    module.split('/').some((segment) => {
      const words = wordsOf(segment);
      return words.includes('payment') || words.includes('payments');
    })
  );
}

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

/** Whether an object literal is a Prisma argument's: some key around it, through objects and arrays, is one. */
function underPrismaKey(object: ts.Node): boolean {
  let node: ts.Node = object;
  while (node.parent !== undefined) {
    const parent = node.parent;
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
      const key = keyOf(parent.name);
      if (key !== null && PRISMA_KEYS.has(key)) return true;
    } else if (!ts.isObjectLiteralExpression(parent) && !ts.isArrayLiteralExpression(parent)) {
      return false;
    }
    node = parent;
  }
  return false;
}

/** A template's text with each substitution as `$n`. */
function templateText(template: ts.TemplateExpression): string {
  return [
    template.head.text,
    ...template.templateSpans.map((span, index) => `$${index + 1}${span.literal.text}`),
  ].join('');
}

/** Whether a string literal stands for a name: a quoted key, a string key of a member, a computed key. */
function isNamePosition(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return (
    ((ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
    ts.isComputedPropertyName(parent) ||
    ts.isLiteralTypeNode(parent)
  );
}

/** The module a node imports, when it is an import, a re-export, `import()`, `require` or an import type. */
function importedSpecifier(node: ts.Node): ts.StringLiteralLike | null {
  const specifier =
    ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
        ? node.moduleReference.expression
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          ? node.arguments[0]
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : undefined;
  return specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier : null;
}

/** The sites of one TypeScript file. */
function sourceSites(file: PathFile): Site[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: Site[] = [];
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const site = (kind: Kind, node: ts.Node, name: string, allowedBecause: string | null = null) =>
    sites.push({ kind, path: file.path, line: lineOf(node), name, allowedBecause });
  const judgeName = (node: ts.Node, name: string) => {
    const kind = nameKind(name);
    if (kind !== null) site(kind, node, name);
  };
  const specifiers = new Set<ts.Node>();

  const visit = (node: ts.Node): void => {
    const specifier = importedSpecifier(node);
    if (specifier !== null) {
      specifiers.add(specifier);
      const module = landing(file.path, specifier.text);
      if (isPaymentModule(module))
        site('import', node, module, ALLOWED_IMPORTS.get(module) ?? null);
    }

    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const name = node.text;
      const parent = node.parent;
      if (MODEL_TYPE.test(name)) site('model', node, name);
      else if (
        MODEL_MEMBERS.has(name) &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) &&
            parent.name === node &&
            underPrismaKey(parent.parent)))
      ) {
        site('model', node, name);
      }
      judgeName(node, name);
    } else if (ts.isStringLiteralLike(node) && !specifiers.has(node)) {
      if (isNamePosition(node)) {
        if (MODEL_MEMBERS.has(node.text)) site('model', node, node.text);
        judgeName(node, node.text);
      } else {
        stringSites(node, node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      stringSites(node, templateText(node));
    }
    ts.forEachChild(node, visit);
  };

  /** A string's snake_case names and the model tables its SQL names; its prose is never read. */
  const stringSites = (node: ts.Node, text: string) => {
    for (const [, table] of text.matchAll(MODEL_TABLE)) site('model', node, `SQL ${table}`);
    for (const [name] of text.matchAll(SNAKE_NAME)) judgeName(node, name);
  };

  ts.forEachChild(source, visit);
  return sites;
}

/** Every site of `files`: the refused and the allowed. */
export function findSites(files: readonly PathFile[]): Site[] {
  return files.flatMap(sourceSites);
}

/** The sites SC-409 refuses. */
export function findViolations(files: readonly PathFile[]): Site[] {
  return findSites(files).filter(({ allowedBecause }) => allowedBecause === null);
}

// ---------------------------------------------------------------------------------------------
// The fixtures: each one a file of sessions or chat that names a payment in one way, and one that
// names none.

const FIXTURES = 'tests/money-gates/sc409';

function fixture(relative: string): PathFile {
  const text = readFileSync(path.join(root, FIXTURES, `${relative}.txt`), 'utf8');
  return { path: relative, text };
}

const refused: readonly [string, Kind][] = [
  ['apps/api/src/modules/sessions/imports-payments-module.ts', 'import'],
  ['apps/api/src/modules/chat/imports-payment-port.ts', 'import'],
  ['apps/api/src/modules/sessions/imports-payment-named-module.ts', 'import'],
  ['apps/api/src/modules/sessions/reads-payment-rows.ts', 'model'],
  ['apps/api/src/modules/chat/reads-payment-events.ts', 'model'],
  ['apps/api/src/modules/chat/types-payment-model.ts', 'model'],
  ['apps/api/src/modules/sessions/reads-payments-table.ts', 'model'],
  ['apps/api/src/modules/sessions/names-a-price.ts', 'amount'],
  ['apps/api/src/modules/chat/names-a-piasters-column.ts', 'amount'],
  ['apps/api/src/modules/chat/selects-a-piasters-column.ts', 'amount'],
  ['apps/api/src/modules/sessions/types-piasters.ts', 'amount'],
  ['apps/api/src/modules/chat/names-an-order-id.ts', 'order'],
  ['apps/api/src/modules/sessions/names-a-merchant-order-id.ts', 'order'],
  ['apps/api/src/modules/chat/names-a-gateway-order.ts', 'order'],
];

describe('SC-409: sessions and chat refuse every payment, amount and order name (FR-498)', () => {
  it.each(refused)('%s is refused: %s', (relative, kind) => {
    const sites = findViolations([fixture(relative)]);
    expect(sites.map((site) => site.kind)).toContain(kind);
    expect(sites.every((site) => site.kind === kind)).toBe(true);
  });

  it('leaves alone id order, orderBy, a name with «order», prose and the allowed port', () => {
    const clean = fixture('apps/api/src/modules/sessions/rows-in-id-order.ts');
    expect(findViolations([clean])).toEqual([]);
    expect(
      findSites([clean]).map(({ kind, name, allowedBecause }) => [kind, name, allowedBecause]),
    ).toEqual([
      [
        'import',
        'apps/api/src/modules/sessions/enrollment-payments.port',
        ALLOWED_IMPORTS.get('apps/api/src/modules/sessions/enrollment-payments.port'),
      ],
    ]);
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

describe('the repository’s sessions and chat (SC-409)', () => {
  const files = SCANNED.flatMap(filesUnder);

  it('reads both modules, their entries, the port and the restore, and no spec', () => {
    const read = new Set(files.map(({ path: where }) => where));
    for (const expected of [
      'apps/api/src/modules/sessions/index.ts',
      'apps/api/src/modules/chat/index.ts',
      'apps/api/src/modules/sessions/enrollment-payments.port.ts',
      'apps/api/src/modules/sessions/restore.service.ts',
    ]) {
      expect(read).toContain(expected);
    }
    expect([...read].some((where) => /\.(spec|test)\./.test(where))).toBe(false);
  });

  it('names no payment, amount or gateway order', () => {
    expect(findViolations(files)).toEqual([]);
  });

  it('sees all four kinds where the money lives, so a blind scan cannot pass (modules/payments)', () => {
    const kinds = new Set(
      findViolations(filesUnder('apps/api/src/modules/payments')).map(({ kind }) => kind),
    );
    expect([...kinds].sort()).toEqual(['amount', 'import', 'model', 'order']);
  });

  it('reaches the allowed port exactly where the restore needs it: its service and the entry', () => {
    expect(
      findSites(files)
        .filter(({ allowedBecause }) => allowedBecause !== null)
        .map(({ kind, path: where, name }) => `${kind} ${where} ${name}`)
        .sort(),
    ).toEqual(
      [
        'import apps/api/src/modules/sessions/index.ts apps/api/src/modules/sessions/enrollment-payments.port',
        'import apps/api/src/modules/sessions/restore.service.ts apps/api/src/modules/sessions/enrollment-payments.port',
      ].sort(),
    );
  });
});
