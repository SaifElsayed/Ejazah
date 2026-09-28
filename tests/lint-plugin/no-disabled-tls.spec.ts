// sec/no-disabled-tls (R-SEC-11) against a table of code (T040).
//
// The fixture proves `rejectUnauthorized: false` in an options object. This table proves how far
// "and equivalents" was decided to reach: any value other than the literal `true` — a comparison,
// a config read, a negation — because "in any environment" leaves no environment for a switch to
// select; the quoted and computed spellings of the key; an assignment to the option after the
// fact; `strictSSL`, the same switch under the `request` family's name; the process-wide
// environment variable in each of the three ways code can name it; a `checkServerIdentity` that
// cannot fail; and `insecureHTTPParser: true`.
//
// The valid table holds the shapes the header says are not values or not switches: `true` itself,
// the fixture's own interface (`readonly rejectUnauthorized: boolean` declares a shape), a pinning
// `checkServerIdentity` that can throw, and the protocol floor `minVersion`, which is configuration.
// No folder is exempt, so a test file has a row in the invalid table.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const transport = 'apps/api/src/platform/ports/sms/sms.transport.ts';
const test = 'apps/api/src/platform/ports/sms/sms.transport.spec.ts';
const mobile = 'apps/mobile/src/lib/client.ts';

// The process switch, spelled from parts so this file does not name it and refuse itself.
const processSwitch = ['NODE_TLS', 'REJECT_UNAUTHORIZED'].join('_');

