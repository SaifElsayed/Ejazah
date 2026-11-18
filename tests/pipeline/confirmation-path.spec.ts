// T042 (R-HONEST-1, FR-366, SC-307; contracts/kernel.md "Gates"): the gate of the confirmation path.
// `enrollments.status = 'confirmed'` and `enrollments.confirmed_at` have one writer, booking's
// `markConfirmed`, called by `booking.confirmEnrollment` alone, which only the `confirm-enrollment`
// job calls (`apps/api/src/jobs/confirm-enrollment.ts`, on a persisted, signature-verified paid
// event). The status has one more writer, booking's `restoreEnrollment` (an administrator's restore:
// FR-455, R-322, ADR 0023), called by `EnrollmentSide.restore` alone, which returns an enrollment a
// payment once confirmed to `confirmed` and never writes `confirmed_at` (T008's follow-up, the
// owner's decision of 2026-11-07). No procedure, admin action, upload, redirect or sweep may confirm
// an enrollment otherwise, and this file fails the suite on the first that tries. Stage 2 of the
// pipeline runs it with the rest.
//
// WHAT IS READ. Every TypeScript file that runs outside a test: `apps/api/src`, every package's
// `src`, `scripts` and `prisma/seed.ts`, less `*.spec.ts` and `*.test.ts`; and every migration's
// SQL. The specs and the test tree build worlds with confirmed enrollments on purpose, and none of
// them is a path a request, a job or a deployment runs. Each file is parsed with TypeScript.
//
// WHAT IS A WRITE. (1) In an object literal, `status` given `'confirmed'` (as a string, a template
// with no substitution, `{ set: 'confirmed' }`, `EnrollmentStatus.confirmed` or any `.confirmed`
// member, through `as`, `satisfies` or parentheses), or a `confirmedAt` or `confirmed_at` key of any
// value, plain, quoted, computed from a string or shorthand; unless the nearest Prisma key around it
// reads (`where`, `select`, `include`, `orderBy`, `cursor`, `distinct`, `omit`, `by`, `having`, the
// aggregates). So `data`, `create` and `update` of `create`, `createMany`, `update`, `updateMany` and
// `upsert`, nested writes through a relation, and an object built aside and handed in later are all
// writes; a key outside any Prisma call is a write too, since where it goes cannot be read. (2) Raw
// SQL in a string or template: an `UPDATE` of, or an `INSERT INTO`, `enrollments` that names
// `status` or `confirmed_at`, whatever the value (an interpolated value cannot be read), in any
// statement of a migration as in a `$executeRaw`, `$queryRaw`, `Prisma.sql` or `Unsafe` string.
//
// WHAT IS A REACH. `markConfirmed` imported from `booking/confirmation.repository`, and
// `restoreEnrollment` from `booking/enrollment-side.repository` (named, by a namespace, re-exported,
// or imported dynamically), or either called inside its own file; and
// `confirmEnrollment` reached in booking's entry or `confirmation.service` (named import or
// re-export, `export *`, a namespace's member by dot, by a string key or destructured, the
// namespace handed on as a value or read by a key that is not a string, a dynamic import or a
// `require`), or called inside that file. The job's own export, also named `confirmEnrollment`, is
// another binding and never a reach.
//
// ALLOWED. The write inside `markConfirmed`; its one call inside `confirmEnrollment`; booking's
// entry re-exporting `confirmEnrollment`; and the job reaching it. And the second writer: the
// `status` write inside `restoreEnrollment` (FR-455, R-322, ADR 0023), only `status` there, never a
// `confirmedAt` or `confirmed_at` key nor raw SQL, since a restore never writes `confirmed_at`; and
// its one reach, inside `enrollment-side.service`'s `restore`. Everything else is refused.
// The real tree must show exactly those sites, so a scanner that saw nothing could not pass.
//
// NOT SEEN (the reviewer's, R-HONEST-1's second mechanism). A `status` key whose value is a variable
// or a call that yields `'confirmed'` (a literal elsewhere, `data: { status: next }`: booking's
// `moveEnrollment` writes `status: target.status`, whose type leaves `confirmed` out, so the
// typecheck holds what this file cannot read); a Prisma
// delegate or the database driver handed to code outside these roots; SQL built by concatenating
// strings, so that no single string names both `enrollments` and the column; a write from a
// database function or trigger body whose text does not start with `UPDATE` or `INSERT INTO`
// `enrollments` (none exists); the phone and the panel, which have no database client; and who
// runs the job, which the webhook and the sweep enqueue (T038, T040).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// 003:T080, decision 10: parsing the source takes 0.74 s alone, past 5 s under load (B32).
vi.setConfig({ testTimeout: 15_000 });

const root = path.resolve(__dirname, '..', '..');

/** A source file as the gate reads it: its path from the repository root, `/`-separated. */
export interface PathFile {
  readonly path: string;
  readonly text: string;
}

/** Where the confirmation path lives. */
const BOOKING = 'apps/api/src/modules/booking';
const REPOSITORY = `${BOOKING}/confirmation.repository.ts`;
const SERVICE = `${BOOKING}/confirmation.service.ts`;
const ENTRY = `${BOOKING}/index.ts`;
const JOB = 'apps/api/src/jobs/confirm-enrollment.ts';
const SIDE_REPOSITORY = `${BOOKING}/enrollment-side.repository.ts`;
const SIDE_SERVICE = `${BOOKING}/enrollment-side.service.ts`;

