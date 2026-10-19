// gender/no-authority-in-input  ->  R-GENDER-4  (fast)
//
// R-GENDER-4: never read gender, role or user id from client input for an authorization decision;
// the server-held session only. The constitution's mechanism is "these fields do not exist in
// input schemas" (FR-046). This rule is what makes that true: in an input schema of the contracts
// package (`input-schemas.js`), a key named `gender`, `role`, `userId` or `user_id` is refused,
// anywhere in the schema, nested or added by `.extend()` (T159). The session's own values reach a
// procedure through its context (T106), never through what the client sent.
//
// Another user's id under its own name (`teacherUserId`, `studentUserId`) is the subject of a
// request, not the requester's authority, and passes: what it may be used for is the service's.
//
// THE ALLOW-LIST (T038, R-GENDER-6): `packages/contracts/src/authority-allow-list.ts` names, per
// input schema and per field, the one exception: `onboardingCompleteInput` may carry `gender` and
// `role`, the declarations a person makes once before any account exists. The list is keyed by the
// schema's declared name, since this rule sees schema objects and not procedure paths, and is read
// from the file as text, once per process (`../authority-allow-list.js`, scoped to the exported
// object's body): the rule runs without a TypeScript loader, so each entry of that file stays on
// one line, `<schemaName>: ['<field>', '<field>']`. T029's test asserts the list holds that one
// schema with those two fields and nothing else.
//
// WHAT IS NOT SEEN: see `input-schemas.js`.
const { readAllowList } = require('../authority-allow-list');
const { defineRule } = require('../rule');
const { enclosingInput, isContractsFile } = require('../input-schemas');
const { keyName } = require('../syntax');

const AUTHORITY = new Set(['gender', 'role', 'userId', 'user_id']);

module.exports = defineRule({
  constitutionId: 'R-GENDER-4',
  description: 'Bans gender, role and user id keys in the input schemas of packages/contracts',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    authority:
      '"{{name}}" in an input schema lets the client say who it is — the requester\'s gender, role and user id come from the server-held session only',
  },
  create(context) {
    if (!isContractsFile(context.filename)) return {};
    const { sourceCode } = context;
    return {
      Property(node) {
        if (node.parent?.type !== 'ObjectExpression') return;
        const name = keyName(node);
        if (name === null || !AUTHORITY.has(name)) return;
        const declarator = enclosingInput(sourceCode, node);
        if (declarator === null) return;
        if (readAllowList().get(declarator.id.name)?.has(name)) return;
        context.report({ node: node.key, messageId: 'authority', data: { name } });
      },
    };
  },
});
