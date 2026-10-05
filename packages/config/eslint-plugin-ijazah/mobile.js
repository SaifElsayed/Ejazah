// Where a file sits inside the mobile application (T037).
//
// The eight `mobile/*` rules of T037, T038 and T039 each decide from the file's path: a colour is
// legal in `design/`, a manual format in `lib/`, a storage import in `lib/storage`. They share one
// answer to "which part of `apps/mobile/src` is this file in" so that moving a folder is one edit.
//
// The path is matched as a run of segments, never anchored at the repository root, because the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
//
// DECISION (T037) — the rules read `apps/mobile/src/**` and nothing else. Files beside `src`
// (the Expo configuration, the test-runner configuration) are build configuration, where a splash
// colour is a platform requirement rather than a design choice, and the Admin panel shares no
// token, translation or primitive with the mobile application (ARCHITECTURE §6.5).
const path = require('node:path');

const { after, segmentsOf } = require('./specifiers');

const MOBILE_SOURCE = ['apps', 'mobile', 'src'];

/** `{ area, rest }` for a file under `apps/mobile/src`, else null. `area` is the first folder. */
function mobileFile(filename) {
  const segments = segmentsOf(filename);
  const at = after(segments, MOBILE_SOURCE);
  if (at === -1 || at >= segments.length) return null;
  const rest = segments.slice(at);
  return { area: rest.length > 1 ? rest[0] : '', rest };
}

/** The file name up to its first dot: `storage.ts`, `storage.native.ts` and `storage` all read `storage`. */
function stem(segment) {
  const base = path.basename(String(segment));
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * True when the file is `<folders>/<name>` as a file of any extension or sits anywhere below a
 * folder of that name: `lib/storage.ts`, `lib/storage/index.ts`, `lib/storage/keys/session.ts`.
 */
function isAt(file, folders, name) {
  if (file === null) return false;
  const { rest } = file;
  if (rest.length <= folders.length) return false;
  if (!folders.every((folder, index) => rest[index] === folder)) return false;
  const next = rest[folders.length];
  if (rest.length === folders.length + 1) return stem(next) === name;
  return next === name;
}

/** `*.spec.*`, `*.test.*` and anything under `__tests__`: code that no user is ever shown. */
function isTestFile(filename) {
  const segments = segmentsOf(filename);
  if (segments.includes('__tests__')) return true;
  const parts = path.basename(String(filename)).split('.');
  return parts.length > 2 && parts.slice(1, -1).some((part) => part === 'spec' || part === 'test');
}

module.exports = { isAt, isTestFile, mobileFile };