/** What a site is: a write of the columns, or a reach of one of the three functions. */
export type SiteKind = 'write' | 'markConfirmed' | 'restoreEnrollment' | 'confirmEnrollment';

/** The two functions that write the columns. */
type Writer = 'markConfirmed' | 'restoreEnrollment';

export interface Site {
  readonly kind: SiteKind;
  readonly path: string;
  readonly line: number;
  /** The function the site sits in, or null at a file's top level. */
  readonly within: string | null;
  /** The column a write's key names; null for raw SQL, whose column is not told apart, and a reach. */
  readonly column: 'status' | 'confirmed_at' | null;
  readonly what: string;
}

/** The sites the confirmation path allows (this file's head). */
export function allowed(site: Site): boolean {
  switch (site.kind) {
    case 'write':
      return (
        (site.path === REPOSITORY && site.within === 'markConfirmed') ||
        (site.path === SIDE_REPOSITORY &&
          site.within === 'restoreEnrollment' &&
          site.column === 'status')
      );
    case 'markConfirmed':
      return site.path === SERVICE && site.within === 'confirmEnrollment';
    case 'restoreEnrollment':
      return site.path === SIDE_SERVICE && site.within === 'restore';
    case 'confirmEnrollment':
      return site.path === ENTRY || site.path === JOB;
  }
}

/** The Prisma keys whose object only reads; the nearest such key around a column makes it a read. */
const READ_KEYS = new Set([
  'where',
  'select',
  'include',
  'orderBy',
  'cursor',
  'distinct',
  'omit',
  'by',
  'having',
  '_count',
  '_min',
  '_max',
  '_sum',
  '_avg',
]);
/** The Prisma keys whose object writes. */
const WRITE_KEYS = new Set(['data', 'create', 'update']);
const STATUS_KEY = 'status';
const CONFIRMED = 'confirmed';
const CONFIRMED_AT_KEYS = new Set(['confirmedAt', 'confirmed_at']);

/** An `UPDATE` of, or an `INSERT INTO`, `enrollments`, then the statement up to its end. */
const ENROLLMENTS_WRITE =
  /\b(?:update|insert\s+into)\s+(?:"?public"?\s*\.\s*)?"?enrollments"?(?![\w"])[^;]*/gi;
/** A column of the two in that statement. */
const CONFIRMED_COLUMNS = /\b(?:status|confirmed_at)\b/i;

/** The repository-relative module a relative specifier lands on, with no extension or `/index`. */
function landing(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return joined.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '');
}

const CONFIRMER_SOURCES = new Set([BOOKING, SERVICE.replace(/\.ts$/, '')]);
/** The writers, by the module that defines each. */
const WRITERS: ReadonlyMap<string, Writer> = new Map([
  [REPOSITORY.replace(/\.ts$/, ''), 'markConfirmed'],
  [SIDE_REPOSITORY.replace(/\.ts$/, ''), 'restoreEnrollment'],
]);

/** A property's name when it can be read: plain, quoted or a computed string. */
function keyOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
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

/** Whether a value is `'confirmed'`: a string, a `.confirmed` member, or `{ set: … }` of either. */
function isConfirmedValue(expression: ts.Expression): boolean {
  const value = bare(expression);
  if (ts.isStringLiteralLike(value)) return value.text === CONFIRMED;
  if (ts.isPropertyAccessExpression(value)) return value.name.text === CONFIRMED;
  if (ts.isElementAccessExpression(value)) {
    const key = value.argumentExpression;
    return ts.isStringLiteralLike(key) && key.text === CONFIRMED;
  }
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        keyOf(property.name) === 'set' &&
        isConfirmedValue(property.initializer),
    );
  }
  return false;
}

/**
 * Whether the object holding a column reads: the nearest Prisma key around it, through nested
 * objects, arrays and the logical keys, is a read key. A write key, or no key at all, writes.
 */
function readsAt(object: ts.ObjectLiteralExpression): boolean {
  let node: ts.Node = object;
  while (node.parent !== undefined) {
    const parent = node.parent;
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
      const key = keyOf(parent.name);
      if (key !== null && READ_KEYS.has(key)) return true;
      if (key !== null && WRITE_KEYS.has(key)) return false;
    } else if (
      !ts.isObjectLiteralExpression(parent) &&
      !ts.isArrayLiteralExpression(parent) &&
      !ts.isParenthesizedExpression(parent) &&
      !ts.isAsExpression(parent) &&
      !ts.isSatisfiesExpression(parent)
    ) {
      return false;
    }
    node = parent;
  }
  return false;
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

/**
 * The SQL write sites of one text (a string, a template, or a migration's code), each with its
 * offset: an `UPDATE` of `enrollments` whose `SET` names a column of the two, or an `INSERT INTO`
 * it that names one anywhere (its column list, or an `ON CONFLICT … DO UPDATE`).
 */
function sqlWrites(text: string): { statement: string; offset: number }[] {
  return [...text.matchAll(ENROLLMENTS_WRITE)]
    .filter(([statement]) => {
      if (/^insert/i.test(statement)) return CONFIRMED_COLUMNS.test(statement);
      const set = /\bset\b([\s\S]*?)(?:\bwhere\b|\breturning\b|\bfrom\b|$)/i.exec(statement);
      return set !== null && CONFIRMED_COLUMNS.test(set[1] ?? '');
    })
    .map((match) => ({ statement: match[0].replace(/\s+/g, ' ').trim(), offset: match.index }));
}

