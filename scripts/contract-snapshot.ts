// T084: the contract snapshot (FR-063, R-API-9, research R-12). The clients in the field are always
// older than the server, so a published procedure, field or enum value is never removed or renamed.
// This file records what is published and fails a change that takes any of it away or changes it.
//
//   pnpm contract:snapshot                       writes packages/contracts/contract-snapshot.json
//   pnpm contract:snapshot --check --base <ref>  compares the head with the snapshot committed on
//                                                <ref>; exits 1 naming R-API-9 on any break
//
// Both run tsx with `--conditions=@ijazah/source` (package.json), as the worker's dev script and
// Vitest do: the routers import `@ijazah/contracts` and `@ijazah/time` at runtime, whose default
// export condition is the built `dist/`, and the pipeline's stage 3 builds nothing (PR #80). The
// same holds for `pnpm check:generated`, which regenerates the snapshot in this process.
//
// WHAT IS RECORDED (owner's decisions 1 and 2, 2026-10-10). For both surfaces (`app.router.ts` and
// `admin.router.ts` in apps/api/src/surfaces), every procedure path with its kind (and, on the user
// surface, its caller kind from the meta, T028), and the fields of
// its input and output: every field path, nested (`$.slot.dayOfWeek`, `$.notes[]`, a record's
// values as `$.meta.*`), with its JSON type, for an enum field its values, and `required` for an
// object property its parent's JSON Schema lists as required. Fields are read
// through each parser's Standard JSON Schema interface (`~standard.jsonSchema`), which Zod 4
// implements by calling its own `z.toJSONSchema`, so no Zod import and no dependency is needed
// here. A parser that cannot describe itself is refused, never recorded as having no field, and so
// is a procedure with no output parser (T169): an output inferred from the handler exists only for
// the compiler, and every caller kind takes `{ input, output }`. Then every enum member: the Prisma enums, read from
// the generated client's `$Enums` (Prisma's own reading of `prisma/schema/base.prisma`, so a comment
// or an attribute cannot be misread; it needs `pnpm db:generate`, which every pipeline stage already
// runs), and every enum `packages/contracts` exports, read as a schema whose JSON Schema is an enum.
//
// WHAT FAILS (owner's decision 4). The snapshot committed on the BASE branch, read with
// `git show <ref>:<path>`, against the snapshot generated from the head — never against the file in
// the change itself, so regenerating it in the same change cannot hide a removal (the precedent is
// `buf breaking --against '.git#branch=main'`). An entry the base has and the head lacks fails: a
// procedure on its surface, a field of its input or output, a value of an enum field, a member of
// an enum. A rename is the removal of the old name. A change fails too, because an old client breaks
// on it exactly as on a removal (owner's decision, 2026-10-10), each listed with before → after:
// a procedure's kind; a field's recorded type text, compared exactly, so even a widening such as
// `string` → `null|string` fails (the conservative side); an enum field no longer limited to its
// values; an input field that becomes required, or a new required input field whose parent was
// already published (an old client does not send it); an output field that stops being required (an
// old client relies on it). The safe directions pass: an input field that becomes optional, an
// output field that becomes required, a new optional field, a new procedure, a new enum value or
// member. A base with no snapshot yet passes and says so. The deprecate-then-remove path R-API-9
// allows is not built: it waits for the first deprecation.
//
// THE FILE (owner's decision 3). Keys and members in code-point order, then formatted by Prettier
// with the repository's configuration, so the same contract always gives the same bytes and
// Prettier leaves them alone.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import * as prettier from 'prettier';

/** The committed snapshot, relative to the repository root. */
export const SNAPSHOT_PATH = 'packages/contracts/contract-snapshot.json';

const repositoryRoot = join(__dirname, '..');

export type Surface = 'admin' | 'app';
const SURFACES: readonly Surface[] = ['admin', 'app'];
const DIRECTIONS = ['input', 'output'] as const;
type Direction = (typeof DIRECTIONS)[number];

/**
 * One field of an input or output: its JSON type, the values it is limited to, if any, and whether
 * it is a property its parent object requires.
 */
