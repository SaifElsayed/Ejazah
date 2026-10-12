// time/no-client-timestamp  ->  R-TIME-6  (fast)
//
// R-TIME-6: never trust a client-supplied timestamp for anything that matters — attendance,
// ordering, expiry; the server clock only. The constitution's mechanism is "no client timestamp
// fields exist in write schemas" (FR-021). In an input schema of the contracts package
// (`input-schemas.js`), this rule refuses (T159):
//
//   a server-event timestamp by name   `createdAt`, `updatedAt`, `expiresAt`, `joinedAt`, `paidAt`,
//                                      `occurredAt`, `timestamp`, and their snake_case forms;
//   an absolute instant by its schema  `z.date()`, `z.coerce.date()`, and a `.datetime()` that
//                                      accepts an offset (`z.iso.datetime()`,
//                                      `z.string().datetime()`, `{ offset: true }`), whatever the
//                                      field is called.
//
// A local wall-clock time with its zone is accepted, because R-TIME-3 requires a teacher's slot to
// be entered that way and resolved by packages/time: `z.iso.datetime({ local: true })` (no offset),
// a date (`z.iso.date()`, `z.string().date()`) and a time (`z.iso.time()`). A field refused by name
// is reported once, as a timestamp, even when its schema is also an instant.
//
// `z` is whatever the file imports from `zod`, by name, namespace or default.
//
// WHAT IS NOT SEEN: an instant built by a refinement or a transform of a plain string or number;
// and what `input-schemas.js` lists.
const { defineRule } = require('../rule');
const { enclosingInput, enclosingProperty, isContractsFile } = require('../input-schemas');
const { keyName, propertyName } = require('../syntax');

const TIMESTAMPS = new Set([
  'createdAt',
  'updatedAt',
  'expiresAt',
  'joinedAt',
  'paidAt',
  'occurredAt',
  'timestamp',
  'created_at',
  'updated_at',
  'expires_at',
  'joined_at',
  'paid_at',
  'occurred_at',
]);

/** Whether an options object literal sets `key` to `true`. */
function setsTrue(options, key) {
  return (
    options?.type === 'ObjectExpression' &&
    options.properties.some(
      (property) =>
        property.type === 'Property' &&
        keyName(property) === key &&
        property.value.type === 'Literal' &&
        property.value.value === true,
    )
  );
}

module.exports = defineRule({
  constitutionId: 'R-TIME-6',
  description:
    'Bans client timestamps and absolute instants in the input schemas of packages/contracts',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    timestamp:
      '"{{name}}" in an input schema takes a timestamp from the client — attendance, ordering and expiry are stamped by the server clock, and a client sends only a local wall-clock time with its zone',
    instant:
      '"{{name}}" is validated as an absolute instant in an input schema — the server clock decides instants, and a client sends only a local wall-clock time with its zone',
  },
  create(context) {
    if (!isContractsFile(context.filename)) return {};
    const { sourceCode } = context;
    const zod = new Set();

    /** Whether `node` is the zod binding, or its `coerce` member. */
    function isZod(node) {
      if (node?.type === 'Identifier') return zod.has(node.name);
      return propertyName(node) === 'coerce' && isZod(node.object);
    }

    function isInstant(call) {
      const name = propertyName(call.callee);
      if (name === 'date') return isZod(call.callee.object);
      if (name === 'datetime') {
        const [options] = call.arguments;
        return !(setsTrue(options, 'local') && !setsTrue(options, 'offset'));
      }
      return false;
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'zod') return;
        for (const specifier of node.specifiers) zod.add(specifier.local.name);
      },
      Property(node) {
        if (node.parent?.type !== 'ObjectExpression') return;
        const name = keyName(node);
        if (name === null || !TIMESTAMPS.has(name)) return;
        if (enclosingInput(sourceCode, node) === null) return;
        context.report({ node: node.key, messageId: 'timestamp', data: { name } });
      },
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression' || !isInstant(node)) return;
        const declarator = enclosingInput(sourceCode, node);
        if (declarator === null) return;
        const property = enclosingProperty(sourceCode, node);
        const key = property === null ? null : keyName(property);
        if (key !== null && TIMESTAMPS.has(key)) return;
        context.report({
          node,
          messageId: 'instant',
          data: { name: key ?? declarator.id.name },
        });
      },
    };
  },
});