/** A template's text with each substitution as `$n`. */
function templateText(template: ts.TemplateExpression): string {
  return [
    template.head.text,
    ...template.templateSpans.map((span, index) => `$${index + 1}${span.literal.text}`),
  ].join('');
}

/** The sites of one migration's SQL, comments left out. */
function migrationSites(file: PathFile): Site[] {
  // Comments blanked to spaces, so every offset keeps its line.
  const code = file.text
    .replace(/--[^\n]*/g, (comment) => ' '.repeat(comment.length))
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  return sqlWrites(code).map(({ statement, offset }) => ({
    kind: 'write' as const,
    path: file.path,
    line: code.slice(0, offset).split('\n').length,
    within: null,
    column: null,
    what: `SQL: ${statement}`,
  }));
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
  const site = (kind: SiteKind, node: ts.Node, what: string, column: Site['column'] = null) =>
    sites.push({
      kind,
      path: file.path,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      within: withinOf(node),
      column,
      what,
    });

  // The bindings this file holds of the three functions and of the modules that export them.
  const markers = new Map<string, Writer>();
  const markerSpaces = new Map<string, Writer>();
  const confirmerSpaces = new Set<string>();
  const sourceOf = (specifier: ts.Expression | undefined) =>
    specifier !== undefined && ts.isStringLiteralLike(specifier)
      ? landing(file.path, specifier.text)
      : null;

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const from = sourceOf(statement.moduleSpecifier);
      const bindings = statement.importClause?.namedBindings;
      if (from === null || bindings === undefined || statement.importClause?.isTypeOnly) continue;
      const confirmer = CONFIRMER_SOURCES.has(from);
      const writer = WRITERS.get(from);
      if (!confirmer && writer === undefined) continue;
      if (ts.isNamespaceImport(bindings)) {
        if (writer === undefined) confirmerSpaces.add(bindings.name.text);
        else markerSpaces.set(bindings.name.text, writer);
        continue;
      }
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        const imported = (element.propertyName ?? element.name).text;
        if (confirmer && imported === 'confirmEnrollment') {
          site('confirmEnrollment', element, `imports confirmEnrollment from ${from}`);
        }
        if (writer !== undefined && imported === writer) markers.set(element.name.text, writer);
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const from = sourceOf(statement.moduleSpecifier);
      if (from === null) continue;
      const exported = (name: string) =>
        statement.exportClause === undefined ||
        (ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.some(
            (element) => (element.propertyName ?? element.name).text === name,
          )) ||
        ts.isNamespaceExport(statement.exportClause);
      if (CONFIRMER_SOURCES.has(from) && exported('confirmEnrollment')) {
        site('confirmEnrollment', statement, `re-exports confirmEnrollment from ${from}`);
      }
      const writer = WRITERS.get(from);
      if (writer !== undefined && exported(writer)) {
        site(writer, statement, `re-exports ${writer} from ${from}`);
      }
    }
  }

  // A dynamic import or `require` of either module, traced to the name it is bound to where the
  // binding can be read (`const m = await import(…)`, or an element of `await Promise.all([…])`
  // destructured by position, as `main.ts` loads its modules); anything else is a site.
  const traced = new Set<ts.Node>();
  const loadedFrom = (node: ts.Node): string | null => {
    if (!ts.isCallExpression(node)) return null;
    const dynamic =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require');
    const from = dynamic ? sourceOf(node.arguments[0]) : null;
    return from !== null && (CONFIRMER_SOURCES.has(from) || WRITERS.has(from)) ? from : null;
  };
  const traceLoad = (call: ts.CallExpression, from: string): void => {
    const writer = WRITERS.get(from);
    const name = writer ?? 'confirmEnrollment';
    let binding: ts.BindingName | undefined;
    let value: ts.Node = call;
    let index: number | null = null;
    if (ts.isArrayLiteralExpression(call.parent)) {
      index = call.parent.elements.indexOf(call);
      value = call.parent.parent;
    }
    if (ts.isAwaitExpression(value.parent)) value = value.parent;
    const declaration = value.parent;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer === value) {
      binding = declaration.name;
      if (index !== null) {
        const element = ts.isArrayBindingPattern(binding) ? binding.elements[index] : undefined;
        binding = element !== undefined && ts.isBindingElement(element) ? element.name : undefined;
      }
    }
    if (binding === undefined) return;
    if (ts.isIdentifier(binding)) {
      if (writer === undefined) confirmerSpaces.add(binding.text);
      else markerSpaces.set(binding.text, writer);
      traced.add(call);
    } else if (ts.isObjectBindingPattern(binding)) {
      if (takesName(binding, name)) site(name, binding, `imports ${name} from ${from}`);
      traced.add(call);
    }
  };
  const findLoads = (node: ts.Node): void => {
    const from = loadedFrom(node);
    if (from !== null) traceLoad(node as ts.CallExpression, from);
    ts.forEachChild(node, findLoads);
  };
  ts.forEachChild(source, findLoads);

  // Inside the three defining files, a call of the function from the same file.
  const ownWriter: Writer | null =
    file.path === REPOSITORY
      ? 'markConfirmed'
      : file.path === SIDE_REPOSITORY
        ? 'restoreEnrollment'
        : null;
  const ownConfirmer = file.path === SERVICE;

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = keyOf(node.name);
      const object = node.parent;
      const writes =
        key !== null &&
        ts.isObjectLiteralExpression(object) &&
        ((key === STATUS_KEY &&
          ts.isPropertyAssignment(node) &&
          isConfirmedValue(node.initializer)) ||
          CONFIRMED_AT_KEYS.has(key));
      if (writes && !readsAt(object)) {
        const column = CONFIRMED_AT_KEYS.has(key) ? 'confirmed_at' : 'status';
        site('write', node, node.getText(source), column);
      }
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const text = ts.isTemplateExpression(node) ? templateText(node) : node.text;
      for (const { statement } of sqlWrites(text)) site('write', node, `SQL: ${statement}`);
    }
    const from = loadedFrom(node);
    if (from !== null && !traced.has(node)) {
      const name = WRITERS.get(from) ?? 'confirmEnrollment';
      site(name, node, `imports ${from} dynamically, bound where it cannot be traced`);
    }
    if (ts.isIdentifier(node) && isReference(node)) {
      const writer = markers.get(node.text) ?? (node.text === ownWriter ? ownWriter : undefined);
      if (writer !== undefined) site(writer, node, `calls ${writer}`);
      if (ownConfirmer && node.text === 'confirmEnrollment') {
        site('confirmEnrollment', node, 'calls confirmEnrollment inside its own file');
      }
      if (confirmerSpaces.has(node.text)) spaceUse(node, 'confirmEnrollment');
      const space = markerSpaces.get(node.text);
      if (space !== undefined) spaceUse(node, space);
    }
    ts.forEachChild(node, visit);
  };

  /** A use of a namespace that holds `name`: its member by dot or string key, or anything else. */
  const spaceUse = (node: ts.Identifier, name: Exclude<SiteKind, 'write'>) => {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      if (parent.name.text === name) site(name, parent, parent.getText(source));
      return;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      const key = parent.argumentExpression;
      if (!ts.isStringLiteralLike(key) || key.text === name) {
        site(name, parent, parent.getText(source));
      }
      return;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
      const pattern = parent.name;
      if (!ts.isObjectBindingPattern(pattern) || takesName(pattern, name)) {
        site(name, parent, parent.getText(source));
      }
      return;
    }
    site(name, parent, `hands the namespace on: ${parent.getText(source)}`);
  };

  ts.forEachChild(source, visit);
  return sites;
}

