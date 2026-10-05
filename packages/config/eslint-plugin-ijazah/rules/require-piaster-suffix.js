// money/require-piaster-suffix  ->  R-MONEY-2  (typeAware)
//
// R-MONEY-2: never name a money variable without the `_piasters` suffix (`price` is forbidden;
// `price_piasters` is required) (FR-014). The suffix makes an amount visible at every call site
// and traces a name from the database column to the code without translation (ERD section 0).
// The contract row is "an identifier whose resolved type is money but whose name lacks the
// suffix": the name alone cannot tell whether `price` is money, so this rule asks the program what
// the identifier's type is (research R-10) and only then reads the name.
//
// DECISION (T045) — the suffix is the constitution's literal `_piasters`, snake_case and
// case-sensitive, the spelling of the database columns (note under T045 and T131). `amountPiasters`
// and a bare `piasters` are refused by this rule; `price_piasters` and `gross_piasters` pass. A
// name that is exactly `_piasters` is refused too (2026-10-05): a suffix needs something to be the
// suffix of, and that name says nothing about which amount it holds.
//
// DECISION (T045) — which identifiers. Declared names only, each checked against its declared
// type rather than a narrowed one: variable declarators (destructured bindings included),
// parameters of every function, method, arrow, declared function and signature (destructured
// bindings and constructor parameter properties included), class property definitions, and
// interface and type-literal property signatures. Since 2026-10-05 (reviews of PR #27) also the
// two names that reach a response without ever being a variable: an object-literal property whose
// key is written out (not computed, not shorthand) and whose value's type is money, so
// `({ price: price_piasters })` is refused on `price`; and a getter, in a class, an object literal
// or an interface, read by its return type. A shorthand property repeats a name that was already
// checked where it was declared. A reference is not a declaration: narrowing `candidate: number`
// to an amount inside an `if` (as `packages/money/src/index.spec.ts` does) names nothing new and
// stays silent. Function names are not checked — a function returning an amount is not a money
// variable. Not covered, deliberately: tuple labels (`[gross: Piasters, fee: Piasters]`) and index
// signatures, which name a position or a key type rather than one amount.
//
// DECISION (T045) — "a money variable" is one amount. A value is money when `isMoneyType` in
// `../types.js` says so (the branded intersection, optionally nullable, recognised by its
// unique-symbol key, a type parameter read through its constraint so `value: T` with `T extends
// Piasters` is an amount; shared with `money/no-arithmetic-outside-package`, T044). An array or
// other collection of amounts is deliberately not in scope. The rule applies everywhere,
// `packages/money` included, because the constitution names no exemption for R-MONEY-2.
const { defineRule } = require('../rule');
const { isMoneyType, requireProgram } = require('../types');

const RULE_ID = 'money/require-piaster-suffix';

const SUFFIX = '_piasters';

// Every node whose `params` declare parameters, whether or not it has a body.
const FUNCTION_LIKE = [
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'TSDeclareFunction',
  'TSEmptyBodyFunctionExpression',
  'TSMethodSignature',
  'TSFunctionType',
  'TSConstructorType',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
];

/** The identifiers a binding pattern declares, however deeply it destructures. */
function declaredIdentifiers(pattern) {
  if (pattern === null || pattern === undefined) return [];
  switch (pattern.type) {
    case 'Identifier':
      return [pattern];
    case 'AssignmentPattern':
      return declaredIdentifiers(pattern.left);
    case 'RestElement':
      return declaredIdentifiers(pattern.argument);
    case 'ArrayPattern':
      return pattern.elements.flatMap(declaredIdentifiers);
    case 'ObjectPattern':
      return pattern.properties.flatMap((property) =>
        property.type === 'RestElement'
          ? declaredIdentifiers(property.argument)
          : declaredIdentifiers(property.value),
      );
    case 'TSParameterProperty':
      return declaredIdentifiers(pattern.parameter);
    default:
      return [];
  }
}

/** The name a property key declares, or null when it is computed. */
function propertyName(node) {
  if (node.computed) return null;
  const { key } = node;
  if (key.type === 'Identifier' || key.type === 'PrivateIdentifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MONEY-2',
  description: 'Requires the _piasters suffix on a name whose type is a piaster amount',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    missingSuffix:
      "'{{name}}' holds a piaster amount, so its name must end with _piasters (price_piasters, not price).",
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);

    /** `nameNode` is what gets reported; `typedNode` is what holds the type, the name itself by default. */
    function check(nameNode, name, typedNode = nameNode) {
      if (name.endsWith(SUFFIX) && name.length > SUFFIX.length) return;
      if (!isMoneyType(program.typeOf(typedNode), program.checker)) return;
      context.report({ node: nameNode, messageId: 'missingSuffix', data: { name } });
    }

    function checkBindings(pattern) {
      for (const identifier of declaredIdentifiers(pattern)) check(identifier, identifier.name);
    }

    function checkProperty(node) {
      const name = propertyName(node);
      if (name !== null) check(node.key, name);
    }

    /** A getter is named like a property and typed by what it returns, which is its key's type. */
    function checkGetter(node) {
      if (node.kind === 'get') checkProperty(node);
    }

    /** An object-literal member: a getter by its return type, a written-out key by its value's type. */
    function checkLiteralMember(node) {
      if (node.kind === 'get') {
        checkProperty(node);
        return;
      }
      if (node.kind !== 'init' || node.method || node.shorthand) return;
      const name = propertyName(node);
      if (name !== null) check(node.key, name, node.value);
    }

    const listeners = {
      VariableDeclarator: (node) => checkBindings(node.id),
      PropertyDefinition: checkProperty,
      TSAbstractPropertyDefinition: checkProperty,
      TSPropertySignature: checkProperty,
      MethodDefinition: checkGetter,
      TSAbstractMethodDefinition: checkGetter,
      'ObjectExpression > Property': checkLiteralMember,
    };
    for (const type of FUNCTION_LIKE) {
      listeners[type] = (node) => node.params.forEach(checkBindings);
    }
    // An interface getter is a method signature: its parameters above, its own name here.
    listeners.TSMethodSignature = (node) => {
      node.params.forEach(checkBindings);
      checkGetter(node);
    };
    return listeners;
  },
});
