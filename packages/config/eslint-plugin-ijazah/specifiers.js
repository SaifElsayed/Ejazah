// How a wall rule reads a path and an import (T035).
//
// The six `boundaries/*` rules ask the same three questions — which file is this, which file does
// this specifier name, and where is the wall drawn — and they used to answer them with six
// verbatim copies of the same helpers and six private copies of the wall data. A wall that is
// described in seven places is a wall with six chances to disagree with itself: the alias hole
// closed here would otherwise have had to be closed five more times. The helpers live here once,
// and the wall data lives once in `packages/config/eslint.boundaries.js`, which this module reads
// as the default so a rule linted standalone still knows where the wall is.
//
// Paths are compared as runs of segments, never anchored at the repository root: the violation
// fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const path = require('node:path');

const { boundaries: wall } = require('../eslint.boundaries');

/** The wall as flat-config `settings`, with anything the configuration overrides laid on top. */
function settingsFor(context) {
  const configured = context.settings?.ijazah?.boundaries ?? {};
  return { ...wall, ...configured };
}

function segmentsOf(value) {
  return String(value)
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.');
}

/** Index just past `needle` where it appears as a run of segments, or -1. */
function after(segments, needle) {
  for (let start = 0; start + needle.length <= segments.length; start += 1) {
    if (needle.every((part, offset) => segments[start + offset] === part)) {
      return start + needle.length;
    }
  }
  return -1;
}

/**
 * The path a specifier names, or null when it names a package.
 *
 * A relative specifier is resolved against the importing file. A specifier starting with a
 * configured alias prefix is expanded to the path the alias stands for — `apps/mobile/tsconfig.json`
 * declares `"@/*": ["src/*"]`, so `@/features/teacher/roster` is the same file as
 * `../teacher/roster` and a wall that only saw the relative spelling was open to the one the
 * application actually ships. The longest prefix wins, so a narrower alias is never shadowed.
 */
function resolveTarget(filename, specifier, aliases = {}) {
  if (typeof specifier !== 'string' || specifier === '') return null;

  const prefixes = Object.keys(aliases).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (specifier.startsWith(prefix)) {
      return path.posix.normalize(`${aliases[prefix]}${specifier.slice(prefix.length)}`);
    }
  }

  if (!specifier.startsWith('.')) return null;
  const from = String(filename).split('\\').join('/');
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
}

function isRequireCall(node) {
  return (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length > 0 &&
    node.arguments[0].type === 'Literal'
  );
}

/** Every syntax that names a module, so a rule cannot be walked around by writing the import differently. */
function onEverySpecifier(check) {
  return {
    ImportDeclaration: (node) => check(node.source),
    ExportNamedDeclaration: (node) => check(node.source),
    ExportAllDeclaration: (node) => check(node.source),
    ImportExpression: (node) => check(node.source.type === 'Literal' ? node.source : null),
    TSImportEqualsDeclaration: (node) =>
      check(
        node.moduleReference.type === 'TSExternalModuleReference' &&
          node.moduleReference.expression.type === 'Literal'
          ? node.moduleReference.expression
          : null,
      ),
    CallExpression: (node) => check(isRequireCall(node) ? node.arguments[0] : null),
  };
}

module.exports = { after, isRequireCall, onEverySpecifier, resolveTarget, segmentsOf, settingsFor };