/** Whether destructuring takes `name`: by its key, by a key that cannot be read, or by a rest. */
function takesName(pattern: ts.ObjectBindingPattern, name: string): boolean {
  return pattern.elements.some((element) => {
    if (element.dotDotDotToken !== undefined) return true;
    const key = element.propertyName ?? element.name;
    if (ts.isObjectBindingPattern(key) || ts.isArrayBindingPattern(key)) return true;
    const read = keyOf(key);
    return read === null || read === name;
  });
}

/**
 * Whether an identifier reads a value: not a declared name, a property or member name, an import
 * or export specifier's name, or a name in a type.
 */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent) || ts.isTypeReferenceNode(parent)) {
    return false;
  }
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isBindingElement(parent)) return false;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent)
  ) {
    return parent.name !== node;
  }
  if (ts.isExportSpecifier(parent)) {
    // `export { x }` of a local binding reads it; `export { x } from '…'` names another module's.
    return (
      parent.parent.parent.moduleSpecifier === undefined &&
      (parent.propertyName ?? parent.name) === node
    );
  }
  return !(
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent)
  );
}

/** Every site of `files`, in the files' order and each file's. */
export function findSites(files: readonly PathFile[]): Site[] {
  return files.flatMap((file) =>
    file.path.endsWith('.sql') ? migrationSites(file) : sourceSites(file),
  );
}

/** The sites the confirmation path refuses. */
export function findViolations(files: readonly PathFile[]): Site[] {
  return findSites(files).filter((site) => !allowed(site));
}

// ---------------------------------------------------------------------------------------------
// The probes: each one a single file that breaks the path in one way, and the reads that do not.

const at = (relative: string, ...lines: string[]): PathFile => ({
  path: relative,
  text: lines.join('\n'),
});

const kindsOf = (files: readonly PathFile[]) =>
  findViolations(files).map(({ kind, what }) => `${kind}: ${what}`);

