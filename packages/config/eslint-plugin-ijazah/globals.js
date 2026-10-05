// How a syntax rule recognises a runtime global (T038).
//
// Several rules refuse a global by name — `Intl` (R-MOBILE-9), `fetch` and `WebSocket`
// (R-MOBILE-11), `Math` (R-DB-6), `Date` (R-TIME-1). Matching the name alone is wrong twice over:
// it refuses a parameter or an import that merely shares the name, and it misses the same global
// reached through the object that holds it. Both are answered here, from the scope analysis the
// parser already did, so no rule re-implements it:
//
//   - a name is the global only when no declaration in any enclosing scope binds it; a function
//     taking a parameter called `fetch` is calling its parameter;
//   - `globalThis.X`, `window.X`, `self.X` and `global.X` — dotted, computed with a string, behind
//     optional chaining or a cast — are `X`.
//
// A type position is not a use: `let socket: WebSocket` and `typeof fetch` in a type name the
// global's type and reach nothing at run time, so only value references are returned.
//
// A global destructured off the object that holds it (`const { fetch } = globalThis`) is the same
// global again; `isHolder` answers whether an expression is that object, for the rules that read
// the pattern (R-MOBILE-11; R-DB-6 asks the same of `Math` through `globalNamed`).
//
// What this cannot do is follow a value: after `const g = globalThis`, `g.fetch` is not seen.
// These rules run without the TypeScript program (research R-10).
const { propertyName, unwrap } = require('./syntax');

const HOLDERS = new Set(['globalThis', 'window', 'self', 'global']);

/** True when no enclosing scope declares the identifier's name, so it names the runtime global. */
function isUnbound(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope !== null && scope !== undefined) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined && variable.defs.length > 0) return false;
    scope = scope.upper;
  }
  return true;
}

/**
 * The global an expression is, or null: the bare name when unbound, or a member of an unbound
 * holder. `names` limits the answer to the globals a rule cares about.
 */
function globalNamed(sourceCode, node, names) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return null;

  if (inner.type === 'Identifier') {
    return names.has(inner.name) && isUnbound(sourceCode, inner) ? inner.name : null;
  }
  if (inner.type !== 'MemberExpression') return null;

  const name = propertyName(inner);
  if (name === null || !names.has(name)) return null;
  const holder = unwrap(inner.object);
  if (holder === null || holder === undefined || holder.type !== 'Identifier') return null;
  return HOLDERS.has(holder.name) && isUnbound(sourceCode, holder) ? name : null;
}

/** True when the expression is the object that holds the globals, by an unbound name of it. */
function isHolder(sourceCode, node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined || inner.type !== 'Identifier') return false;
  return HOLDERS.has(inner.name) && isUnbound(sourceCode, inner);
}

/** Every identifier in the file that is a value reference to one of the named globals. */
function unboundReferences(sourceCode, names) {
  const found = [];
  for (const scope of sourceCode.scopeManager.scopes) {
    for (const reference of scope.references) {
      const { identifier } = reference;
      if (!names.has(identifier.name)) continue;
      if (reference.resolved !== null && reference.resolved.defs.length > 0) continue;
      // The TypeScript scope manager marks type-only references; the default one has no such flag.
      if (reference.isValueReference === false) continue;
      if (identifier.parent !== undefined && identifier.parent.type === 'TSTypeQuery') continue;
      found.push(identifier);
    }
  }
  return found;
}

/** `holder.X` for a named global, as the member expression that names it, or null. */
function heldGlobal(sourceCode, node, names) {
  if (node.type !== 'MemberExpression') return null;
  const inner = unwrap(node.object);
  if (inner === null || inner === undefined || inner.type !== 'Identifier') return null;
  return globalNamed(sourceCode, node, names);
}

module.exports = { globalNamed, heldGlobal, isHolder, isUnbound, unboundReferences };
