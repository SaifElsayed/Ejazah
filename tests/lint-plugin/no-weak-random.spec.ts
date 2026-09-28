// db/no-weak-random (R-DB-6) against a table of code (T040).
//
// The fixture proves `Math.random()` called inside a certificate number. This table proves the
// reference that is not a call — `Math.random` passed as a value is a call deferred — and the
// computed spelling `Math['random']`, then `crypto.pseudoRandomBytes` on any receiver, and the
// predictable libraries in every import spelling `specifiers.js` knows. No folder is exempt, so a
// test file and a mobile file have rows in the invalid table.
//
// The valid table names the sources the message points to — `crypto.randomInt`,
// `crypto.getRandomValues`, `randomBytes` — and `nanoid`, whose default export is the secure
// generator while `nanoid/non-secure` is the refused one; a `random` on a receiver that is not
// `Math` is somebody's own generator and is not read.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const certificate = 'apps/api/src/modules/certification/certificate-number.ts';
const crypto = 'apps/api/src/platform/crypto/identifiers.ts';
const test = 'apps/api/src/modules/booking/booking.service.spec.ts';
const mobile = 'apps/mobile/src/features/shared/shuffle.ts';

typescriptRuleTester().run('db/no-weak-random', loadRule('no-weak-random.js'), {
  valid: [
    {
      name: 'crypto.randomInt, the source the message names',
      code: "import crypto from 'node:crypto';\nexport const draw = () => crypto.randomInt(0, 1_000_000);",
      filename: certificate,
    },
    {
      name: 'crypto.getRandomValues, the other source the message names',
      code: 'export const draw = () => crypto.getRandomValues(new Uint8Array(16));',
      filename: mobile,
    },
    {
      name: 'randomBytes, the cryptographic sibling of the refused one',
      code: "import { randomBytes } from 'node:crypto';\nexport const draw = () => randomBytes(16);",
      filename: crypto,
    },
    {
      name: 'nanoid, whose default export is the secure generator',
      code: "import { nanoid } from 'nanoid';\nexport const next = () => nanoid();",
      filename: crypto,
    },
    {
      name: 'a subpath of nanoid that is not the non-secure one',
      code: "import { nanoid } from 'nanoid/async';\nexport const next = nanoid;",
      filename: crypto,
    },
    {
      name: 'another method of Math',
      code: 'export const rounded = (value: number) => Math.floor(value * 100);',
      filename: certificate,
    },
    {
      name: 'a random on a receiver that is not Math, somebody’s own generator',
      code: "import { rng } from '../../platform/crypto/identifiers';\nexport const draw = () => rng.random();",
      filename: certificate,
    },
    {
      name: 'a package whose name merely starts alike',
      code: "import { odds } from 'chances';\nexport const o = odds;",
      filename: certificate,
    },
  ],
  invalid: [
    {
      name: 'the deprecated source as a named import',
      code: "import { pseudoRandomBytes } from 'node:crypto';\nexport const bytes = pseudoRandomBytes(8);",
      filename: certificate,
      errors: [{ messageId: 'weakSource', data: { name: 'pseudoRandomBytes' } }],
    },
    {
      name: 'Math.random called inside a certificate number, the fixture’s spelling',
      code: 'export function nextCertificateNumber(): string {\n  return `IJZ-${Math.floor(Math.random() * 1_000_000)}`;\n}',
      filename: certificate,
      errors: [{ messageId: 'weakSource', data: { name: 'Math.random' } }],
    },
    {
      name: 'Math.random referenced as a value, a call deferred',
      code: 'export const source = Math.random;',
      filename: certificate,
      errors: [{ messageId: 'weakSource', data: { name: 'Math.random' } }],
    },
    {
      name: 'Math.random read through a computed access',
      code: "export const draw = () => Math['random']();",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'Node’s deprecated non-cryptographic source',
      code: "import crypto from 'node:crypto';\nexport const draw = () => crypto.pseudoRandomBytes(16);",
      filename: certificate,
      errors: [{ messageId: 'weakSource', data: { name: 'pseudoRandomBytes' } }],
    },
    {
      name: 'the deprecated source on another receiver',
      code: "import * as nodeCrypto from 'crypto';\nexport const draw = nodeCrypto.pseudoRandomBytes;",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'the non-secure build of nanoid',
      code: "import { nanoid } from 'nanoid/non-secure';\nexport const next = nanoid;",
      filename: certificate,
      errors: [{ messageId: 'weakLibrary', data: { specifier: 'nanoid/non-secure' } }],
    },
    {
      name: 'seedrandom as a type-only import',
      code: "import type { PRNG } from 'seedrandom';\nexport type Generator = PRNG;",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'a type-only import written as an import type node',
      code: "export type Generator = import('random-seed').RandomSeed;",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'require',
      code: "const Chance = require('chance');\nexport default Chance;",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'import = require',
      code: "import prand = require('pure-rand');\nexport default prand;",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'export from',
      code: "export { default as seedrandom } from 'seedrandom';",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'a dynamic import',
      code: "export const load = () => import('chance');",
      filename: certificate,
      errors: 1,
    },
    {
      name: 'a test file, since no folder is exempt',
      code: 'export const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];',
      filename: test,
      errors: 1,
    },
    {
      name: 'a UI shuffle in the mobile app, since no folder is exempt',
      code: 'export const jitter = () => Math.random() * 100;',
      filename: mobile,
      errors: 1,
    },
  ],
});