describe('the gate refuses every write of a confirmed enrollment outside markConfirmed', () => {
  const writes: readonly [string, PathFile][] = [
    [
      'an update of status by an admin action',
      at(
        'apps/api/src/modules/admin/enrollments.repository.ts',
        'export const force = (tx, id) =>',
        "  tx.enrollment.update({ where: { id }, data: { status: 'confirmed' } });",
      ),
    ],
    [
      'an updateMany of confirmedAt in another booking file',
      at(
        `${BOOKING}/holds.repository.ts`,
        'export async function stamp(tx, ids) {',
        '  await tx.enrollment.updateMany({ where: { id: { in: ids } }, data: { confirmedAt: new Date() } });',
        '}',
      ),
    ],
    [
      'an upsert creating it confirmed',
      at(
        'apps/api/src/modules/payments/upload.repository.ts',
        'export const upload = (tx, id, enrollment) =>',
        "  tx.enrollment.upsert({ where: { id }, create: { ...enrollment, status: 'confirmed' }, update: {} });",
      ),
    ],
    [
      'an upsert stamping confirmed_at on update, quoted',
      at(
        'apps/api/src/modules/payments/redirect.repository.ts',
        'export const back = (tx, id, enrollment) =>',
        "  tx.enrollment.upsert({ where: { id }, create: enrollment, update: { 'confirmed_at': new Date() } });",
      ),
    ],
    [
      'a create of a confirmed enrollment',
      at(
        `${BOOKING}/manual.repository.ts`,
        'export const create = (tx, row) =>',
        '  tx.enrollment.create({ data: { ...row, status: `confirmed` } });',
      ),
    ],
    [
      'a set operation',
      at(
        `${BOOKING}/toggle.repository.ts`,
        'export const toggle = (tx, id) =>',
        "  tx.enrollment.update({ where: { id }, data: { status: { set: 'confirmed' } } });",
      ),
    ],
    [
      'the generated enum',
      at(
        `${BOOKING}/enum.repository.ts`,
        "import { $Enums } from '@prisma/client';",
        'export const mark = (tx, id) =>',
        '  tx.enrollment.update({ where: { id }, data: { status: $Enums.EnrollmentStatus.confirmed } });',
      ),
    ],
    [
      'a literal kept as const',
      at(
        `${BOOKING}/const.repository.ts`,
        'export const mark = (tx, id) =>',
        "  tx.enrollment.update({ where: { id }, data: { status: ('confirmed' as const) } });",
      ),
    ],
    [
      'a nested write through a relation',
      at(
        'apps/api/src/modules/identity/teacher.repository.ts',
        'export const confirmAll = (tx, userId) =>',
        '  tx.user.update({',
        '    where: { id: userId },',
        "    data: { enrollments: { updateMany: { where: { status: 'pending_payment' }, data: { status: 'confirmed' } } } },",
        '  });',
      ),
    ],
    [
      'an object built aside and handed in',
      at(
        `${BOOKING}/aside.repository.ts`,
        "const confirmedFields = { status: 'confirmed' as const };",
        'export const mark = (tx, id) => tx.enrollment.update({ where: { id }, data: confirmedFields });',
      ),
    ],
    [
      'a shorthand confirmedAt',
      at(
        `${BOOKING}/shorthand.repository.ts`,
        'export const mark = (tx, id, confirmedAt) =>',
        '  tx.enrollment.update({ where: { id }, data: { confirmedAt } });',
      ),
    ],
    [
      'a computed key',
      at(
        `${BOOKING}/computed.repository.ts`,
        'export const mark = (tx, id) =>',
        "  tx.enrollment.update({ where: { id }, data: { ['confirmedAt']: new Date() } });",
      ),
    ],
    [
      'a second write inside the allowed file',
      at(
        REPOSITORY,
        'export async function markConfirmed(tx, enrollmentId, at) {',
        "  return tx.enrollment.updateMany({ where: { id: enrollmentId }, data: { status: 'confirmed', confirmedAt: at } });",
        '}',
        'export async function markPaidByHand(tx, enrollmentId, at) {',
        '  return tx.enrollment.update({ where: { id: enrollmentId }, data: { confirmedAt: at } });',
        '}',
      ),
    ],
    [
      'a confirmedAt written inside restoreEnrollment',
      at(
        SIDE_REPOSITORY,
        'export async function restoreEnrollment(tx, id, at) {',
        "  return tx.enrollment.updateMany({ where: { id, confirmedAt: { not: null } }, data: { status: 'confirmed', confirmedAt: at } });",
        '}',
      ),
    ],
    [
      'raw SQL inside restoreEnrollment',
      at(
        SIDE_REPOSITORY,
        'export async function restoreEnrollment(tx, id) {',
        "  return tx.$executeRaw`UPDATE enrollments SET status = 'confirmed' WHERE id = ${id}::uuid`;",
        '}',
      ),
    ],
    [
      'a third writer beside restoreEnrollment in its file',
      at(
        SIDE_REPOSITORY,
        'export async function restoreEnrollment(tx, id) {',
        "  return tx.enrollment.updateMany({ where: { id }, data: { status: 'confirmed', cancellationReason: null } });",
        '}',
        'export async function reopen(tx, id) {',
        "  return tx.enrollment.updateMany({ where: { id }, data: { status: 'confirmed' } });",
        '}',
      ),
    ],
    [
      'a third writer inside the side’s restore, not through restoreEnrollment',
      at(
        SIDE_SERVICE,
        'export function createEnrollmentSide() {',
        "  const restore = (tx, id) => tx.enrollment.updateMany({ where: { id }, data: { status: 'confirmed' } });",
        '  return { restore };',
        '}',
      ),
    ],
    [
      'raw SQL through $executeRaw',
      at(
        'apps/api/src/platform/db/enrollment-sql.ts',
        'export const force = (tx, id) =>',
        "  tx.$executeRaw`UPDATE enrollments SET status = 'confirmed' WHERE id = ${id}::uuid`;",
      ),
    ],
    [
      'raw SQL through an Unsafe string',
      at(
        'apps/api/src/platform/db/enrollment-unsafe.ts',
        'export const stamp = (tx) =>',
        '  tx.$executeRawUnsafe(\'update "enrollments" set "confirmed_at" = now()\');',
      ),
    ],
    [
      'raw SQL inserting the status',
      at(
        'scripts/dev/demo-enrollment.ts',
        'export const plant = (db, values) =>',
        '  db.$executeRaw`INSERT INTO public.enrollments (id, status) VALUES (${values.id}, ${values.status}::enrollment_status)`;',
      ),
    ],
    [
      'a migration confirming rows',
      at(
        'prisma/migrations/20990101000000_backfill/migration.sql',
        '-- a backfill',
        'ALTER TABLE "enrollments" ADD COLUMN "x" int;',
        'UPDATE "enrollments"\n  SET "status" = \'confirmed\'\n  WHERE "x" = 1;',
      ),
    ],
  ];

  it.each(writes)('%s', (_name, file) => {
    expect(findViolations([file]).filter(({ kind }) => kind === 'write')).not.toEqual([]);
  });

  it('counts both writes of an upsert creating and updating', () => {
    const file = at(
      'apps/api/src/modules/payments/both.repository.ts',
      'export const both = (tx, id, at) =>',
      "  tx.enrollment.upsert({ where: { id }, create: { status: 'confirmed' }, update: { confirmedAt: at } });",
    );
    expect(kindsOf([file])).toHaveLength(2);
  });

  it('leaves reads, comparisons, types and other columns alone', () => {
    const reads = at(
      `${BOOKING}/reads.repository.ts`,
      'export interface Row { readonly confirmedAt: Date | null; readonly status: string }',
      'export async function reads(tx, id) {',
      "  const one = await tx.enrollment.findFirst({ where: { status: 'confirmed', confirmedAt: { not: null } }, select: { confirmedAt: true } });",
      "  const many = await tx.enrollment.findMany({ where: { OR: [{ status: 'confirmed' }, { status: { in: ['confirmed'] } }] }, orderBy: { confirmedAt: 'desc' } });",
      "  const count = await tx.enrollment.count({ where: { NOT: { status: 'confirmed' } } });",
      "  const moved = await tx.enrollment.updateMany({ where: { id, status: 'confirmed' }, data: { status: 'completed' } });",
      "  await tx.enrollmentEvent.create({ data: { kind: 'confirmed', enrollmentId: id } });",
      "  await tx.$queryRaw`SELECT confirmed_at FROM enrollments WHERE status = 'confirmed'`;",
      "  return one?.status === 'confirmed' || many.length + count + moved.count > 0;",
      '}',
      "/** A comment that says UPDATE enrollments SET status = 'confirmed' is not code. */",
    );
    expect(findSites([reads])).toEqual([]);
  });
});

