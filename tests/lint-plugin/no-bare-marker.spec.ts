// proc/no-bare-marker (R-PROC-8) against a table of code (T041).
//
// The two fixtures prove a marker with no ticket and a commented-out function. This table is
// mostly about what must NOT be refused, because that is where a rule reading comments goes
// wrong: a sentence that mentions a marker word, a comment that ends in a semicolon, a label and
// a word, documentation that shows an example after explaining it.
//
// The marker words are assembled from parts so that this file, which `pnpm lint` reads with the
// very rule it tests, has none of its own in a comment.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const file = 'apps/api/src/modules/booking/hold-expiry.ts';

const MARK = ['TO', 'DO'].join('');
const FIX = ['FIX', 'ME'].join('');

typescriptRuleTester().run('proc/no-bare-marker', loadRule('no-bare-marker.js'), {
  valid: [
    {
      name: 'a marker with a task id',
      code: `// ${MARK}(T057): release the hold once the order expires\nexport const a = 1;`,
      filename: file,
    },
    {
      name: 'a marker with the ticket later in the same comment',
      code: `// ${MARK}: release the hold once the order expires, see #123\nexport const a = 1;`,
      filename: file,
    },
    {
      name: 'a marker with a tracker key, in a block comment',
      code: `/*\n * ${FIX} SCRUM-51\n * the expiry races the webhook\n */\nexport const a = 1;`,
      filename: file,
    },
    {
      name: 'a sentence that mentions a marker word mid-line',
      code: `// The harness prints a bare ${MARK} as a failure, which is the point.\nexport const a = 1;`,
      filename: file,
    },
    {
      name: 'a word that only starts like a marker',
      code: `// ${MARK}s are tracked in tasks.md; XXXL is a size.\nexport const a = 1;`,
      filename: file,
    },
    {
      name: 'a placeholder test is code, not a comment',
      code: "it.todo('T096: a repeated operation returns the first outcome');",
      filename: file,
    },
    {
      name: 'a comment that quotes a placeholder call is prose about code',
      code: '// A describing case such as `it.todo(…)` names a constraint without breaching one.\nexport const a = 1;',
      filename: file,
    },
    {
      name: 'prose ending in a semicolon',
      code: '// Services decide; repositories fetch;\n// that is the whole rule;\nexport const a = 1;',
      filename: file,
    },
    {
      name: 'prose ending in a brace',
      code: '// The shape is { code, message, details? }\nexport const a = 1;',
      filename: file,
    },
    {
      name: 'a label and a word',
      code: '// Note: important;\nexport const a = 1;',
      filename: file,
    },
    {
      name: 'a lone name',
      code: '// deprecated;\n// booking.confirmEnrollment;\nexport const a = 1;',
      filename: file,
    },
    {
      name: 'documentation that explains and then shows an example',
      code: [
        '// Selection is configuration, never a code change:',
        '//',
        '//   providers: [{ provide: STORAGE_PORT, useClass: LocalStorageAdapter }];',
        '//',
        '// and no module branches on which adapter is active.',
        'export const a = 1;',
      ].join('\n'),
      filename: file,
    },
    {
      name: 'a JSDoc block with an example',
      code: [
        '/**',
        ' * Resolves one occurrence.',
        ' * @example',
        ' *   const at = resolveLocalDateTime({ localDate, localTime, timezone });',
        ' */',
        'export const a = 1;',
      ].join('\n'),
      filename: file,
    },
    {
      name: 'a directive comment is not code',
      code: '// @ts-expect-error T030/FR-012: a plain number is not assignable;\nexport const a: string = 1;',
      filename: file,
    },
    {
      name: 'a trailing comment naming a value',
      code: 'export const ttl = 600; // seconds;',
      filename: file,
    },
    {
      name: 'Arabic prose',
      code: '// هذا تعليق عربي؛ لا شيء هنا شيفرة;\nexport const a = 1;',
      filename: file,
    },
  ],
  invalid: [
    {
      name: 'the fixture: a bare marker',
      code: `// ${MARK}: release the hold once the order expires\nexport const a = 1;`,
      filename: file,
      errors: [{ messageId: 'bareMarker', data: { marker: MARK }, line: 1 }],
    },
    {
      name: 'a marker with no colon',
      code: `// ${MARK} release the hold\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'the other markers',
      code: `// ${FIX}: the expiry races the webhook\n// HACK around the provider\n// XXX\nexport const a = 1;`,
      filename: file,
      errors: [
        { messageId: 'bareMarker', data: { marker: FIX } },
        { messageId: 'bareMarker', data: { marker: 'HACK' } },
        { messageId: 'bareMarker', data: { marker: 'XXX' } },
      ],
    },
    {
      name: 'a lower-case marker with a colon',
      code: `// ${MARK.toLowerCase()}: release the hold\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a marker with a parenthesised name instead of a ticket',
      code: `// ${MARK}(amr): release the hold\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a marker later in a sentence',
      code: `// this works for now. ${MARK}: release the hold\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a marker inside a block comment',
      code: `/**\n * Expires holds.\n * ${MARK}: release the hold\n */\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a JSDoc tag',
      code: `/** @${MARK.toLowerCase()}: release the hold */\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a trailing marker',
      code: `export const a = 1; // ${MARK}: make this a setting`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a rule id is not a ticket',
      code: `// ${MARK}: read this from settings, R-MONEY-12\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a requirement id is not a ticket',
      code: `// ${MARK}(FR-BOOK-9): release the hold\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a ticket on the next comment line belongs to another comment',
      code: `// ${MARK}: release the hold\n// tracked in T057\nexport const a = 1;`,
      filename: file,
      errors: 1,
    },
    {
      name: 'the fixture: a commented-out function',
      code: [
        'export function allowed(): readonly string[] {',
        "  return ['pdf', 'txt'];",
        '}',
        '',
        '// export function allowedWithImages(): readonly string[] {',
        "//   return ['pdf', 'txt', 'png', 'jpg'];",
        '// }',
      ].join('\n'),
      filename: 'apps/api/src/modules/chat/attachment-filter.ts',
      errors: [{ messageId: 'commentedCode', line: 5, endLine: 7 }],
    },
    {
      name: 'a commented-out statement',
      code: '// await push.send(studentId, payload);\nexport const a = 1;',
      filename: file,
      errors: [{ messageId: 'commentedCode' }],
    },
    {
      name: 'a commented-out declaration and import',
      code: "// import { push } from '../../platform/ports/push';\n// const ttl = 600;\nexport const a = 1;",
      filename: file,
      errors: 1,
    },
    {
      name: 'commented-out control flow that only parses inside a function',
      code: '// if (hold.expired) {\n//   return release(hold);\n// }\nexport const a = 1;',
      filename: file,
      errors: 1,
    },
    {
      name: 'a commented-out block comment',
      code: '/*\nexport const ttl = 600;\nrelease(hold);\n*/\nexport const a = 1;',
      filename: file,
      errors: 1,
    },
    {
      name: 'a commented-out assignment',
      code: '// hold.releasedAt = now;\nexport const a = 1;',
      filename: file,
      errors: 1,
    },
    {
      name: 'commented-out TypeScript',
      code: '// interface Hold { readonly id: string; }\n// type Id = Hold["id"];\nexport const a = 1;',
      filename: file,
      errors: 1,
    },
    {
      name: 'two separate runs of commented-out code',
      code: '// release(a);\n\n// release(b);\nexport const a = 1;',
      filename: file,
      errors: 2,
    },
    {
      name: 'commented-out code in a JavaScript file',
      code: '// const ttl = 600;\nmodule.exports = {};',
      filename: 'scripts/x.js',
      errors: 1,
    },
    {
      name: 'commented-out JSX in a tsx file',
      code: '// const el = <Text>{label}</Text>;\nexport const a = 1;',
      filename: 'apps/mobile/src/features/shared/row.tsx',
      errors: 1,
    },
  ],
});
