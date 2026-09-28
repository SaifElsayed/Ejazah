// api/table-ownership  ->  R-API-6  (typeAware)
//
// R-API-6: never touch another module's tables; the owning module's repository is the only access
// path (FR-005, ADR 0005 D2). The ownership is data, not prose: `packages/config/module-tables.json`
// (T016) assigns each of the ERD's tables to exactly one of the twelve modules or to the platform
// kernel. A query target cannot be read from syntax — `tx.review.findMany()` names no table and the
// client may arrive as a parameter — so this rule asks the program what each member access is
// (research R-10, R-11) and compares the table behind it with the module the file lives in.
//
// DECISION (T047) — what a table access is. A member access `<client>.<delegate>` where the
// `<delegate>` property is declared on the database client itself: a class or interface named
// `PrismaClient` whose declaration sits inside the `@prisma/client` module — an ambient
// `declare module '@prisma/client'` (the fixture stub `tests/violations/fixtures/types/
// prisma-client.d.ts`) or a file under `@prisma/client` or `.prisma/client` (the generated output
// `prisma/schema/base.prisma` writes to). Deciding by declaration rather than by variable catches
// a client passed as a parameter or a transaction client (`Omit<PrismaClient, …>` keeps the
// member's declaration), and deciding by the declaring client — not by any member of the module —
// keeps a delegate's own methods and fields (`findMany`, `fields`) from being mistaken for
// delegates. Any read of the delegate counts, not only `<client>.<delegate>.<method>`, so handing
// the delegate to a local first is the same access, and so is destructuring it out (revised
// 2026-09-28): `const { review } = prisma`, `const { review: r } = tx`, a destructured parameter
// `({ review }: PrismaClient)` and a nested pattern are read through the pattern's type — the
// checker knows what a binding pattern destructures — and reported on the property, under the same
// messages. `$`-prefixed members other than raw SQL (`$transaction`, `$connect`, …) name no table
// and are ignored.
//
// DECISION (T047) — raw SQL (author, 2026-09-28). Runtime raw SQL is confined to the platform
// kernel; modules never write SQL. A raw query names its table where no rule can read it, which is
// exactly the access this rule exists to see, so inside `apps/api` any access to `$queryRaw`,
// `$executeRaw`, `$queryRawUnsafe` or `$executeRawUnsafe` declared on `PrismaClient` (through a
// transaction client too) is refused unless the file sits under `apps/api/src/platform/db/`, the
// folder that will hold the kernel's typed helpers (a row lock whose table is a string literal,
// checked like a delegate — a separate US5 task, note under T047). The `Unsafe` pair gets its own
// message: it takes a string and cannot be parameterised. Until the helper exists the ban is total
// outside `platform/db/`; a suppression with a reason (R-PROC-7) is the only way through.
//
// DECISION (T047) — delegate to table, by Prisma's convention in reverse. Models are PascalCase and
// `@@map` to snake_case plural tables (`base.prisma`); a delegate is the camelCased model name. So
// each manifest table maps to a delegate: singularise the last word (`ies` -> `y`, otherwise drop
// one trailing `s`) and camelCase the words — `reviews` -> `review`, `slot_holds` -> `slotHold`,
// `isnad_entries` -> `isnadEntry`, `idempotency_keys` -> `idempotencyKey`, `settings` -> `setting`.
// The mapping is checked when the rule loads: every table under exactly one owner and every
// delegate distinct, or the plugin refuses to load. `$`-prefixed manifest keys (`$comment`) are
// not owners (note under T016). The schema has no models yet (T055–T063), so `prisma/schema` is
// not read; when a model is declared under a name this convention does not produce, the access is
// reported as a delegate with no table, which is the prompt to reconcile the model or the manifest.
//
// DECISION (T047) — where it applies, and who owns a file. Inside `apps/api` only, as
// `api/no-orm-outside-repository` does (R-API-2), so the seed (`prisma/seed.ts`) and the seed tests
// (`tests/seed/`) may touch any table. `apps/api/src/modules/<m>/…` is owned by `<m>` and
// `apps/api/src/platform/…` by `platform`; an access from anywhere else in `apps/api` (jobs,
// surfaces, the entrypoints) is refused, because the owning module's repository is the only access
// path. A module reading its own table from a non-repository file is R-API-2's business, not this
// rule's. Paths are compared as runs of segments (`segmentsOf`/`after`), so the fixture tree and
// Windows separators match alike (note under T035).
const ts = require('typescript');

const { defineRule } = require('../rule');
const { after, segmentsOf } = require('../specifiers');
const { requireProgram } = require('../types');
const manifest = require('../../module-tables.json');

const RULE_ID = 'api/table-ownership';

