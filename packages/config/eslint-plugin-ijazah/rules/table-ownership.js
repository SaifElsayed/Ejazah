// api/table-ownership  ->  R-API-6  (typeAware)
//
// R-API-6: never touch another module's tables; the owning module's, or the kernel's, repository
// is the only access path, and runtime raw SQL is written only in the platform kernel, never in
// its string-taking `Unsafe` forms (FR-005, ADR 0005 D2, constitution 2.2.0). The contract row
// and its notes in `specs/001-foundations/contracts/lint-rules.md` are the authority for every
// decision below. The ownership is data, not prose: `packages/config/module-tables.json`
// (T016) assigns each of the ERD's tables to exactly one of the twelve modules or to the platform
// kernel. A query target cannot be read from syntax — `tx.review.findMany()` names no table and the
// client may arrive as a parameter — so this rule asks the program what each member access is
// (research R-10, R-11) and compares the table behind it with the module the file lives in.
//
// DECISION (T047, 2026-10-05) — what the database client is, and what a member of it is. A value
// is the database client when the member read from it is declared on a class or interface named
// `PrismaClient` inside the `@prisma/client` module — an ambient `declare module '@prisma/client'`
// (the fixture stub `tests/violations/fixtures/types/prisma-client.d.ts`) or a file under
// `@prisma/client` or `.prisma/client` (the generated output `prisma/schema/base.prisma` writes
// to) — which covers a module-level client, a client passed as a parameter and the transaction
// client (`Omit<PrismaClient, …>` keeps the member's declaration). A client returned by
// `$extends` is the database client too, and its members are mapped, not declared on
// `PrismaClient`, so a value is also the client when its type is declared inside that module and
// carries a `$`-prefixed member; a delegate (`findMany`, `fields`) carries none, which keeps a
// delegate's own members from being mistaken for delegates. A member is the same member by any
// spelling that reaches it: dot access, computed access with a literal or literal-typed key
// (`prisma['review']`, `prisma[k]` with `k` typed `'review'`), declaration destructuring with a
// plain or computed key, nested and in a parameter, and assignment-expression destructuring
// (`({ review: r } = prisma)`). Any read of the delegate counts, so handing it to a local first
// is the same access. An access whose member cannot be resolved — a computed key that is not a
// string literal type, `prisma[someString]` — is refused, because it may be any of them. Known
// limits, deliberately left: a client retyped structurally
// (`const db: { review: PrismaClient['review'] } = prisma`), which no longer is the client's type,
// and the shape of a generated `$extends` result, which is modelled in the RuleTester table and
// meets the real client when the schema has models (T055–T063).
//
// DECISION (T047, 2026-10-05) — which file may reach a table. Only a repository file — a file
// named `<name>.repository.<extension>` — of the module, or of the platform kernel, that owns the
// table (R-API-6: "the owning module's, or the kernel's, repository is the only access path").
// A service querying its own module's table through an injected client imports nothing, so
// `api/no-orm-outside-repository` (R-API-2) cannot see it; this rule refuses it. A file named
// `<name>.repository.spec.<extension>` is a repository file of its module or of the kernel for
// this rule, so the integration test ARCHITECTURE §13 asks for may read and write the tables its
// own repository owns; it gains nothing else, and rows it needs in another owner's tables are set
// up through helpers under `tests/`, outside `apps/api` and so outside this rule.
//
// DECISION (T047, 2026-10-05) — database client members are refused by default. The rule lists
// what a module may use, `$transaction`, not what it may not: any member of the client whose name
// starts with `$` is refused outside `apps/api/src/platform/db/`, so `$queryRaw`, `$executeRaw`,
// `$queryRawTyped`, `$extends`, `$connect` and a raw-query entry point the client gains later
// are refused on the day they appear, in a repository spec file as in any other. Runtime raw SQL
// is written only in the platform kernel because a raw query names its table where the ownership
// manifest cannot read it. The string-taking forms `$queryRawUnsafe` and `$executeRawUnsafe` are
// refused everywhere inside `apps/api`, the kernel included: they accept parameters, but their
// query text is a string the caller builds. No kernel helper is promised here; the first task
// that needs a runtime raw query writes it as a tagged query in a file under
// `apps/api/src/platform/db/` and names that file in its own task line. Not client members, not
// seen by this rule and held by review (R-API-6): a database driver used directly, and a string
// handed to `Prisma.raw` inside the kernel.
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
// `api/no-orm-outside-repository` does (R-API-2), so the seed (`prisma/seed.ts`), the seed tests
// (`tests/seed/`) and the helpers under `tests/` may touch any table. `apps/api/src/modules/<m>/…`
// is owned by `<m>` and `apps/api/src/platform/…` by `platform`; an access from anywhere else in
// `apps/api` (jobs, surfaces, the entrypoints) is refused, because the owner's repository is the
// only access path. Paths are compared as runs of segments (`segmentsOf`/`after`), so the fixture
// tree and Windows separators match alike (note under T035).
const path = require('node:path');

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
const CLIENT_MEMBER_PREFIX = '$';
// The one client member a module may use, and the two no file in the API may.
const ALLOWED_MEMBER = '$transaction';
const UNSAFE_MEMBERS = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);
const REPOSITORY_SUFFIXES = ['.repository', '.repository.spec'];
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

