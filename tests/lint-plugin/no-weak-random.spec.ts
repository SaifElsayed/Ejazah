// db/no-weak-random (R-DB-6) against a table of code (T040).
//
// The fixture proves `Math.random()`. This table proves the same generator reached any other way
// — computed, optional, through `globalThis`, destructured — the weak export of Node's `crypto`,
// and the bindings that only share the name `Math`.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const module_ = 'apps/api/src/modules/certification/certificate-number.ts';

typescriptRuleTester().run('db/no-weak-random', loadRule('no-weak-random.js'), {
  valid: [
    {
      name: 'the cryptographic source',
      code: "import { randomBytes, randomUUID, randomInt } from 'node:crypto';\nexport const id = () => [randomBytes(16), randomUUID(), randomInt(10)];",
      filename: module_,
    },
    {
      name: 'the rest of Math',
      code: 'export const f = (n: number) => Math.floor(Math.max(n, 1));',
      filename: module_,
    },
    {
      name: 'a parameter named Math',
      code: 'export const f = (Math: { random(): number }) => Math.random();',
      filename: module_,
    },
    {
      name: 'an import named Math',
      code: "import { Math } from './seeded';\nexport const f = () => Math.random();",
      filename: module_,
    },
    {
      name: 'a method named random on something else',
      code: 'export const f = (generator: { random(): number }) => generator.random();',
      filename: module_,
    },
    {
      name: 'destructuring random off something else',
      code: 'export const f = (generator: { random(): number }) => { const { random } = generator; return random(); };',
      filename: module_,
    },
    {
      name: 'the secure entry of nanoid',
      code: "import { nanoid } from 'nanoid';\nexport const id = () => nanoid();",
      filename: module_,
    },
    {
      name: 'crypto under another library name',
      code: "import { pseudoRandomBytes } from './test-doubles';\nexport const p = pseudoRandomBytes;",
      filename: module_,
    },
  ],
  invalid: [
    {
      name: 'the fixture: Math.random()',
      code: 'export const next = () => `IJZ-${Math.floor(Math.random() * 1_000_000)}`;',
      filename: module_,
      errors: [{ messageId: 'weakRandom', data: { name: 'Math.random' } }],
    },
    {
      name: 'a computed name',
      code: "export const r = () => Math['random']();",
      filename: module_,
      errors: 1,
    },
    {
      name: 'a template-literal name',
      code: 'export const r = () => Math[`random`]();',
      filename: module_,
      errors: 1,
    },
    {
      name: 'optional chaining',
      code: 'export const r = () => Math?.random();',
      filename: module_,
      errors: 1,
    },
    {
      name: 'an optional call',
      code: 'export const r = () => Math.random?.();',
      filename: module_,
      errors: 1,
    },
    {
      name: 'taken without being called',
      code: 'export const r = Math.random;',
      filename: module_,
      errors: 1,
    },
    {
      name: 'globalThis.Math',
      code: 'export const r = () => globalThis.Math.random();',
      filename: module_,
      errors: 1,
    },
    {
      name: 'the other holders, computed and cast',
      code: "export const a = () => window['Math'].random();\nexport const b = () => (self as any).Math.random();\nexport const c = () => global.Math!.random();",
      filename: module_,
      errors: 3,
    },
    {
      name: 'Math behind a cast',
      code: 'export const r = () => (Math as { random(): number }).random();',
      filename: module_,
      errors: 1,
    },
    {
      name: 'destructured off Math',
      code: 'const { random } = Math;\nexport const r = () => random();',
      filename: module_,
      errors: [{ messageId: 'weakRandom', data: { name: 'Math.random' } }],
    },
    {
      name: 'destructured and renamed off globalThis.Math',
      code: 'const { random: next, floor } = globalThis.Math;\nexport const r = () => floor(next());',
      filename: module_,
      errors: 1,
    },
    {
      name: 'destructured by assignment',
      code: 'let random: () => number;\n({ random } = Math);\nexport const r = () => random();',
      filename: module_,
      errors: 1,
    },
    {
      name: 'pseudoRandomBytes by name',
      code: "import { pseudoRandomBytes } from 'node:crypto';\nexport const r = () => pseudoRandomBytes(8);",
      filename: module_,
      errors: [{ messageId: 'weakRandom', data: { name: 'pseudoRandomBytes from node:crypto' } }],
    },
    {
      name: 'pseudoRandomBytes aliased, from the bare specifier',
      code: "import { pseudoRandomBytes as bytes } from 'crypto';\nexport const r = () => bytes(8);",
      filename: module_,
      errors: 1,
    },
    {
      name: 'pseudoRandomBytes through a namespace and a default binding',
      code: "import * as crypto from 'node:crypto';\nimport nodeCrypto from 'crypto';\nexport const a = () => crypto.pseudoRandomBytes(8);\nexport const b = () => nodeCrypto['pseudoRandomBytes'](8);",
      filename: module_,
      errors: 2,
    },
    {
      name: 'pseudoRandomBytes off require',
      code: "const { pseudoRandomBytes } = require('node:crypto');\nexport const a = pseudoRandomBytes;\nexport const b = require('crypto').pseudoRandomBytes;",
      filename: module_,
      errors: 2,
    },
    {
      name: 'the non-secure entry of nanoid',
      code: "import { nanoid } from 'nanoid/non-secure';\nexport const id = () => nanoid();",
      filename: module_,
      errors: [{ messageId: 'weakRandom', data: { name: 'nanoid/non-secure' } }],
    },
    {
      name: 'a script is not exempt',
      code: 'export const r = Math.random();',
      filename: 'scripts/seed-checksum.ts',
      errors: 1,
    },
  ],
});