const API_SOURCE = ['apps', 'api', 'src'];
const API_TREE = ['apps', 'api'];
const KERNEL_DB = ['apps', 'api', 'src', 'platform', 'db'];
const PLATFORM = 'platform';
const RAW_SQL_TAGGED = new Set(['$queryRaw', '$executeRaw']);
const RAW_SQL_UNSAFE = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);
const CLIENT_NAME = 'PrismaClient';
const CLIENT_MODULE = '@prisma/client';
const CLIENT_PATHS = [/\/@prisma\/client\//, /\/\.prisma\/client\//];

function singular(word) {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** The Prisma delegate a snake_case plural table is reached through. */
function delegateFor(table) {
  const words = table.split('_');
  words[words.length - 1] = singular(words[words.length - 1]);
  return words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

/** delegate -> { table, owner }, checked for a table under two owners and for two tables per delegate. */
function buildDelegates(ownership) {
  const delegates = new Map();
  const owners = new Map();
  for (const [owner, tables] of Object.entries(ownership)) {
    if (owner.startsWith('$')) continue;
    for (const table of tables) {
      if (owners.has(table)) {
        throw new Error(
          `eslint-plugin-ijazah (${RULE_ID}): table "${table}" is owned by both "${owners.get(table)}" and "${owner}" in module-tables.json`,
        );
      }
      owners.set(table, owner);
      const delegate = delegateFor(table);
      if (delegates.has(delegate)) {
        throw new Error(
          `eslint-plugin-ijazah (${RULE_ID}): tables "${delegates.get(delegate).table}" and "${table}" both map to the delegate "${delegate}"`,
        );
      }
      delegates.set(delegate, { table, owner });
    }
  }
  return delegates;
}

const DELEGATES = buildDelegates(manifest);

/** The module owning a file in apps/api, `platform` for the kernel, null elsewhere in apps/api. */
function ownerOf(segments) {
  const start = after(segments, API_SOURCE);
  if (start === -1) return null;
  const [area, name, next] = segments.slice(start);
  if (area === 'modules' && next !== undefined) return name;
  if (area === PLATFORM) return PLATFORM;
  return null;
}

function insideClientModule(declaration) {
  for (let node = declaration.parent; node !== undefined; node = node.parent) {
    if (
      ts.isModuleDeclaration(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text === CLIENT_MODULE
    ) {
      return true;
    }
  }
  const file = declaration.getSourceFile().fileName.split('\\').join('/');
  return CLIENT_PATHS.some((pattern) => pattern.test(file));
}

function isClientMember(declaration) {
  const container = declaration.parent;
  return container?.name?.text === CLIENT_NAME && insideClientModule(declaration);
}

function isClientSymbol(symbol) {
  return symbol !== undefined && (symbol.declarations ?? []).some(isClientMember);
}

function isRawSql(name) {
  return RAW_SQL_TAGGED.has(name) || RAW_SQL_UNSAFE.has(name);
}

/** The name a binding-pattern property destructures, or null when it is computed. */
function patternKey(property) {
  if (property.type !== 'Property' || property.computed) return null;
  const { key } = property;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-API-6',
  description: 'Bans database access to a table another module owns (module-tables.json)',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    foreignTable:
      "Module '{{module}}' reaches table '{{table}}' through '{{delegate}}', but module-tables.json assigns it to '{{owner}}'. Ask that module's public entry instead.",
    outsideModules:
      "'{{delegate}}' reaches table '{{table}}' from outside every module; only the repository of its owner, '{{owner}}', may touch it.",
    unknownDelegate:
      "'{{delegate}}' is a database delegate with no table in module-tables.json. Add the table under its owning module in the manifest.",
    rawSql:
      "'{{member}}' is raw SQL that names its table where no rule can read it; use the platform kernel's typed helper (apps/api/src/platform/db) or the owning module's repository through the client.",
    rawSqlUnsafe:
      "'{{member}}' takes a string and cannot be parameterised; raw SQL lives only in the platform kernel (apps/api/src/platform/db) as a typed helper such as a row lock.",
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);
    const segments = segmentsOf(context.filename);
    if (after(segments, API_TREE) === -1) return {};
    const fileOwner = ownerOf(segments);
    const insideKernelDb = after(segments, KERNEL_DB) !== -1;

    /** One client member reached, by member access or by destructuring, under its declared name. */
    function checkAccess(reportNode, name, symbol) {
      if (name.startsWith('$') && !isRawSql(name)) return;
      if (!isClientSymbol(symbol)) return;

      if (isRawSql(name)) {
        if (insideKernelDb) return;
        context.report({
          node: reportNode,
          messageId: RAW_SQL_UNSAFE.has(name) ? 'rawSqlUnsafe' : 'rawSql',
          data: { member: name },
        });
        return;
      }

      const delegate = name;
      const target = DELEGATES.get(delegate);
      if (target === undefined) {
        context.report({ node: reportNode, messageId: 'unknownDelegate', data: { delegate } });
        return;
      }
      if (target.owner === fileOwner) return;
      const data = { delegate, table: target.table, owner: target.owner, module: fileOwner };
      context.report({
        node: reportNode,
        messageId: fileOwner === null ? 'outsideModules' : 'foreignTable',
        data,
      });
    }

    return {
      MemberExpression(node) {
        const { property } = node;
        if (node.computed || property.type !== 'Identifier') return;
        const symbol = program.checker.getSymbolAtLocation(program.toTs(property));
        checkAccess(property, property.name, symbol);
      },
      ObjectPattern(node) {
        // The pattern's own type is what it destructures: the initialiser's for a declaration,
        // the annotation's or the contextual one for a parameter, the parent property's when nested.
        const source = program.checker.getNonNullableType(program.typeOf(node));
        for (const property of node.properties) {
          const name = patternKey(property);
          if (name === null) continue;
          checkAccess(property, name, program.checker.getPropertyOfType(source, name));
        }
      },
    };
  },
});
