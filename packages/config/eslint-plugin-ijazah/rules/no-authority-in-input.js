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
// WHAT IS NOT SEEN: see `input-schemas.js`.
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
        if (enclosingInput(sourceCode, node) === null) return;
        context.report({ node: node.key, messageId: 'authority', data: { name } });
      },
    };
  },
});
