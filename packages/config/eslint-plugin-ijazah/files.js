// How a rule reads the file it is linting (T037–T042, T131, T132).
//
// Every rule in the plugin decides something from the path — a feature file, a test file, the
// time package, the secure storage layer — and the six wall rules already answer "is this file
// under that tree" through `segmentsOf` and `after` in `./specifiers.js`. The rules that landed
// with the design, localisation, security and process families ask the same question of more
// trees, so the answers live here once rather than eighteen more times.
//
// Paths are compared as runs of segments, never anchored at the repository root: the violation
// fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035). A tree is
// written as a POSIX path and split the same way the filename is, so `apps/mobile/src/features`
// matches on Windows too.
const path = require('node:path');

const { after, segmentsOf } = require('./specifiers');

/**
 * The filename's segments with the extension dropped from the last one, so `lib/storage.ts` and
 * `lib/storage/index.ts` both end in a `storage` segment.
 */
function segmentsWithoutExtension(filename) {
  const segments = segmentsOf(filename);
  if (segments.length === 0) return segments;
  const last = segments[segments.length - 1];
  const extension = path.extname(last);
  segments[segments.length - 1] = extension === '' ? last : last.slice(0, -extension.length);
  return segments;
}

/** True when `tree` (a POSIX path) appears as a run of segments in the filename. */
function isUnder(filename, tree) {
  if (typeof filename !== 'string' || filename === '') return false;
  return after(segmentsOf(filename), segmentsOf(tree)) !== -1;
}

/**
 * True when `tree` appears as a run of segments in the filename, where the last segment of the
 * tree may also be the file itself minus its extension: `isAt(f, 'lib/storage')` is true for
 * `lib/storage.ts`, `lib/storage/index.ts` and `lib/storage/keys.ts`.
 */
function isAt(filename, tree) {
  if (typeof filename !== 'string' || filename === '') return false;
  return after(segmentsWithoutExtension(filename), segmentsOf(tree)) !== -1;
}

/** `foo.spec.ts` -> `foo.spec`; the check is about the suffix, not about a spelling of TypeScript. */
function basenameWithoutExtension(filename) {
  const basename = path.basename(String(filename));
  return basename.slice(0, basename.length - path.extname(basename).length);
}

const TEST_DIRECTORIES = new Set(['tests', 'test', '__tests__']);

/**
 * A test file: `*.spec.*`, `*.test.*`, or any file under a `tests/`, `test/` or `__tests__/`
 * directory. The violation fixtures for R-PROC-10 are real `*.spec.ts` files (note under
 * T025–T026), which is why the suffix is matched on the basename rather than on a root-anchored
 * path.
 */
function isTestFile(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  const base = basenameWithoutExtension(filename).toLowerCase();
  if (base.endsWith('.spec') || base.endsWith('.test')) return true;
  return segmentsOf(filename)
    .slice(0, -1)
    .some((segment) => TEST_DIRECTORIES.has(segment));
}

module.exports = { basenameWithoutExtension, isAt, isTestFile, isUnder, segmentsWithoutExtension };
