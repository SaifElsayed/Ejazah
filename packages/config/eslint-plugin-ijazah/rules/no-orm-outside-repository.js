// api/no-orm-outside-repository  ->  R-API-2  (fast)
//
// R-API-2: never put a query in a service or a rule in a repository. Services decide;
// repositories fetch. The mechanism the constitution names for the first half is this one — the
// database client is a name only a `*.repository.ts` file may know, so a service that wants to
// query has to go through the repository that owns the table (FR-005).
//
// DECISION (T036) — the database-client specifier. `prisma/schema/base.prisma` declares the
// `prisma-client` generator with `output = "../../node_modules/.prisma/client"`, so the client
// reaches application code under two names: the canonical package `@prisma/client`, and the
// generated output path `.prisma/client`. Both are banned; the canonical name is the one a
// repository is expected to write and the one T021's fixture uses, and the generated path is
// banned with it so renaming the import does not walk around the rule. That is the whole
// decision: two literal specifiers, matched exactly (and `.prisma/client` matched at the end of
// a deeper path too, e.g. `../../node_modules/.prisma/client`).
//
// What this rule deliberately does NOT do: chase a re-export. A module of one's own, say
// `modules/booking/db.ts`, that re-exports the client and is then imported from a service would
// pass this rule and is a boundary violation all the same. Resolving that needs the program,
// which this fast rule does not have (research R-10); `api/table-ownership` (R-API-6, type-aware)
// is where a query is caught by what it touches rather than by what it imports, and review is the
// backstop the constitution already names. Adding a specifier here later is additive and cheap.
//
// The file is matched by its basename, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/`, so a rule comparing
// a root-relative path would see none of them (note under T035).
const path = require('node:path');

const { defineRule } = require('../rule');

// Exact specifiers, plus the generated output path at the end of any deeper relative path.
const BANNED = new Set(['@prisma/client', '.prisma/client']);
const GENERATED_CLIENT_SUFFIX = /(^|\/)\.prisma\/client$/;

// `foo.repository.ts`, `foo.repository.js`, `foo.repository.mts`, ... The extension is dropped
// first so the check is about the `.repository` segment, not about a spelling of TypeScript.
function isRepositoryFile(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  const basename = path.basename(filename);
  const withoutExtension = basename.slice(0, basename.length - path.extname(basename).length);
  return withoutExtension.toLowerCase().endsWith('.repository');
}

function isDatabaseClient(specifier) {
  if (typeof specifier !== 'string') return false;
  return BANNED.has(specifier) || GENERATED_CLIENT_SUFFIX.test(specifier);
}

function isRequireCall(node) {
  return (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length > 0 &&
    node.arguments[0].type === 'Literal'
  );
}

module.exports = defineRule({
  constitutionId: 'R-API-2',
  description: 'Bans importing the database client outside a *.repository.ts file',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    outsideRepository:
      '"{{specifier}}" is the database client — import it only from a *.repository.ts file, and let a service ask the repository that owns the table',
  },
  create(context) {
    if (isRepositoryFile(context.filename)) return {};

    function check(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      if (!isDatabaseClient(sourceNode.value)) return;
      context.report({
        node: sourceNode,
        messageId: 'outsideRepository',
        data: { specifier: String(sourceNode.value) },
      });
    }

    return {
      // import … from '…'  /  export … from '…'  /  import('…')
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source.type === 'Literal' ? node.source : null),
      // import x = require('…'), the TypeScript form.
      TSImportEqualsDeclaration: (node) =>
        check(
          node.moduleReference.type === 'TSExternalModuleReference' &&
            node.moduleReference.expression.type === 'Literal'
            ? node.moduleReference.expression
            : null,
        ),
      // require('…') — the plugin's own configuration files and any CommonJS worker entry.
      CallExpression: (node) => check(isRequireCall(node) ? node.arguments[0] : null),
    };
  },
});