export interface FieldEntry {
  readonly type: string;
  readonly values?: readonly string[];
  readonly required?: true;
}

/** Field path (`$` is the whole input or output) to field. */
export type Fields = Readonly<Record<string, FieldEntry>>;

export interface ProcedureEntry {
  readonly kind: string;
  /**
   * The user surface's caller kind (`public`, `user`, `student`, `teacher`) from the procedure's
   * meta, read by the R-MOBILE-13 gate (T028). Recorded, never compared: a base written before it
   * was recorded passes, and the gate, not this file, judges what a kind requires.
   */
  readonly caller?: string;
  readonly input: Fields;
  readonly output: Fields;
}

type EnumMembers = Readonly<Record<string, readonly string[]>>;

export interface ContractSnapshot {
  readonly enums: { readonly contracts: EnumMembers; readonly prisma: EnumMembers };
  readonly procedures: Readonly<Record<Surface, Readonly<Record<string, ProcedureEntry>>>>;
}

/** A tRPC router as this file reads it: its flattened procedures, keyed by path. */
export interface RouterLike {
  readonly _def: { readonly procedures: object };
}

export interface SnapshotSources {
  readonly routers: Readonly<Record<Surface, RouterLike>>;
  /** The generated client's `$Enums`: enum name to `{ member: value }`. */
  readonly prismaEnums: object;
  /** The exports of `packages/contracts`. */
  readonly contracts: object;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(byCodePoint);
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([a], [b]) => byCodePoint(a, b)));
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * One field read twice on a path (two union members, two input parsers): both readings kept, and
 * required when either reading requires it. Base and head are read the same way, so a change still
 * shows.
 */