/**
 * Whether a type is the database client by its own declaration: declared inside the client module
 * and carrying a `$` member, which a client returned by `$extends` does and a delegate does not.
 */
function isClientType(checker, type) {
  const resolved = checker.getBaseConstraintOfType(type) ?? type;
  if (resolved.isUnion()) return resolved.types.some((member) => isClientType(checker, member));

  const declared = [resolved.aliasSymbol, resolved.getSymbol()].some((symbol) =>
    (symbol?.declarations ?? []).some(insideClientModule),
  );
  if (declared) {
    return checker
      .getPropertiesOfType(resolved)
      .some((property) => property.name.startsWith(CLIENT_MEMBER_PREFIX));
  }
  return (
    resolved.isIntersection() && resolved.types.some((member) => isClientType(checker, member))
  );
}

/** Whether a value is the database client at all, for an access that names no single member. */
function isClientValue(checker, type) {
  return isClientType(checker, type) || checker.getPropertiesOfType(type).some(isClientSymbol);
}

function isRepositoryFile(filename) {
  const basename = path.basename(filename);
  const withoutExtension = basename
    .slice(0, basename.length - path.extname(basename).length)
    .toLowerCase();
  return REPOSITORY_SUFFIXES.some((suffix) => withoutExtension.endsWith(suffix));
}

/** The member names a key of this type can only be, or null when it could be any. */
function literalNames(type) {
  const members = type.isUnion() ? type.types : [type];
  return members.every((member) => member.isStringLiteral())
    ? members.map((member) => member.value)
    : null;
}

/** Whether a pattern, however deeply nested, is the target of an assignment expression. */
function isAssignmentTarget(pattern) {
  let node = pattern;
  while (node.parent.type === 'Property' && node.parent.parent.type === 'ObjectPattern') {
    node = node.parent.parent;
  }
  return node.parent.type === 'AssignmentExpression' && node.parent.left === node;
}

