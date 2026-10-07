// sec/no-disabled-tls (R-SEC-11) against a table of code (T040).
//
// The fixture proves the one spelling the constitution names, `rejectUnauthorized: false`. This
// table proves the equivalents T040 decided on — the same option set any other way, the
// process-wide environment switch, an identity check that cannot fail, the lenient parser — and
// the legal neighbours of each: the literal `true`, the type of the option, a check that calls
// the default.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const adapter = 'apps/api/src/platform/ports/sms/provider.adapter.ts';

// Assembled, as in the rule, so this file does not name the switch `pnpm lint` refuses.
const SWITCH = ['NODE', 'TLS', 'REJECT', 'UNAUTHORIZED'].join('_');
// Windows environment names are case-insensitive, so the lower-case spelling is the same switch.
const LOWER_SWITCH = SWITCH.toLowerCase();
// The connection-string parameters, assembled for the same reason.
const PRISMA_UNVERIFIED = ['sslaccept', 'accept_invalid_certs'].join('=');
const PG_UNVERIFIED = ['sslmode', 'no-verify'].join('=');

typescriptRuleTester().run('sec/no-disabled-tls', loadRule('no-disabled-tls.js'), {
  valid: [
    {
      name: 'verification left at its default',
      code: "export const options = { host: 'sms.example.invalid' };",
      filename: adapter,
    },
    {
      name: 'the literal true',
      code: 'export const options = { rejectUnauthorized: true, strictSSL: true as const };',
      filename: adapter,
    },
    {
      name: 'the type of the option is not a value',
      code: 'export interface TransportOptions { readonly rejectUnauthorized: boolean; strictSSL?: boolean }',
      filename: adapter,
    },
    {
      name: 'a class field declared without a value',
      code: 'export class Transport { declare rejectUnauthorized: boolean; }',
      filename: adapter,
    },
    {
      name: 'reading the option out of an object',
      code: 'export const read = ({ rejectUnauthorized }: { rejectUnauthorized: boolean }) => rejectUnauthorized;',
      filename: adapter,
    },
    {
      name: 'an identity check that calls the default',
      code: "import tls from 'node:tls';\nexport const options = { checkServerIdentity: (host: string, cert: never) => tls.checkServerIdentity(host, cert) };",
      filename: adapter,
    },
    {
      name: 'an identity check that can throw',
      code: 'export const options = { checkServerIdentity(host: string, cert: { pinned: boolean }) { if (!cert.pinned) { throw new Error(host); } } };',
      filename: adapter,
    },
    {
      name: 'an identity check that returns an error',
      code: 'export const options = { checkServerIdentity: (host: string) => mismatch(host) };',
      filename: adapter,
    },
    {
      name: 'an identity check that returns what the default check answers',
      code: "import tls from 'node:tls';\nexport const options = { checkServerIdentity(host: string, cert: never) { const error = tls.checkServerIdentity(host, cert); if (error) return error; return undefined; } };",
      filename: adapter,
    },
    {
      name: 'an identity check that returns the call from a block',
      code: "import tls from 'node:tls';\nexport const options = { checkServerIdentity: (host: string, cert: never) => { return tls.checkServerIdentity(host, cert); } };",
      filename: adapter,
    },
    {
      name: 'an identity check that is a reference to a function defined elsewhere',
      code: 'export const options = { checkServerIdentity: pinnedIdentityCheck };',
      filename: adapter,
    },
    {
      name: 'a connection string that verifies, and one with TLS off altogether',
      code: "export const a = 'postgresql://app@db.example.invalid/ijazah?sslmode=verify-full';\nexport const b = 'postgresql://app@localhost/ijazah?sslmode=disable';\nexport const c = 'postgresql://app@db.example.invalid/ijazah?sslaccept=strict';",
      filename: adapter,
    },
    {
      name: 'the switch assigned a value that is not zero',
      code: `export const command = '${SWITCH}=1 node server.js';`,
      filename: adapter,
    },
    {
      name: 'the switch assigned a value that is not zero, quoted or longer',
      code: [
        `export const a = '${SWITCH}="1" node server.js';`,
        `export const b = "${SWITCH}='1'";`,
        `export const c = '${SWITCH}=01';`,
        `export const d = '${SWITCH}=0.5';`,
        `export const e = '${SWITCH} = 10';`,
        `export const f = (entry: string) => \`${SWITCH}=1 \${entry}\`;`,
      ].join('\n'),
      filename: adapter,
    },
    {
      name: 'prose that names the switch and assigns it nothing',
      code: [
        `export const a = 'set ${SWITCH} to 0 and verification is off';`,
        `export const b = '${SWITCH}: the process-wide switch, never set';`,
        `export const c = (file: string) => \`${SWITCH} was found in \${file}\`;`,
        `export const d = (file: string) => \`${SWITCH}: \${file}\`;`,
      ].join('\n'),
      filename: adapter,
    },
    {
      name: 'an identity check with an alternative that can be an error',
      code: [
        "import tls from 'node:tls';",
        'export const a = { checkServerIdentity: (host: string, pinned: boolean) => (pinned ? undefined : new Error(host)) };',
        'export const b = { checkServerIdentity(host: string, cert: never) { return tls.checkServerIdentity(host, cert) || undefined; } };',
        'export const c = { checkServerIdentity: (host: string, cert: never) => (audit(host), tls.checkServerIdentity(host, cert)) };',
        'export const d = { checkServerIdentity(host: string, error?: Error) { return error ?? null; } };',
        'export const e = { checkServerIdentity: () => !0 };',
      ].join('\n'),
      filename: adapter,
    },
    {
      name: 'a dead or locally caught throw still counts as able to fail, and is review’s',
      code: [
        'export const a = { checkServerIdentity(host: string) { return undefined; throw new Error(host); } };',
        'export const b = { checkServerIdentity(host: string) { try { throw new Error(host); } catch { return undefined; } } };',
      ].join('\n'),
      filename: adapter,
    },
    {
      name: 'the strict parser',
      code: 'export const options = { insecureHTTPParser: false };',
      filename: adapter,
    },
    {
      name: 'a sentence that merely mentions the switch',
      code: `export const help = 'never set ${SWITCH} in any environment';`,
      filename: adapter,
    },
    {
      name: 'another environment variable',
      code: 'export const ca = process.env.NODE_EXTRA_CA_CERTS;',
      filename: adapter,
    },
    {
      // A template literal TYPE holds its holes in `types`, not `expressions`; the rule judges
      // run-time strings only and leaves it alone (found 2026-10-07 by batch K2).
      name: 'a template literal type, with and without a hole',
      code: 'export type Path<K extends string> = `${K}.x`;\nexport type Fixed = `a.x`;',
      filename: adapter,
    },
  ],
  invalid: [
    {
      name: 'the fixture: rejectUnauthorized false',
      code: "export const options = { host: 'sms.example.invalid', rejectUnauthorized: false };",
      filename: adapter,
      errors: [{ messageId: 'verificationOff', data: { name: 'rejectUnauthorized' } }],
    },
    {
      name: 'a quoted key',
      code: "export const options = { 'rejectUnauthorized': false };",
      filename: adapter,
      errors: 1,
    },
    {
      name: 'a computed string key',
      code: "export const options = { ['rejectUnauthorized']: false };",
      filename: adapter,
      errors: 1,
    },
    {
      name: 'strictSSL',
      code: 'export const options = { strictSSL: false };',
      filename: adapter,
      errors: [{ messageId: 'verificationOff', data: { name: 'strictSSL' } }],
    },
    {
      name: 'zero, and a cast false',
      code: 'export const a = { rejectUnauthorized: 0 };\nexport const b = { rejectUnauthorized: false as boolean };',
      filename: adapter,
      errors: 2,
    },
    {
      name: 'a variable decides',
      code: 'export const options = (isProduction: boolean) => ({ rejectUnauthorized: isProduction });',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the environment decides',
      code: "export const options = { rejectUnauthorized: process.env.NODE_ENV === 'production' };",
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the shorthand',
      code: 'export const options = (rejectUnauthorized: boolean) => ({ rejectUnauthorized });',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'nested inside another option',
      code: 'export const pool = { ssl: { rejectUnauthorized: false } };',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'inside a constructor call',
      code: "import https from 'node:https';\nexport const agent = new https.Agent({ rejectUnauthorized: false });",
      filename: adapter,
      errors: 1,
    },
    {
      name: 'Object.assign',
      code: 'export const patch = (options: object) => Object.assign(options, { rejectUnauthorized: false });',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'an assignment, dotted',
      code: 'export function off(options: { rejectUnauthorized?: boolean }) { options.rejectUnauthorized = false; }',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'an assignment, computed, behind a cast',
      code: "export function off(options: object) { (options as any)['strictSSL'] = false; }",
      filename: adapter,
      errors: 1,
    },
    {
      name: 'Object.defineProperty and Reflect.set',
      code: "export function off(o: object) { Object.defineProperty(o, 'rejectUnauthorized', { value: false }); Reflect.set(o, 'rejectUnauthorized', false); }",
      filename: adapter,
      errors: 2,
    },
    {
      name: 'a class field',
      code: 'export class Transport { rejectUnauthorized = false; }',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'a private class field and a private member assigned',
      code: 'export class Transport {\n  #rejectUnauthorized = false;\n  off() { this.#rejectUnauthorized = false; }\n}',
      filename: adapter,
      errors: [
        { messageId: 'verificationOff', data: { name: 'rejectUnauthorized' }, line: 2 },
        { messageId: 'verificationOff', data: { name: 'rejectUnauthorized' }, line: 3 },
      ],
    },
    {
      name: 'the environment switch written',
      code: `process.env.${SWITCH} = '0';`,
      filename: adapter,
      errors: [{ messageId: 'environmentSwitch' }],
    },
    {
      name: 'the environment switch by computed name',
      code: `process.env['${SWITCH}'] = '0';`,
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the environment switch by a template-literal name',
      code: `process.env[\`${SWITCH}\`] = '0';`,
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the environment switch read',
      code: `export const off = process.env.${SWITCH} === '0';`,
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the environment switch handed to a child process',
      code: `export const env = { ...process.env, ${SWITCH}: '0' };`,
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the environment switch destructured',
      code: `export const { ${SWITCH}: off } = process.env;`,
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the environment switch as a bare name',
      code: `export const name = '${SWITCH}';`,
      filename: adapter,
      errors: 1,
    },
    {
      name: 'an identity check that returns undefined',
      code: 'export const options = { checkServerIdentity: () => undefined };',
      filename: adapter,
      errors: [{ messageId: 'identityUnchecked' }],
    },
    {
      name: 'an identity check with an empty body',
      code: 'export const options = { checkServerIdentity() {} };',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'an identity check that returns null, void 0 or nothing',
      code: 'export const a = { checkServerIdentity: () => null };\nexport const b = { checkServerIdentity: function () { return void 0; } };\nexport const c = { checkServerIdentity: () => { return; } };',
      filename: adapter,
      errors: 3,
    },
    {
      name: 'an identity check that calls the default and drops the answer',
      code: "import tls from 'node:tls';\nexport const options = { checkServerIdentity(host: string, cert: never) { tls.checkServerIdentity(host, cert); } };",
      filename: adapter,
      errors: [{ messageId: 'identityUnchecked' }],
    },
    {
      name: 'an identity check that only logs',
      code: "export const options = { checkServerIdentity: () => { logger.debug('skip'); } };",
      filename: adapter,
      errors: [{ messageId: 'identityUnchecked' }],
    },
    {
      name: 'an identity check that calls, constructs and returns nothing',
      code: 'export const options = { checkServerIdentity: function (host: string) { audit(host); new Probe(host); return undefined; } };',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'an identity check whose only throw is inside a callback it never awaits',
      code: 'export const options = { checkServerIdentity(host: string) { later(() => { throw new Error(host); }); } };',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'an expression-bodied identity check that discards the answer',
      code: 'export const options = { checkServerIdentity: (host: string) => void verify(host) };',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'a Prisma connection string that accepts invalid certificates',
      code: `export const url = 'postgresql://app@db.example.invalid/ijazah?${PRISMA_UNVERIFIED}';`,
      filename: adapter,
      errors: [{ messageId: 'unverifiedConnection', data: { parameter: PRISMA_UNVERIFIED } }],
    },
    {
      name: 'a node-postgres connection string that does not verify, in upper case',
      code: `export const url = 'postgresql://app@db.example.invalid/ijazah?${PG_UNVERIFIED.toUpperCase()}&x=1';`,
      filename: adapter,
      errors: [{ messageId: 'unverifiedConnection', data: { parameter: PG_UNVERIFIED } }],
    },
    {
      name: 'the parameter in the text of a template literal with values in it',
      code: `export const url = (host: string) => \`postgresql://app@\${host}/ijazah?${PG_UNVERIFIED}\`;`,
      filename: adapter,
      errors: [{ messageId: 'unverifiedConnection' }],
    },
    {
      name: 'the environment switch assigned inside a command line',
      code: `export const command = '${SWITCH}=0 node server.js';\nexport const script = \`cross-env ${SWITCH}=0 \${entry}\`;`,
      filename: adapter,
      errors: [
        { messageId: 'environmentSwitch', data: { name: SWITCH }, line: 1 },
        { messageId: 'environmentSwitch', data: { name: SWITCH }, line: 2 },
      ],
    },
    {
      name: 'the switch assigned zero in every spelling a shell, a dotenv file or a YAML file takes',
      code: [
        `export const a = '${SWITCH}="0" node x.js';`,
        `export const b = "${SWITCH}='0' node x.js";`,
        `export const c = '${SWITCH} = 0';`,
        `export const d = '${SWITCH}: 0';`,
        `export const e = 'env ${SWITCH}=0';`,
        `export const f = '${SWITCH}=0;';`,
      ].join('\n'),
      filename: adapter,
      errors: [1, 2, 3, 4, 5, 6].map((line) => ({
        messageId: 'environmentSwitch',
        data: { name: SWITCH },
        line,
      })),
    },
    {
      name: 'the switch assigned zero under its lower-case name',
      code: [
        `export const a = '${LOWER_SWITCH}=0';`,
        `export const b = 'set ${LOWER_SWITCH}="0" && node x.js';`,
      ].join('\n'),
      filename: adapter,
      errors: [
        { messageId: 'environmentSwitch', data: { name: SWITCH }, line: 1 },
        { messageId: 'environmentSwitch', data: { name: SWITCH }, line: 2 },
      ],
    },
    {
      name: 'the switch assigned whatever a value interpolated in place holds',
      code: [
        `export const a = (flag: string, entry: string) => \`cross-env ${SWITCH}=\${flag} node \${entry}\`;`,
        `export const b = (flag: string) => \`${SWITCH}="\${flag}"\`;`,
        `export const c = (flag: string) => \`${SWITCH} = \${flag}\`;`,
        `export const d = (flag: string) => \`${LOWER_SWITCH}=\${flag}\`;`,
      ].join('\n'),
      filename: adapter,
      errors: [1, 2, 3, 4].map((line) => ({
        messageId: 'environmentSwitch',
        data: { name: SWITCH },
        line,
      })),
    },
    {
      name: 'zero and an interpolated value in one piece of text are reported once',
      code: `export const a = (flag: string) => \`${SWITCH}=0 node a.js && ${SWITCH}=\${flag} node b.js\`;`,
      filename: adapter,
      errors: [{ messageId: 'environmentSwitch', data: { name: SWITCH } }],
    },
    {
      name: 'an identity check whose every returned alternative is falsy',
      code: [
        'export const a = { checkServerIdentity(host: string, x: boolean) { return x ? undefined : null; } };',
        'export const b = { checkServerIdentity(host: string) { return (1, undefined); } };',
        'export const c = { checkServerIdentity(host: string) { return undefined ?? null; } };',
        'export const d = { checkServerIdentity(host: string) { return NaN; } };',
        'export const e = { checkServerIdentity(host: string) { return -0; } };',
        'export const f = { checkServerIdentity(host: string) { return 0n; } };',
        'export const g = { checkServerIdentity(host: string) { return ``; } };',
        'export const h = { checkServerIdentity(host: string) { return !1; } };',
        'export const i = { checkServerIdentity(host: string) { return !true; } };',
        'export const j = { checkServerIdentity(host: string, x: boolean) { if (x) return false; return 0 || ""; } };',
      ].join('\n'),
      filename: adapter,
      errors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((line) => ({
        messageId: 'identityUnchecked',
        line,
      })),
    },
    {
      name: 'the same falsy alternatives as the expression body of an arrow',
      code: [
        'export const a = { checkServerIdentity: (host: string, x: boolean) => (x ? undefined : null) };',
        'export const b = { checkServerIdentity: () => (1, undefined) };',
        'export const c = { checkServerIdentity: () => undefined ?? null };',
        'export const d = { checkServerIdentity: () => NaN };',
        'export const e = { checkServerIdentity: () => -0 };',
        'export const f = { checkServerIdentity: () => 0n };',
        'export const g = { checkServerIdentity: () => `` };',
        'export const h = { checkServerIdentity: () => !1 };',
        'export const i = { checkServerIdentity: (host: string) => !"skip" };',
      ].join('\n'),
      filename: adapter,
      errors: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => ({
        messageId: 'identityUnchecked',
        line,
      })),
    },
    {
      name: 'an identity check assigned',
      code: 'export function off(options: { checkServerIdentity?: unknown }) { options.checkServerIdentity = () => undefined; }',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'the lenient parser',
      code: 'export const options = { insecureHTTPParser: true };',
      filename: adapter,
      errors: [{ messageId: 'insecureParser' }],
    },
    {
      name: 'the lenient parser left to a variable',
      code: 'export const options = (lenient: boolean) => ({ insecureHTTPParser: lenient });',
      filename: adapter,
      errors: 1,
    },
    {
      name: 'a test file is not exempt',
      code: 'export const options = { rejectUnauthorized: false };',
      filename: 'tests/ports/no-credentials.spec.ts',
      errors: 1,
    },
  ],
});
