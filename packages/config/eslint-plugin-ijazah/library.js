// How a syntax rule finds a named export of a library, however it is spelled (T037).
//
// Two rules refuse particular exports of `react-native` — the raw controls (R-MOBILE-6) and the
// legacy `AsyncStorage` (R-MOBILE-10) — and a rule that matched only `import { X } from '…'` would
// be walked around by the next spelling along. The spellings are read here once:
//
//   import { X } from 'lib'             named, and aliased (`X as Y`)
//   import * as L from 'lib' … L.X      namespace or default binding: member access, dotted or
//   import L from 'lib' … <L.X />         computed with a string, and JSX
//   import { default as L } from 'lib'  the default export under a name of one's own, which is
//                                         the same binding as `import L from 'lib'`
//   import L = require('lib') … L.X     the TypeScript import-equals form
//   const L = require('lib') … L.X      a binding assigned from `require`
//   const { X } = L                     destructured off any of those bindings
//   const { X: Y } = require('lib')     destructured, and renamed, off `require`
//   require('lib').X                    read straight off `require`
//   export { X } from 'lib'             re-exported by name
//   export * from 'lib'                 re-exported wholesale
//
// each through optional chaining and the TypeScript wrappers. A named import is reported once, at
// the import; a member of a binding is reported where it is written, the only place it is named.
//
// A type-only import or export is skipped: it names a type and holds nothing at run time.
//
// What is not followed: the binding handed to another variable (`const M = L`), a dynamic
// `import('lib')`, and a re-export through a module of one's own. Each needs the program the fast
// rules do not have (research R-10).
const { keyName, propertyName, requiredSpecifier, unwrap } = require('./syntax');

function specifierName(node) {
  return node.type === 'Identifier' ? node.name : String(node.value);
}

/**
 * @param {object} options
 * @param {(specifier: string) => boolean} options.isSource  Which libraries are read.
 * @param {(name: string) => boolean} options.isName         Which of their exports are refused.
 * @param {(node: object, name: string, source: string) => void} options.report
 * @param {(node: object, source: string) => void} options.reportAll  For `export * from`.
 */
function onLibraryMembers({ isSource, isName, report, reportAll }) {
  // Local name of a namespace, default or `require` binding -> the library it holds.
  const holders = new Map();

  function sourceOf(node) {
    const inner = unwrap(node);
    if (inner === null || inner === undefined) return null;
    const required = requiredSpecifier(inner);
    if (required !== null) return isSource(required) ? required : null;
    if (inner.type === 'Identifier' || inner.type === 'JSXIdentifier') {
      return holders.get(inner.name) ?? null;
    }
    return null;
  }

  return {
    ImportDeclaration(node) {
      const source = node.source.value;
      if (!isSource(source) || node.importKind === 'type') return;
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') {
          holders.set(specifier.local.name, source);
          continue;
        }
        if (specifier.importKind === 'type') continue;
        const name = specifierName(specifier.imported);
        if (name === 'default') {
          holders.set(specifier.local.name, source);
          continue;
        }
        if (isName(name)) report(specifier, name, source);
      }
    },
    TSImportEqualsDeclaration(node) {
      const reference = node.moduleReference;
      if (reference.type !== 'TSExternalModuleReference') return;
      const source = reference.expression.value;
      if (isSource(source)) holders.set(node.id.name, source);
    },
    ExportNamedDeclaration(node) {
      if (node.source === null || node.source === undefined) return;
      const source = node.source.value;
      if (!isSource(source) || node.exportKind === 'type') return;
      for (const specifier of node.specifiers) {
        if (specifier.exportKind === 'type') continue;
        const name = specifierName(specifier.local);
        if (isName(name)) report(specifier, name, source);
      }
    },
    ExportAllDeclaration(node) {
      const source = node.source.value;
      if (isSource(source) && node.exportKind !== 'type') reportAll(node, source);
    },
    VariableDeclarator(node) {
      const source = sourceOf(node.init);
      if (source === null) return;
      if (node.id.type === 'Identifier') {
        if (requiredSpecifier(node.init) !== null) holders.set(node.id.name, source);
        return;
      }
      if (node.id.type !== 'ObjectPattern') return;
      for (const property of node.id.properties) {
        if (property.type !== 'Property') continue;
        const name = keyName(property);
        if (name !== null && isName(name)) report(property.key, name, source);
      }
    },
    MemberExpression(node) {
      const name = propertyName(node);
      if (name === null || !isName(name)) return;
      const source = sourceOf(node.object);
      if (source !== null) report(node, name, source);
    },
    JSXMemberExpression(node) {
      if (node.parent.type === 'JSXClosingElement' || !isName(node.property.name)) return;
      const source = sourceOf(node.object);
      if (source !== null) report(node, node.property.name, source);
    },
  };
}

module.exports = { onLibraryMembers };