module.exports = defineRule({
  constitutionId: 'R-API-6',
  description:
    "Bans database access to a table outside its owner's repository files, and database client members outside the platform kernel",
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    foreignTable:
      "Module '{{module}}' reaches table '{{table}}' through '{{delegate}}', but module-tables.json assigns it to '{{owner}}'. Ask that module's public entry instead.",
    outsideModules:
      "'{{delegate}}' reaches table '{{table}}' from outside every module; only the repository of its owner, '{{owner}}', may touch it.",
    notRepository:
      "'{{delegate}}' reaches table '{{table}}' from a file that is not a repository file. Only a file named <name>.repository.<extension> of its owner, '{{owner}}', may query it; move the query into that repository.",
    unknownDelegate:
      "'{{delegate}}' is a database delegate with no table in module-tables.json. Add the table under its owning module in the manifest.",
    clientMember:
      "'{{member}}' is a member of the database client, and a module may use only $transaction. Every other client member, raw SQL included, lives only under apps/api/src/platform/db/, because a raw query names its table where the ownership manifest cannot read it.",
    rawSqlUnsafe:
      "'{{member}}' takes its query text as a string the caller builds, so it is written nowhere in apps/api, the platform kernel included. Raw SQL lives only under apps/api/src/platform/db/, as a tagged query.",
    unresolvedMember:
      'This access reaches the database client through a key the rule cannot resolve to one member, so it may be any table or any client member. Name the member, or use a key whose type is a string literal.',
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);
    const { checker } = program;
    const segments = segmentsOf(context.filename);
    if (after(segments, API_TREE) === -1) return {};
    const fileOwner = ownerOf(segments);
    const insideKernelDb = after(segments, KERNEL_DB) !== -1;
    const repositoryFile = isRepositoryFile(context.filename);

    function checkClientMember(reportNode, member) {
      if (UNSAFE_MEMBERS.has(member)) {
        context.report({ node: reportNode, messageId: 'rawSqlUnsafe', data: { member } });
      } else if (member !== ALLOWED_MEMBER && !insideKernelDb) {
        context.report({ node: reportNode, messageId: 'clientMember', data: { member } });
      }
    }

    function checkDelegate(reportNode, delegate) {
      const target = DELEGATES.get(delegate);
      if (target === undefined) {
        context.report({ node: reportNode, messageId: 'unknownDelegate', data: { delegate } });
        return;
      }
      if (target.owner === fileOwner && repositoryFile) return;
      let messageId = 'notRepository';
      if (fileOwner === null) messageId = 'outsideModules';
      else if (target.owner !== fileOwner) messageId = 'foreignTable';
      context.report({
        node: reportNode,
        messageId,
        data: { delegate, table: target.table, owner: target.owner, module: fileOwner },
      });
    }

    /** One named member read from a value, by whichever spelling reached it. */
    function checkMember(reportNode, valueType, name) {
      const source = checker.getNonNullableType(valueType);
      const onClient =
        isClientSymbol(checker.getPropertyOfType(source, name)) ||
        (isClientType(checker, source) &&
          checker.getPropertiesOfType(source).some((property) => property.name === name));
      if (!onClient) return;
      if (name.startsWith(CLIENT_MEMBER_PREFIX)) checkClientMember(reportNode, name);
      else checkDelegate(reportNode, name);
    }

    /** A key read from a value: each member it can only be, or a refusal when it could be any. */
    function checkKey(reportNode, valueType, names) {
      if (names !== null) {
        for (const name of names) checkMember(reportNode, valueType, name);
      } else if (isClientValue(checker, checker.getNonNullableType(valueType))) {
        context.report({ node: reportNode, messageId: 'unresolvedMember' });
      }
    }

    /** The member names a pattern property destructures, or null when a computed key could be any. */
    function patternNames(property) {
      const { key } = property;
      if (property.computed) return literalNames(program.typeOf(key));
      if (key.type === 'Identifier') return [key.name];
      return key.type === 'Literal' ? [String(key.value)] : null;
    }

    /**
     * The type a pattern destructures. The checker knows it for a binding pattern — the
     * initialiser's for a declaration, the annotation's or the contextual one for a parameter, the
     * parent property's when nested — but not for the target of an assignment expression, which
     * is read from the right-hand side and walked down by key.
     */
    function destructuredType(pattern) {
      if (!isAssignmentTarget(pattern)) return program.typeOf(pattern);
      const { parent } = pattern;
      if (parent.type === 'AssignmentExpression') return program.typeOf(parent.right);

      const outer = destructuredType(parent.parent);
      const names = patternNames(parent);
      if (outer === null || names === null || names.length !== 1) return null;
      const member = checker.getPropertyOfType(checker.getNonNullableType(outer), names[0]);
      return member === undefined ? null : checker.getTypeOfSymbol(member);
    }

    return {
      MemberExpression(node) {
        const { property } = node;
        if (!node.computed && property.type !== 'Identifier') return;
        const names = node.computed ? literalNames(program.typeOf(property)) : [property.name];
        checkKey(property, program.typeOf(node.object), names);
      },
      ObjectPattern(node) {
        const source = destructuredType(node);
        if (source === null) return;
        for (const property of node.properties) {
          if (property.type === 'Property') checkKey(property, source, patternNames(property));
        }
      },
    };
  },
});