typescriptRuleTester().run('sec/no-disabled-tls', loadRule('no-disabled-tls.js'), {
  valid: [
    {
      name: 'reading the option by destructuring, which sets nothing',
      code: 'export function verify(options: { rejectUnauthorized: boolean }): boolean {\n  const { rejectUnauthorized } = options;\n  return rejectUnauthorized;\n}',
      filename: transport,
    },
    {
      name: 'verification written on, which is the default made explicit',
      code: "export const options = { host: 'sms.example.invalid', rejectUnauthorized: true };",
      filename: transport,
    },
    {
      name: 'the fixture’s interface, which declares a shape and is not a value',
      code: 'export interface TransportOptions {\n  readonly host: string;\n  readonly rejectUnauthorized: boolean;\n}',
      filename: transport,
    },
    {
      name: 'the option omitted, which is the correct spelling',
      code: "export const options = { host: 'sms.example.invalid', port: 443 };",
      filename: transport,
    },
    {
      name: 'a pinning checkServerIdentity that can throw',
      code: "declare const PIN: string;\nexport const options = {\n  checkServerIdentity: (host: string, cert: { fingerprint256: string }) => {\n    if (cert.fingerprint256 !== PIN) throw new Error('certificate does not match the pin');\n  },\n};",
      filename: transport,
    },
    {
      name: 'a checkServerIdentity that returns the error the platform’s check found',
      code: "import tls from 'node:tls';\nexport const options = {\n  checkServerIdentity: (host: string, cert: tls.PeerCertificate) => tls.checkServerIdentity(host, cert),\n};",
      filename: transport,
    },
    {
      name: 'strictSSL written on',
      code: 'export const options = { strictSSL: true };',
      filename: transport,
    },
    {
      name: 'the lenient parser written off',
      code: 'export const options = { insecureHTTPParser: false };',
      filename: transport,
    },
    {
      name: 'a protocol floor, which is configuration and not a verification switch',
      code: "export const options = { minVersion: 'TLSv1.2', secureProtocol: 'TLSv1_2_method' };",
      filename: transport,
    },
    {
      name: 'an unrelated environment variable',
      code: 'export const environment = process.env.NODE_ENV;',
      filename: transport,
    },
  ],
  invalid: [
    {
      name: 'a class field switching verification off',
      code: 'export class Transport {\n  rejectUnauthorized = false;\n}',
      filename: transport,
      errors: [{ messageId: 'verificationOff', data: { name: 'rejectUnauthorized' } }],
    },
    {
      name: 'verification switched off in an options object, the fixture’s spelling',
      code: "export interface TransportOptions {\n  readonly host: string;\n  readonly rejectUnauthorized: boolean;\n}\n\nexport const smsTransportOptions: TransportOptions = {\n  host: 'sms.example.invalid',\n  rejectUnauthorized: false,\n};",
      filename: transport,
      errors: [{ messageId: 'verificationOff', data: { name: 'rejectUnauthorized' } }],
    },
    {
      name: 'verification made conditional on the environment',
      code: "export const options = { rejectUnauthorized: process.env.NODE_ENV === 'production' };",
      filename: transport,
      errors: [{ messageId: 'verificationOff', data: { name: 'rejectUnauthorized' } }],
    },
    {
      name: 'verification read from a variable, the same switch with a longer wire',
      code: 'declare const config: { tls: { verify: boolean } };\nexport const options = { rejectUnauthorized: config.tls.verify };',
      filename: transport,
      errors: 1,
    },
    {
      name: 'the key quoted',
      code: "export const options = { 'rejectUnauthorized': false };",
      filename: transport,
      errors: [{ messageId: 'verificationOff', data: { name: 'rejectUnauthorized' } }],
    },
    {
      name: 'the key computed from a string',
      code: "export const options = { ['rejectUnauthorized']: false };",
      filename: transport,
      errors: 1,
    },
    {
      name: 'the option assigned after the object is built',
      code: 'declare const options: { rejectUnauthorized?: boolean };\noptions.rejectUnauthorized = false;',
      filename: transport,
      errors: [{ messageId: 'verificationOff', data: { name: 'rejectUnauthorized' } }],
    },
    {
      name: 'the option assigned through a computed member',
      code: "declare const options: Record<string, boolean>;\noptions['rejectUnauthorized'] = false;",
      filename: transport,
      errors: 1,
    },
    {
      name: 'strictSSL, the request family’s name for the same switch',
      code: 'export const options = { strictSSL: false };',
      filename: transport,
      errors: [{ messageId: 'verificationOff', data: { name: 'strictSSL' } }],
    },
    {
      name: 'the process switch written as an identifier',
      code: `process.env.${processSwitch} = '0';`,
      filename: transport,
      errors: [{ messageId: 'processSwitch' }],
    },
    {
      name: 'the process switch read as a string',
      code: `export const off = process.env['${processSwitch}'] === '0';`,
      filename: transport,
      errors: [{ messageId: 'processSwitch' }],
    },
    {
      name: 'the process switch named inside a template',
      code: `export const command = \`${processSwitch}=0 node server.js\`;`,
      filename: transport,
      errors: [{ messageId: 'processSwitch' }],
    },
    {
      name: 'a checkServerIdentity with an empty body, which accepts every certificate',
      code: 'export const options = { checkServerIdentity: () => {} };',
      filename: transport,
      errors: [{ messageId: 'acceptsAnyCertificate' }],
    },
    {
      name: 'a checkServerIdentity whose expression body is undefined',
      code: 'export const options = { checkServerIdentity: () => undefined };',
      filename: transport,
      errors: [{ messageId: 'acceptsAnyCertificate' }],
    },
    {
      name: 'a checkServerIdentity method that only returns nothing',
      code: 'export const options = {\n  checkServerIdentity() {\n    return;\n  },\n};',
      filename: transport,
      errors: [{ messageId: 'acceptsAnyCertificate' }],
    },
    {
      name: 'the lenient parser switched on',
      code: 'export const options = { insecureHTTPParser: true };',
      filename: transport,
      errors: [{ messageId: 'insecureParser' }],
    },
    {
      name: 'a test switching verification off to talk to a stand-in, the local "temporarily"',
      code: "export const stubOptions = { host: '127.0.0.1', rejectUnauthorized: false };",
      filename: test,
      errors: 1,
    },
    {
      name: 'the mobile client, since no folder is exempt',
      code: 'export const options = { rejectUnauthorized: !__DEV__ };',
      filename: mobile,
      errors: 1,
    },
  ],
});
