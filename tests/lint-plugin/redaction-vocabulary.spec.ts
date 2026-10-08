// T145 — the two copies of R-SEC-2's vocabulary agree: every key name `sec/no-body-logging` refuses
// as a prohibited value is also redacted by `isRedactedKey` in the logger (FR-040, FR-010, R-SEC-2;
// note under T144 and T145).
//
// The lint rule refuses a logger call handed a prohibited value by name; the logger's redaction
// list removes one nested where no rule can see it. They keep two copies of one vocabulary, as both
// headers say, and this table holds them together without building a shared list. The logger may
// know more words than the rule (`code`, `card`, `event`, a storage key, a bare `body`); the rule
// may not know a word the logger does not.
//
// THE TABLE. Every word of the rule's vocabulary appears in a name the rule refuses, in its
// singular and in its plural. The plural is the word with an `s`, which is how the rule reads a
// plural (`tokens` as `token`), so it is the spelling the logger must read the same way. A word the
// rule only refuses beside another (`body` beside `request`) appears in that pair, and each word
// of the pair is pluralised in turn. English plurals the rule does not read as their singular
// (`bodies`, `accesses`, `expiries`) are refused by neither copy, so they are no row here.
//
// ORDER. Each row is first proved refused by the rule, so a row the rule accepts cannot pass for
// the wrong reason, and then proved redacted by the logger. A third check reads the rule's source
// and fails when it carries a word no row covers, so a word added to the rule fails the build
// until it has a row, and the row then fails until the logger redacts it.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRedactedKey } from '../../apps/api/src/platform/logging/logger';
import { repositoryRoot } from '../support/lint-contract';
import { loadRule, typescriptRuleTester } from '../support/rule-tester';

/** Words the rule refuses on their own. */
const alone = [
  'otp',
  'totp',
  'token',
  'authorization',
  'cookie',
  'cvv',
  'cvc',
  'password',
  'passwd',
  'secret',
  'credential',
];

/** Words the rule refuses only beside one of their companions: [heads, companions]. */
const together: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [['code'], ['mfa', 'verification', 'reset', 'login']],
  [['session'], ['auth']],
  [['body'], ['request', 'req', 'raw']],
  [['payload'], ['payment', 'gateway', 'webhook']],
  [
    ['url', 'uri', 'link'],
    [
      'document',
      'doc',
      'signed',
      'certificate',
      'attachment',
      'download',
      'upload',
      'presigned',
      'photo',
      'signature',
    ],
  ],
  [['payout'], ['ref', 'reference', 'account', 'recipient']],
  [['recipient'], ['ref', 'reference']],
  [['card'], ['number', 'pan', 'last', 'last4', 'digits', 'expiry', 'bin', 'fragment', 'holder']],
  [['key'], ['api', 'private', 'signing', 'secret', 'encryption', 'webhook', 'access']],
];

/** `one time code`, the one three-word entry. */
const oneTimeCode = ['one', 'time', 'code'];

const plural = (word: string): string => `${word}s`;

function camel(words: readonly string[]): string {
  return words
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase()}${word.slice(1)}`))
    .join('');
}

/** The words of an entry, each pluralised in turn, with the entry itself first. */
function spellings(words: readonly string[]): string[] {
  return [
    camel(words),
    ...words.map((_, index) =>
      camel(words.map((word, at) => (at === index ? plural(word) : word))),
    ),
  ];
}

const camelCase = [
  ...alone.flatMap((word) => [word, plural(word)]),
  ...together.flatMap(([heads, companions]) =>
    heads.flatMap((head) => companions.flatMap((companion) => spellings([companion, head]))),
  ),
  ...spellings(oneTimeCode),
];

/** The same words as other code writes them: snake_case, SCREAMING_CASE and a header's kebab-case. */
const otherCases = [
  'api_key',
  'API_KEY',
  'x-api-key',
  'refresh_tokens',
  'Set-Cookie',
  'card_number',
];

const table = [...new Set([...camelCase, ...otherCases])];

const module_ = 'apps/api/src/modules/identity/otp-request-log.ts';

typescriptRuleTester().run(
  'sec/no-body-logging refuses every row',
  loadRule('no-body-logging.js'),
  {
    valid: [],
    invalid: table.map((name) => ({
      name,
      code: `logger.info('event', { ${JSON.stringify(name)}: value });`,
      filename: module_,
      errors: [{ messageId: 'prohibitedValue' }],
    })),
  },
);

describe('the logger redacts every name the rule refuses (T145)', () => {
  it.each(table)('%s', (name) => {
    expect(isRedactedKey(name)).toBe(true);
  });
});

describe('the table covers the rule’s vocabulary (T145)', () => {
  // The words the rule's source spells out where it decides what is prohibited: its lists of
  // stored-file and one-time-code words, and every word literal in `prohibitedKind`.
  const source = readFileSync(
    path.join(repositoryRoot, 'packages/config/eslint-plugin-ijazah/rules/no-body-logging.js'),
    'utf8',
  );
  const decisions = [
    /const STORED_FILE_WORDS = \[[^\]]*\]/.exec(source)?.[0],
    /const ONE_TIME_CODE_WORDS = \[[^\]]*\]/.exec(source)?.[0],
    /function prohibitedKind\(name\) \{[\s\S]*?\n\}/.exec(source)?.[0],
  ];

  it('finds the three places the rule decides in', () => {
    expect(decisions.every((text) => text !== undefined)).toBe(true);
  });

  const vocabulary = [
    ...new Set(
      decisions.flatMap((text) =>
        [...(text ?? '').matchAll(/'([a-z0-9]+)'/g)].map(([, word]) => word ?? ''),
      ),
    ),
  ];
  const covered = new Set(
    [...alone, ...together.flat(2), ...oneTimeCode].map((word) => word.toLowerCase()),
  );

  it.each(vocabulary)('has a row for "%s"', (word) => {
    expect(covered.has(word)).toBe(true);
  });
});