describe('the gate refuses every reach of markConfirmed and confirmEnrollment off the path', () => {
  const reaches: readonly [string, PathFile[]][] = [
    [
      'a router importing booking’s confirmEnrollment by name',
      [
        at(
          'apps/api/src/modules/payments/return.router.ts',
          "import { confirmEnrollment } from '../booking/index.js';",
          'export const back = (tx, input) => confirmEnrollment(tx, input);',
        ),
      ],
    ],
    [
      'an admin service through booking’s namespace',
      [
        at(
          'apps/api/src/modules/admin/override.service.ts',
          "import * as booking from '../booking/index.js';",
          'export const override = (tx, input) => booking.confirmEnrollment(tx, input);',
        ),
      ],
    ],
    [
      'a namespace member by a string key',
      [
        at(
          'apps/api/src/modules/moderation/settle.service.ts',
          "import * as booking from '../booking';",
          "export const settle = (tx, input) => booking['confirmEnrollment'](tx, input);",
        ),
      ],
    ],
    [
      'a namespace destructured',
      [
        at(
          'apps/api/src/modules/sessions/teacher-toggle.service.ts',
          "import * as booking from '../booking/index.js';",
          'const { confirmEnrollment: confirm } = booking;',
          'export const toggle = (tx, input) => confirm(tx, input);',
        ),
      ],
    ],
    [
      'a namespace handed on as a value',
      [
        at(
          'apps/api/src/surfaces/upload.ts',
          "import * as booking from '../modules/booking/index.js';",
          'export const steps = { ...booking };',
        ),
      ],
    ],
    [
      'a re-export by another module',
      [
        at(
          'apps/api/src/modules/payments/index.ts',
          "export { confirmEnrollment as confirmPaid } from '../booking/index.js';",
        ),
      ],
    ],
    [
      'export * of booking by another module',
      [at('apps/api/src/modules/admin/index.ts', "export * from '../booking/index.js';")],
    ],
    [
      'a dynamic import',
      [
        at(
          'apps/api/src/jobs/expire-pending-payments.ts',
          'export async function late(tx, input) {',
          "  const booking = await import('../modules/booking/index.js');",
          '  return booking.confirmEnrollment(tx, input);',
          '}',
        ),
      ],
    ],
    [
      'the composition root’s loaded booking, reaching confirmEnrollment',
      [
        at(
          'apps/api/src/main.ts',
          'const [{ createLogger }, booking] = await Promise.all([',
          "  import('./platform/logging/logger.js'),",
          "  import('./modules/booking/index.js'),",
          ']);',
          'export const services = { booking: booking.createBookingServices({}), paid: booking.confirmEnrollment };',
        ),
      ],
    ],
    [
      'a dynamic import destructured to confirmEnrollment',
      [
        at(
          'apps/api/src/surfaces/admin-actions.ts',
          "const { confirmEnrollment: confirm } = await import('../modules/booking/index.js');",
          'export const act = confirm;',
        ),
      ],
    ],
    [
      'a dynamic import bound where it cannot be traced',
      [
        at(
          'apps/api/src/surfaces/later.ts',
          "export const later = () => import('../modules/booking/index.js').then((m) => m);",
        ),
      ],
    ],
    [
      'a local export of an imported markConfirmed',
      [
        at(
          `${BOOKING}/rows.ts`,
          "import { markConfirmed } from './confirmation.repository.js';",
          'export { markConfirmed };',
        ),
      ],
    ],
    [
      'another booking file calling the service directly',
      [
        at(
          `${BOOKING}/pay.service.ts`,
          "import { confirmEnrollment } from './confirmation.service.js';",
          'export const pay = (tx, input) => confirmEnrollment(tx, input);',
        ),
      ],
    ],
    [
      'the service calling confirmEnrollment from another of its functions',
      [
        at(
          SERVICE,
          "import { markConfirmed } from './confirmation.repository.js';",
          'export async function confirmEnrollment(tx, { enrollmentId, at }) {',
          '  return markConfirmed(tx, enrollmentId, at);',
          '}',
          'export async function refuseEnrollment(tx, input) {',
          '  return confirmEnrollment(tx, input);',
          '}',
        ),
      ],
    ],
    [
      'the service calling markConfirmed from another function',
      [
        at(
          SERVICE,
          "import { markConfirmed } from './confirmation.repository.js';",
          'export async function confirmEnrollment(tx, { enrollmentId, at }) {',
          '  return markConfirmed(tx, enrollmentId, at);',
          '}',
          'export async function reholdEnrollment(tx, enrollmentId, at) {',
          '  return markConfirmed(tx, enrollmentId, at);',
          '}',
        ),
      ],
    ],
    [
      'another booking file importing markConfirmed',
      [
        at(
          `${BOOKING}/holds.service.ts`,
          "import * as rows from './confirmation.repository.js';",
          'export const release = (tx, id, at) => rows.markConfirmed(tx, id, at);',
        ),
      ],
    ],
    [
      'markConfirmed called inside its own file',
      [
        at(
          REPOSITORY,
          'export async function markConfirmed(tx, id, at) { return true; }',
          'export async function markRefused(tx, id, at) { return markConfirmed(tx, id, at); }',
        ),
      ],
    ],
    [
      'another booking file importing restoreEnrollment',
      [
        at(
          `${BOOKING}/holds.service.ts`,
          "import { restoreEnrollment } from './enrollment-side.repository.js';",
          'export const back = (tx, id) => restoreEnrollment(tx, id);',
        ),
      ],
    ],
    [
      'the side’s service reaching restoreEnrollment outside restore',
      [
        at(
          SIDE_SERVICE,
          "import { restoreEnrollment } from './enrollment-side.repository.js';",
          'export function createEnrollmentSide() {',
          '  const restore = (tx, id) => restoreEnrollment(tx, id);',
          '  const complete = (tx, id) => restoreEnrollment(tx, id);',
          '  return { restore, complete };',
          '}',
        ),
      ],
    ],
    [
      'the side’s default store holding restoreEnrollment',
      [
        at(
          SIDE_SERVICE,
          "import { moveEnrollment, restoreEnrollment } from './enrollment-side.repository.js';",
          'export const enrollmentSideStore = { moveEnrollment, restoreEnrollment };',
        ),
      ],
    ],
    [
      'restoreEnrollment through the repository’s namespace',
      [
        at(
          'apps/api/src/modules/admin/undo.service.ts',
          "import * as side from '../booking/enrollment-side.repository.js';",
          'export const undo = (tx, id) => side.restoreEnrollment(tx, id);',
        ),
      ],
    ],
    [
      'a re-export of restoreEnrollment by booking’s entry',
      [at(ENTRY, "export { restoreEnrollment } from './enrollment-side.repository.js';")],
    ],
    [
      'restoreEnrollment called inside its own file',
      [
        at(
          SIDE_REPOSITORY,
          'export async function restoreEnrollment(tx, id) { return true; }',
          'export async function reinstate(tx, id) { return restoreEnrollment(tx, id); }',
        ),
      ],
    ],
  ];

  it.each(reaches)('%s', (_name, files) => {
    expect(findViolations(files).filter(({ kind }) => kind !== 'write')).not.toEqual([]);
  });

  it('allows the path itself, and the job’s own export of the same name', () => {
    const path = [
      at(
        REPOSITORY,
        'export async function markConfirmed(tx, enrollmentId, at) {',
        "  const { count } = await tx.enrollment.updateMany({ where: { id: enrollmentId, status: { in: ['pending_payment', 'cancelled'] } }, data: { status: 'confirmed', confirmedAt: at, cancellationReason: null } });",
        '  return count === 1;',
        '}',
      ),
      at(
        SERVICE,
        "import { markConfirmed } from './confirmation.repository.js';",
        'export async function confirmEnrollment(tx, { enrollmentId, at }) {',
        '  return markConfirmed(tx, enrollmentId, at);',
        '}',
      ),
      at(ENTRY, "export { confirmEnrollment, refuseEnrollment } from './confirmation.service.js';"),
      at(
        JOB,
        "import * as booking from '../modules/booking/index.js';",
        'export const steps = { confirm: booking.confirmEnrollment, terms: booking.readHoldTerms };',
        'export function confirmEnrollment(options) { return options; }',
      ),
      at(
        'apps/api/src/worker.ts',
        "import { confirmEnrollment } from './jobs/confirm-enrollment.js';",
        "import { releaseHolds } from './modules/booking/index.js';",
        'export const jobs = [confirmEnrollment({}), releaseHolds];',
      ),
      at(
        'apps/api/src/main.ts',
        'const [{ createLogger }, booking, { CONFIRM_ENROLLMENT }] = await Promise.all([',
        "  import('./platform/logging/logger.js'),",
        "  import('./modules/booking/index.js'),",
        "  import('./jobs/confirm-enrollment.js'),",
        ']);',
        'export const services = { booking: booking.createBookingServices({}), use: booking.createCatalogUse({}) };',
        'export const name: typeof booking.CONFIRMED_NAME = CONFIRM_ENROLLMENT;',
      ),
      at(
        SIDE_REPOSITORY,
        'export async function moveEnrollment(tx, id, target) {',
        "  const { count } = await tx.enrollment.updateMany({ where: { id, status: 'confirmed' }, data: { status: target.status, cancellationReason: target.cancellationReason } });",
        '  return count === 1;',
        '}',
        'export async function restoreEnrollment(tx, id) {',
        "  const { count } = await tx.enrollment.updateMany({ where: { id, confirmedAt: { not: null }, OR: [{ status: 'terminated_no_show' }, { status: 'cancelled', cancellationReason: 'admin' }] }, data: { status: 'confirmed', cancellationReason: null } });",
        '  return count === 1;',
        '}',
      ),
      at(
        SIDE_SERVICE,
        "import { moveEnrollment, restoreEnrollment } from './enrollment-side.repository.js';",
        'export const enrollmentSideStore = { moveEnrollment };',
        'export function createEnrollmentSide({ store = enrollmentSideStore }) {',
        '  const restore = async (tx, id) => restoreEnrollment(tx, id);',
        '  return { restore, complete: (tx, id) => store.moveEnrollment(tx, id, { status: "completed" }) };',
        '}',
      ),
    ];
    expect(findViolations(path)).toEqual([]);
    expect(findSites(path).map(({ kind, path: where }) => `${kind} ${where}`)).toEqual([
      `write ${REPOSITORY}`,
      `write ${REPOSITORY}`,
      `markConfirmed ${SERVICE}`,
      `confirmEnrollment ${ENTRY}`,
      `confirmEnrollment ${JOB}`,
      `write ${SIDE_REPOSITORY}`,
      `restoreEnrollment ${SIDE_SERVICE}`,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The repository as it is.

/** The folders and files the gate reads (this file's head). */
const ROOTS = ['apps/api/src', 'packages', 'scripts', 'prisma/seed.ts', 'prisma/migrations'];
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo']);

function isRead(relative: string): boolean {
  if (relative.endsWith('.sql')) return relative.startsWith('prisma/migrations/');
  if (!/\.(ts|tsx|mts|cts)$/.test(relative) || relative.endsWith('.d.ts')) return false;
  if (/\.(spec|test)\.(ts|tsx|mts|cts)$/.test(relative)) return false;
  return !relative.startsWith('packages/') || relative.split('/')[2] === 'src';
}

function filesUnder(relative: string): PathFile[] {
  const absolute = path.join(root, relative);
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : filesUnder(child);
    return isRead(child)
      ? [{ path: child, text: readFileSync(path.join(root, child), 'utf8') }]
      : [];
  });
}

function repositoryFiles(): PathFile[] {
  return ROOTS.flatMap((relative) =>
    relative.endsWith('.ts')
      ? [{ path: relative, text: readFileSync(path.join(root, relative), 'utf8') }]
      : filesUnder(relative),
  );
}

describe('the repository’s confirmation path (R-HONEST-1, FR-366, SC-307)', () => {
  const files = repositoryFiles();

  it('reads the API, the packages, the scripts, the seed and the migrations', () => {
    const read = new Set(files.map(({ path: where }) => where));
    for (const expected of [
      REPOSITORY,
      SERVICE,
      ENTRY,
      JOB,
      SIDE_REPOSITORY,
      SIDE_SERVICE,
      'prisma/seed.ts',
    ]) {
      expect(read).toContain(expected);
    }
    expect([...read].some((where) => where.endsWith('.sql'))).toBe(true);
    expect([...read].some((where) => where.startsWith('packages/money/src/'))).toBe(true);
    expect([...read].some((where) => where.endsWith('.spec.ts'))).toBe(false);
  });

  it('has no write of a confirmed enrollment, and no reach of its writer, off the path', () => {
    expect(findViolations(files)).toEqual([]);
  });

  it('has exactly the path: markConfirmed writes, confirmEnrollment calls it, the job calls that; restoreEnrollment writes the status, restore calls it', () => {
    expect(
      findSites(files)
        .map(({ kind, path: where, within }) => `${kind} ${where} ${within ?? '-'}`)
        .sort(),
    ).toEqual(
      [
        `write ${REPOSITORY} markConfirmed`,
        `write ${REPOSITORY} markConfirmed`,
        `markConfirmed ${SERVICE} confirmEnrollment`,
        `confirmEnrollment ${ENTRY} -`,
        // 005:T016 (rule d): the job's one reach, inside the steps' builder that hands booking the pushes' port.
        `confirmEnrollment ${JOB} confirmationStepsOf`,
        `write ${SIDE_REPOSITORY} restoreEnrollment`,
        `restoreEnrollment ${SIDE_SERVICE} restore`,
      ].sort(),
    );
  });
});
