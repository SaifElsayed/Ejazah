// proc/no-bare-marker (R-PROC-8, both halves) against a table of code (T041).
//
// The two fixtures prove one bare marker and one block of commented-out code. This rule stays
// silent on far more than it refuses, and the silences are the decisions worth a test. A marker
// is read at the start of a comment only, so a sentence about a marker is prose and the rule can
// read its own header. A marker needs a ticket and not a reason, and a constitution id is not a
// ticket. Commented-out code needs a code signal and a parse into a real statement, so a sentence
// ending in a semicolon, a one-word comment, a prose paragraph, a directive, a doc block and a URL
// are all prose, while one dead statement is enough to be refused. A run of line comments is
// split where a line carries no signal, so prose followed directly by dead code reports the code
// alone and the reader is told exactly which lines to delete.
//
// The marker words below appear inside JavaScript strings only, so this file passes the rule it
// tests when the fast set lints it.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const booking = 'apps/api/src/modules/booking/hold-expiry.ts';
const chat = 'apps/api/src/modules/chat/attachment-filter.ts';

typescriptRuleTester().run('proc/no-bare-marker', loadRule('no-bare-marker.js'), {
  valid: [
    {
      name: 'a marker carrying a Jira-style ticket in its parentheses',
      code: '// TODO(IJZ-231): release the hold once the order expires\nexport const holds = [];',
      filename: booking,
    },
    {
      name: 'a marker carrying a Spec Kit task and a GitHub number',
      code: '// FIXME T041 and #12 track the hold release\nexport const holds = [];',
      filename: booking,
    },
    {
      name: 'a marker word in the middle of a sentence, which is prose about a marker',
      code: '// this is the bug that ships silently, and a bare TODO would hide it\nexport const holds = [];',
      filename: booking,
    },
    {
      name: 'a prose sentence that happens to end in a semicolon',
      code: '// chose;\nexport const holds = [];',
      filename: booking,
    },
    {
      name: 'a one-word comment, which parses as a bare word and nothing more',
      code: '// fallback\nexport const holds = [];',
      filename: booking,
    },
    {
      name: 'a prose paragraph across several lines',
      code: '// The hold is released by the worker once the order expires, never by the request\n// that created it, so a retry of the request cannot release a hold that a later\n// order already paid for.\nexport const holds = [];',
      filename: booking,
    },
    {
      name: 'a lint directive carrying its own justification',
      code: "// eslint-disable-next-line no-console -- the boot banner is printed on purpose, IJZ-1\nconsole.log('ready');",
      filename: booking,
    },
    {
      name: 'a compiler directive carrying its own justification',
      code: "// @ts-expect-error the vendor typings omit the callback, IJZ-1\nexport const count: number = 'many';",
      filename: booking,
    },
    {
      name: 'a doc block, even one quoting a line of code',
      code: '/**\n * Releases the hold. Call it as `release(hold);` from the worker only.\n */\nexport const release = (hold: string) => hold;',
      filename: booking,
    },
    {
      name: 'a URL comment',
      code: '// see https://developer.mozilla.org/en-US/docs/Web/API/Date\nexport const holds = [];',
      filename: booking,
    },
  ],
  invalid: [
    {
      name: 'the canonical bare marker',
      code: '// TODO: release the hold once the order expires\nexport function holdsToRelease(): readonly string[] {\n  return [];\n}',
      filename: booking,
      errors: [{ messageId: 'bareMarker', data: { marker: 'TODO' } }],
    },
    {
      name: 'a bare marker in a block comment',
      code: '/* FIXME release the hold */\nexport const holds = [];',
      filename: booking,
      errors: [{ messageId: 'bareMarker', data: { marker: 'FIXME' } }],
    },
    {
      name: 'a bare JSDoc tag opening the block',
      code: '/**\n * @todo release it once the order expires\n */\nexport const holds = [];',
      filename: booking,
      errors: [{ messageId: 'bareMarker', data: { marker: 'TODO' } }],
    },
    {
      name: 'a marker in lower case',
      code: '// hack: the worker polls instead of listening\nexport const holds = [];',
      filename: booking,
      errors: [{ messageId: 'bareMarker', data: { marker: 'HACK' } }],
    },
    {
      name: 'a marker carrying a constitution id, which is not a ticket',
      code: '// TODO(R-PROC-8): release the hold once the order expires\nexport const holds = [];',
      filename: booking,
      errors: [{ messageId: 'bareMarker', data: { marker: 'TODO' } }],
    },
    {
      name: 'the canonical block of commented-out code',
      code: "export function allowedAttachmentExtensions(): readonly string[] {\n  return ['pdf', 'txt'];\n}\n\n// export function allowedAttachmentExtensionsWithImages(): readonly string[] {\n//   return ['pdf', 'txt', 'png', 'jpg'];\n// }",
      filename: chat,
      errors: [{ messageId: 'commentedOutCode' }],
    },
    {
      name: 'a single commented-out statement',
      code: '// const limit = 1;\nexport const holds = [];',
      filename: chat,
      errors: [{ messageId: 'commentedOutCode' }],
    },
    {
      name: 'a block comment holding code',
      code: '/*\nconst allowed = extensions();\npublish(allowed);\n*/\nexport const holds = [];',
      filename: chat,
      errors: [{ messageId: 'commentedOutCode' }],
    },
    {
      name: 'a commented-out call',
      code: '// publish(result);\nexport const holds = [];',
      filename: chat,
      errors: [{ messageId: 'commentedOutCode' }],
    },
    {
      name: 'prose followed directly by dead code, which reports the code alone',
      code: '// we used to publish the result here, before the worker took it over\n// publish(result);\n// notify(result);\nexport const holds = [];',
      filename: chat,
      errors: [{ messageId: 'commentedOutCode' }],
    },
    {
      name: 'a bare marker and dead code in one file, each reported',
      code: '// TODO: restore this once the worker is deployed\n// publish(result);\nexport const holds = [];',
      filename: chat,
      errors: [{ messageId: 'bareMarker' }, { messageId: 'commentedOutCode' }],
    },
  ],
});
