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
// the delegate to a local first is the same access. `$`-prefixed members (`$transaction`,
// `$queryRaw`, `$executeRaw`) name no table and are ignored: raw SQL is out of this rule's reach
// and stays with review. Destructuring a delegate out of the client is not chased.
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
const PLATFORM = 'platform';
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
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);
    const segments = segmentsOf(context.filename);
    if (after(segments, API_TREE) === -1) return {};
    const fileOwner = ownerOf(segments);

    return {
      MemberExpression(node) {
        const { property } = node;
        if (node.computed || property.type !== 'Identifier' || property.name.startsWith('$')) {
          return;
        }
        const symbol = program.checker.getSymbolAtLocation(program.toTs(property));
        if (symbol === undefined || !(symbol.declarations ?? []).some(isClientMember)) return;

        const delegate = property.name;
        const target = DELEGATES.get(delegate);
        if (target === undefined) {
          context.report({ node: property, messageId: 'unknownDelegate', data: { delegate } });
          return;
        }
        if (target.owner === fileOwner) return;
        const data = { delegate, table: target.table, owner: target.owner, module: fileOwner };
        context.report({
          node: property,
          messageId: fileOwner === null ? 'outsideModules' : 'foreignTable',
          data,
        });
      },
    };
  },
});
