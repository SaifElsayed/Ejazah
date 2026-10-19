// T038 (PR #80 review, 8): how `gender/no-authority-in-input` reads the authority allow-list,
// `packages/contracts/src/authority-allow-list.ts`, as text. The rule runs without a TypeScript
// loader, so the file is parsed here, scoped to the body of the exported `authorityAllowList`
// object and nothing else: a line in a comment before or after it, or another object in the file,
// cannot widen what the exported value holds (T029's test asserts the value itself).
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ALLOW_LIST_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'src',
  'authority-allow-list.ts',
);
const OBJECT_START = /export const authorityAllowList\s*=\s*\{/;
const ENTRY = /^\s*(\w+):\s*\[([^\]]*)\]/gm;
const FIELD = /'([^']+)'/g;

/**
 * Schema name → the authority fields that schema alone may carry, read from the body of the
 * exported object; throws when the file holds no such object.
 *
 * @param {string} text
 * @returns {Map<string, Set<string>>}
 */
function parseAllowList(text) {
  const start = OBJECT_START.exec(text);
  if (start === null) {
    throw new Error('authority-allow-list.ts does not export `authorityAllowList = {`');
  }
  const bodyStart = start.index + start[0].length;
  const bodyEnd = text.indexOf('}', bodyStart);
  if (bodyEnd === -1) throw new Error('authorityAllowList is not closed');
  const body = text.slice(bodyStart, bodyEnd);
  const list = new Map();
  for (const [, schema, fields] of body.matchAll(ENTRY)) {
    list.set(schema, new Set([...fields.matchAll(FIELD)].map(([, field]) => field)));
  }
  return list;
}

/** @type {Map<string, Set<string>> | undefined} */
let cached;

/** The allow-list of the repository's contracts package, read once per process. */
function readAllowList() {
  if (cached === undefined) cached = parseAllowList(readFileSync(ALLOW_LIST_PATH, 'utf8'));
  return cached;
}

module.exports = { parseAllowList, readAllowList };
