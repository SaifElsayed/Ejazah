// How a syntax rule reads an expression (T037).
//
// The fast rules of T037–T042, T131 and T132 ask the same few questions of a node, and each
// question has a spelling that walks around a rule which forgot it:
//
//   - what is this expression once the wrappers are off? `a?.b`, `a!.b`, `(a as X).b`,
//     `a satisfies X` and `<X>a` all carry the same value as `a.b` and `a`;
//   - what name does this member access or this property key carry? `x.name`, `x['name']` and
//     x[`name`] name one property;
//   - which values can this expression turn out to be? `cond ? a : b`, `a || b`, `a ?? b` and
//     `(a, b)` hand on one of their operands.
//
// They are answered here once so eighteen rules do not answer them eighteen slightly different
// ways. Nothing here follows a value through a variable: these rules run without the TypeScript
// program (research R-10), so `const f = fetch; f()` is seen at the assignment and never at the
// call. Each rule header says what that leaves to review.

// Wrappers that change how an expression is typed or guarded, never what it evaluates to.
const WRAPPERS = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

/** The expression underneath optional chaining and the TypeScript-only wrappers. */
function unwrap(node) {
  let current = node;
  while (current !== null && current !== undefined && WRAPPERS.has(current.type)) {
    current = current.expression;
  }
  return current;
}

/** The outermost wrapper around a node, which is the node its parent actually holds. */
function wrapped(node) {
  let current = node;
  while (
    current.parent !== null &&
    current.parent !== undefined &&
    WRAPPERS.has(current.parent.type) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

/** The text of a string literal or of a template literal with no `${}` in it, else null. */
function staticString(node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return null;
  if (inner.type === 'Literal' && typeof inner.value === 'string') return inner.value;
  if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0) {
    return inner.quasis[0].value.cooked ?? null;
  }
  return null;
}

/** The property a member access names: `x.name`, `x['name']`, x[`name`]. Null when computed from a value. */
function propertyName(member) {
  if (member === null || member === undefined) return null;
  if (member.type !== 'MemberExpression' && member.type !== 'JSXMemberExpression') return null;
  const { property } = member;
  if (member.type === 'JSXMemberExpression') return property.name;
  if (!member.computed) return property.type === 'Identifier' ? property.name : null;
  return staticString(property);
}

/** The name a property, class member or type member is declared under, quoted or not. */
function keyName(node) {
  const { key } = node;
  if (key === null || key === undefined) return null;
  if (!node.computed) {
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'Literal') return String(key.value);
    return null;
  }
  return staticString(key);
}

/**
 * Every value an expression can hand on, with the wrappers off: both arms of a conditional, both
 * sides of `||`, `&&` and `??`, and the last operand of a comma expression.
 */
function alternatives(node) {
  const leaves = [];
  const pending = [node];
  while (pending.length > 0) {
    const current = unwrap(pending.pop());
    if (current === null || current === undefined) continue;
    if (current.type === 'ConditionalExpression') {
      pending.push(current.alternate, current.consequent);
    } else if (current.type === 'LogicalExpression') {
      pending.push(current.right, current.left);
    } else if (current.type === 'SequenceExpression') {
      pending.push(current.expressions.at(-1));
    } else {
      leaves.push(current);
    }
  }
  return leaves;
}

/** `require('…')` with a literal specifier, wrappers off. Returns the specifier or null. */
function requiredSpecifier(node) {
  const call = unwrap(node);
  if (call === null || call === undefined || call.type !== 'CallExpression') return null;
  if (call.callee.type !== 'Identifier' || call.callee.name !== 'require') return null;
  if (call.arguments.length === 0) return null;
  return staticString(call.arguments[0]);
}

/**
 * One visitor object from several: where two name the same node type, both run, in order. Rules
 * that read imports through `onEverySpecifier` and something else besides need this, because
 * spreading two objects keeps only the last handler for a shared key.
 */
function mergeVisitors(...visitors) {
  const merged = {};
  for (const visitor of visitors) {
    for (const [selector, handler] of Object.entries(visitor)) {
      const earlier = merged[selector];
      merged[selector] =
        earlier === undefined
          ? handler
          : (node) => {
              earlier(node);
              handler(node);
            };
    }
  }
  return merged;
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function isFunction(node) {
  return node !== null && node !== undefined && FUNCTIONS.has(node.type);
}

/**
 * True when the node or anything below it satisfies the predicate. A nested function is another
 * body with its own control flow, so the walk does not enter one.
 */
function containsNode(sourceCode, root, predicate) {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (predicate(node)) return true;
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const child = node[key];
      const children = Array.isArray(child) ? child : [child];
      for (const candidate of children) {
        if (candidate === null || candidate === undefined) continue;
        if (typeof candidate.type !== 'string' || isFunction(candidate)) continue;
        pending.push(candidate);
      }
    }
  }
  return false;
}

module.exports = {
  alternatives,
  containsNode,
  isFunction,
  keyName,
  mergeVisitors,
  propertyName,
  requiredSpecifier,
  staticString,
  unwrap,
  wrapped,
};