function mergeField(
  known: FieldEntry | undefined,
  types: readonly string[],
  values: readonly string[],
  required: boolean,
): FieldEntry {
  const type = sortedUnique([...types, ...(known?.type.split('|') ?? [])]).join('|');
  const merged = sortedUnique([...values, ...(known?.values ?? [])]);
  return {
    type,
    ...(merged.length === 0 ? {} : { values: merged }),
    ...(required || known?.required === true ? { required: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the contract
// ---------------------------------------------------------------------------------------------

/** The JSON Schema a parser publishes for one direction, through Standard JSON Schema. */
function jsonSchemaOf(parser: unknown, direction: Direction, where: string): JsonObject {
  const standard =
    isObject(parser) || typeof parser === 'function' ? Reflect.get(parser, '~standard') : undefined;
  const converter = isObject(standard) ? standard['jsonSchema'] : undefined;
  const convert = isObject(converter) ? converter[direction] : undefined;
  if (typeof convert !== 'function') {
    throw new Error(
      `contract snapshot: the ${direction} parser of ${where} does not describe itself as JSON Schema, so its fields cannot be recorded (R-API-9)`,
    );
  }
  // `unrepresentable: 'any'` is Zod's option: a type JSON Schema cannot state (a date, `void`) is
  // read as having no type instead of throwing. Other libraries ignore an option they do not know.
  const schema: unknown = Reflect.apply(convert, converter, [
    { target: 'draft-2020-12', libraryOptions: { unrepresentable: 'any' } },
  ]);
  if (!isObject(schema)) {
    throw new Error(`contract snapshot: the ${direction} parser of ${where} gave no JSON Schema`);
  }
  return schema;
}

/** The fields of one JSON Schema, by path, read from `root` down. */
function fieldsOf(root: JsonObject): Map<string, FieldEntry> {
  const fields = new Map<string, FieldEntry>();

  const resolve = (node: JsonObject, seen: readonly string[]): [JsonObject, readonly string[]] => {
    const ref = node['$ref'];
    if (typeof ref !== 'string') return [node, seen];
    if (seen.includes(ref)) return [{ type: 'recursive' }, seen];
    let target: unknown = root;
    if (ref !== '#') {
      for (const step of ref.replace(/^#\//, '').split('/')) {
        target = isObject(target)
          ? target[step.replace(/~1/g, '/').replace(/~0/g, '~')]
          : undefined;
      }
    }
    if (!isObject(target))
      throw new Error(`contract snapshot: unresolved JSON Schema reference ${ref}`);
    return resolve(target, [...seen, ref]);
  };

  const membersOf = (node: JsonObject): JsonObject[] =>
    ['anyOf', 'oneOf', 'allOf'].flatMap((key) => {
      const members = node[key];
      return Array.isArray(members) ? members.filter(isObject) : [];
    });

  const typeOf = (node: JsonObject, seen: readonly string[]): string[] => {
    const [schema, path] = resolve(node, seen);
    const declared = schema['type'];
    if (typeof declared === 'string') return [declared];
    if (Array.isArray(declared)) return declared.map(textOf);
    const members = membersOf(schema);
    if (members.length > 0) return members.flatMap((member) => typeOf(member, path));
    return ['unknown'];
  };

  const valuesOf = (node: JsonObject, seen: readonly string[]): string[] => {
    const [schema, path] = resolve(node, seen);
    const listed = schema['enum'];
    if (Array.isArray(listed)) return listed.map(textOf);
    if ('const' in schema) return [textOf(schema['const'])];
    return membersOf(schema).flatMap((member) => valuesOf(member, path));
  };

  const record = (path: string, node: JsonObject, seen: readonly string[], required: boolean) => {
    fields.set(
      path,
      mergeField(fields.get(path), typeOf(node, seen), valuesOf(node, seen), required),
    );
  };

  const descend = (node: JsonObject, path: string, seen: readonly string[]): void => {
    // A reference already followed on this path resolves to `recursive`, which has no children.
    const [schema, inner] = resolve(node, seen);
    const properties = schema['properties'];
    const listed = schema['required'];
    const required = new Set(Array.isArray(listed) ? listed.map(textOf) : []);
    if (isObject(properties)) {
      for (const [key, property] of Object.entries(properties)) {
        if (isObject(property)) visit(property, `${path}.${key}`, inner, required.has(key));
      }
    }
    const items = schema['items'];
    if (isObject(items)) visit(items, `${path}[]`, inner, false);
    const prefixItems = schema['prefixItems'];
    if (Array.isArray(prefixItems)) {
      prefixItems.forEach((item, index) => {
        if (isObject(item)) visit(item, `${path}[${index}]`, inner, false);
      });
    }
    const additional = schema['additionalProperties'];
    if (isObject(additional)) visit(additional, `${path}.*`, inner, false);
    for (const member of membersOf(schema)) descend(member, path, inner);
  };

  const visit = (node: JsonObject, path: string, seen: readonly string[], required: boolean) => {
    record(path, node, seen, required);
    descend(node, path, seen);
  };

  visit(root, '$', [], false);
  return fields;
}

function fieldsOfParsers(parsers: readonly unknown[], direction: Direction, where: string): Fields {
  const merged = new Map<string, FieldEntry>();
  for (const parser of parsers) {
    for (const [path, field] of fieldsOf(jsonSchemaOf(parser, direction, where))) {
      merged.set(
        path,
        mergeField(
          merged.get(path),
          field.type.split('|'),
          field.values ?? [],
          field.required === true,
        ),
      );
    }
  }
  return sortedRecord(merged);
}

function proceduresOf(router: RouterLike, surface: Surface): Record<string, ProcedureEntry> {
  const entries: [string, ProcedureEntry][] = [];
  for (const [path, procedure] of Object.entries(router._def.procedures)) {
    const where = `${surface} ${path}`;
    const definition: unknown =
      isObject(procedure) || typeof procedure === 'function'
        ? Reflect.get(procedure, '_def')
        : undefined;
    const kind = isObject(definition) ? definition['type'] : undefined;
    const inputs = isObject(definition) ? definition['inputs'] : undefined;
    if (typeof kind !== 'string' || !Array.isArray(inputs) || !isObject(definition)) {
      throw new Error(`contract snapshot: ${where} is not a tRPC procedure this file can read`);
    }
    const output = definition['output'];
    // An output inferred from the handler exists only for the compiler, so a procedure without an
    // output parser would publish nothing this file can hold a removal against (T169, R-API-9).
    if (output === undefined) {
      throw new Error(
        `contract snapshot: ${where} has no output parser, so nothing it returns can be recorded; every caller kind takes \`{ input, output }\` (R-API-9, T169)`,
      );
    }
    const meta = definition['meta'];
    const caller =
      isObject(meta) && typeof meta['caller'] === 'string' ? meta['caller'] : undefined;
    entries.push([
      path,
      {
        ...(caller === undefined ? {} : { caller }),
        kind,
        input: fieldsOfParsers(inputs, 'input', where),
        output: fieldsOfParsers([output], 'output', where),
      },
    ]);
  }
  return sortedRecord(entries);
}

function prismaEnumsOf(enums: object): Record<string, string[]> {
  return sortedRecord(
    Object.entries(enums).map(([name, members]: [string, unknown]): [string, string[]] => {
      if (!isObject(members))
        throw new Error(`contract snapshot: Prisma enum ${name} has no members`);
      return [name, sortedUnique(Object.values(members).map(textOf))];
    }),
  );
}

/** The exports of packages/contracts that are enums: schemas whose JSON Schema lists the values. */
function contractEnumsOf(exports: object): Record<string, string[]> {
  const entries: [string, string[]][] = [];
  for (const [name, value] of Object.entries(exports)) {
    const standard = isObject(value) ? value['~standard'] : undefined;
    if (!isObject(standard) || !isObject(standard['jsonSchema'])) continue;
    const listed = jsonSchemaOf(value, 'input', `packages/contracts ${name}`)['enum'];
    if (Array.isArray(listed)) entries.push([name, sortedUnique(listed.map(textOf))]);
  }
  return sortedRecord(entries);
}

/** The contract the sources publish, in canonical order. */
export function snapshotOf(sources: SnapshotSources): ContractSnapshot {
  return {
    enums: {
      contracts: contractEnumsOf(sources.contracts),
      prisma: prismaEnumsOf(sources.prismaEnums),
    },
    procedures: {
      admin: proceduresOf(sources.routers.admin, 'admin'),
      app: proceduresOf(sources.routers.app, 'app'),
    },
  };
}

/** The real sources: both surfaces, the generated Prisma client's enums and packages/contracts. */
export async function loadSources(): Promise<SnapshotSources> {
  const [{ appRouter }, { adminRouter }, { $Enums }, contracts] = await Promise.all([
    import('../apps/api/src/surfaces/app.router.js'),
    import('../apps/api/src/surfaces/admin.router.js'),
    import('@prisma/client'),
    import('../packages/contracts/src/index.js'),
  ]);
  return { routers: { admin: adminRouter, app: appRouter }, prismaEnums: $Enums, contracts };
}

// ---------------------------------------------------------------------------------------------
// The committed file
// ---------------------------------------------------------------------------------------------

/** The snapshot as committed: canonical order, Prettier's formatting, a final newline. */
export async function serializeSnapshot(snapshot: ContractSnapshot): Promise<string> {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return sortedUnique(value.map(textOf));
    if (!isObject(value)) return value;
    return sortedRecord(Object.entries(value).map(([key, inner]) => [key, canonical(inner)]));
  };
  const filepath = join(repositoryRoot, SNAPSHOT_PATH);
  const options = await prettier.resolveConfig(filepath);
  return prettier.format(JSON.stringify(canonical(snapshot)), { ...options, filepath });
}

function fail(where: string, expected: string): never {
  throw new Error(`contract snapshot: ${where} is not ${expected}`);
}

function stringsAt(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    fail(where, 'a list of strings');
  }
  return value;
}

function recordAt(value: unknown, where: string): JsonObject {
  return isObject(value) ? value : fail(where, 'an object');
}

function fieldsAt(value: unknown, where: string): Fields {
  return Object.fromEntries(
    Object.entries(recordAt(value, where)).map(([path, field]): [string, FieldEntry] => {
      const entry = recordAt(field, `${where} ${path}`);
      const type = entry['type'];
      if (typeof type !== 'string') fail(`${where} ${path} type`, 'a string');
      const required = entry['required'];
      if (required !== undefined && required !== true) fail(`${where} ${path} required`, 'true');
      return [
        path,
        {
          type,
          ...(entry['values'] === undefined
            ? {}
            : { values: stringsAt(entry['values'], `${where} ${path} values`) }),
          ...(required === true ? { required } : {}),
        },
      ];
    }),
  );
}

/** Reads a committed snapshot back, refusing one whose shape is not this file's. */
export function parseSnapshot(text: string): ContractSnapshot {
  const document = recordAt(JSON.parse(text), 'the snapshot');
  const enums = recordAt(document['enums'], 'enums');
  const procedures = recordAt(document['procedures'], 'procedures');
  const enumsAt = (source: string): EnumMembers =>
    Object.fromEntries(
      Object.entries(recordAt(enums[source], `enums.${source}`)).map(([name, members]) => [
        name,
        stringsAt(members, `enums.${source}.${name}`),
      ]),
    );
  const surfaceAt = (surface: Surface): Record<string, ProcedureEntry> =>
    Object.fromEntries(
      Object.entries(recordAt(procedures[surface], `procedures.${surface}`)).map(
        ([path, value]): [string, ProcedureEntry] => {
          const where = `procedures.${surface}.${path}`;
          const entry = recordAt(value, where);
          const kind = entry['kind'];
          if (typeof kind !== 'string') fail(`${where} kind`, 'a string');
          const caller = entry['caller'];
          if (caller !== undefined && typeof caller !== 'string')
            fail(`${where} caller`, 'a string');
          return [
            path,
            {
              ...(caller === undefined ? {} : { caller }),
              kind,
              input: fieldsAt(entry['input'], `${where} input`),
              output: fieldsAt(entry['output'], `${where} output`),
            },
          ];
        },
      ),
    );
  return {
    enums: { contracts: enumsAt('contracts'), prisma: enumsAt('prisma') },
    procedures: { admin: surfaceAt('admin'), app: surfaceAt('app') },
  };
}

// ---------------------------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------------------------

/** The path a field belongs to: `$.slot` for `$.slot.dayOfWeek`, `$` for `$.packageId`. */
function parentOf(field: string): string {
  return field.slice(0, Math.max(field.lastIndexOf('.'), 1));
}

/** The breaks of one field an old client reads (output) or sends (input), one line each. */
function fieldBreaks(
  direction: Direction,
  where: string,
  field: string,
  before: FieldEntry,
  after: FieldEntry,
): string[] {
  const breaks: string[] = [];
  const at = `${direction} ${where}  ${field}`;
  if (before.type !== after.type) breaks.push(`${at}  type ${before.type} → ${after.type}`);
  if (before.values !== undefined && after.values === undefined) {
    breaks.push(`${at}  values ${before.values.join(', ')} → any`);
  }
  for (const value of before.values ?? []) {
    if (after.values?.includes(value) === false) breaks.push(`${at}  value ${value} removed`);
  }
  const wasRequired = before.required === true;
  const isRequired = after.required === true;
  if (direction === 'input' && !wasRequired && isRequired) {
    breaks.push(`${at}  optional → required`);
  }
  if (direction === 'output' && wasRequired && !isRequired) {
    breaks.push(`${at}  required → optional`);
  }
  return breaks;
}

/**
 * Every entry `base` publishes that `head` removes, renames or changes in a way an old client
 * breaks on, one line each, with before → after where something changed.
 */
export function findRemovals(base: ContractSnapshot, head: ContractSnapshot): string[] {
  const removals: string[] = [];
  for (const surface of SURFACES) {
    for (const [path, procedure] of Object.entries(base.procedures[surface])) {
      const now = head.procedures[surface][path];
      if (now === undefined) {
        removals.push(`procedure  ${surface}  ${path} (${procedure.kind})`);
        continue;
      }
      if (now.kind !== procedure.kind) {
        removals.push(`kind  ${surface}  ${path}  ${procedure.kind} → ${now.kind}`);
      }
      const where = ` ${surface}  ${path}`;
      for (const direction of DIRECTIONS) {
        for (const [field, entry] of Object.entries(procedure[direction])) {
          const current = now[direction][field];
          if (current === undefined) {
            removals.push(`${direction} field ${where}  ${field}`);
            continue;
          }
          removals.push(...fieldBreaks(direction, where, field, entry, current));
        }
      }
      // A new required input field under a published parent: an old client does not send it.
      for (const [field, entry] of Object.entries(now.input)) {
        if (
          entry.required === true &&
          procedure.input[field] === undefined &&
          procedure.input[parentOf(field)] !== undefined
        ) {
          removals.push(`input ${where}  ${field}  absent → required`);
        }
      }
    }
  }
  for (const source of ['prisma', 'contracts'] as const) {
    for (const [name, members] of Object.entries(base.enums[source])) {
      const now = head.enums[source][name] ?? [];
      for (const member of members) {
        if (!now.includes(member)) removals.push(`enum member  ${source}  ${name}  ${member}`);
      }
    }
  }
  return removals;
}

function git(
  cwd: string,
  args: readonly string[],
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Compares `head` with the snapshot committed at `ref` (a branch, a commit or a tree). Throws when
 * git does not know `ref`; a base with no snapshot yet passes with a message saying so.
 */
export function compareWithBase(options: {
  readonly head: ContractSnapshot;
  readonly ref: string;
  readonly cwd: string;
}): { ok: boolean; message: string } {
  const { head, ref, cwd } = options;
  if (!git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{tree}`]).ok) {
    throw new Error(
      `contract snapshot: git does not know the base ${ref}; fetch it before comparing`,
    );
  }
  const located = `${ref}:${SNAPSHOT_PATH}`;
  if (!git(cwd, ['cat-file', '-e', located]).ok) {
    return {
      ok: true,
      message: `contract snapshot: ${ref} holds no contract snapshot at ${SNAPSHOT_PATH} yet, so nothing it published can have been removed or changed`,
    };
  }
  const shown = git(cwd, ['show', located]);
  if (!shown.ok)
    throw new Error(`contract snapshot: could not read ${located}: ${shown.stderr.trim()}`);
  const removals = findRemovals(parseSnapshot(shown.stdout), head);
  if (removals.length === 0) return { ok: true, message: '' };
  return {
    ok: false,
    message: [
      `contract snapshot: ${removals.length} entr${removals.length === 1 ? 'y' : 'ies'} published on ${ref} are removed or changed in a way an old client breaks on (R-API-9: never remove or rename a tRPC procedure, field or enum value; additive only, deprecate and then remove after the minimum client version passes it). A rename is the removal of the old name; a change shows before → after:`,
      ...removals.map((removal) => `  ${removal}`),
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

/** The snapshot the current code publishes, serialized as it is committed. */
export async function currentSnapshotText(): Promise<string> {
  return serializeSnapshot(snapshotOf(await loadSources()));
}

async function main(argv: readonly string[]): Promise<number> {
  let values: { check?: boolean; base?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { check: { type: 'boolean' }, base: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error: unknown) {
    process.stderr.write(
      `contract snapshot: ${error instanceof Error ? error.message : 'bad arguments'}\n`,
    );
    return 2;
  }
  if (values.check !== true) {
    if (values.base !== undefined) {
      process.stderr.write('contract snapshot: --base is read only with --check\n');
      return 2;
    }
    const text = await currentSnapshotText();
    writeFileSync(join(repositoryRoot, SNAPSHOT_PATH), text);
    process.stdout.write(`contract snapshot: wrote ${SNAPSHOT_PATH}\n`);
    return 0;
  }
  if (values.base === undefined || values.base === '') {
    process.stderr.write(
      'contract snapshot: --check needs --base <git ref>, the branch the change targets\n',
    );
    return 2;
  }
  const head = snapshotOf(await loadSources());
  const { ok, message } = compareWithBase({ head, ref: values.base, cwd: repositoryRoot });
  if (message !== '') (ok ? process.stdout : process.stderr).write(`${message}\n`);
  return ok ? 0 : 1;
}

// Run as a command (`pnpm contract:snapshot`, tsx), never when a test imports this file. tsx
// compiles it as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'contract-snapshot.ts') {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
