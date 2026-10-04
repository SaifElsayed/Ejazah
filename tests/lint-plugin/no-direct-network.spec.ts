// mobile/no-direct-network (R-MOBILE-11) against a table of code (T039).
//
// The fixture proves a bare `fetch(…)` call. This table proves that the global is refused however
// it is reached — referenced without a call, through `globalThis`, by a computed name — and that
// a binding which only shares the name is left alone: a function that takes `fetch` as a
// parameter is calling its parameter, which is how the shared client is handed to a hook.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/teacher/roster-refresh.ts';

typescriptRuleTester().run('mobile/no-direct-network', loadRule('no-direct-network.js'), {
  valid: [
    {
      name: 'lib/ holds the shared client',
      code: "export const call = (url: string) => fetch(url);\nexport const ws = () => new WebSocket('wss://example.invalid');",
      filename: 'apps/mobile/src/lib/client.ts',
    },
    {
      name: 'a feature going through the client',
      code: "import { trpc } from '../../lib/client';\nexport const roster = () => trpc.roster.list.query();",
      filename: feature,
    },
    {
      name: 'a parameter named fetch',
      code: 'export const load = (fetch: (id: string) => Promise<unknown>) => fetch("a");',
      filename: feature,
    },
    {
      name: 'a local binding named fetch',
      code: 'const fetch = (id: string) => id;\nexport const x = fetch("a");',
      filename: feature,
    },
    {
      name: 'an import named fetch',
      code: "import { fetch } from '../../lib/client';\nexport const x = () => fetch('a');",
      filename: feature,
    },
    {
      name: 'a destructured property named fetch',
      code: 'export const load = ({ fetch }: { fetch: () => void }) => fetch();',
      filename: feature,
    },
    {
      name: 'a method named fetch on something else',
      code: 'export const load = (query: { fetch(): void; refetch(): void }) => { query.fetch(); query.refetch(); };',
      filename: feature,
    },
    {
      name: 'a property key named like a global',
      code: 'export const options = { fetch: true, WebSocket: false };',
      filename: feature,
    },
    {
      name: 'a type position reaches nothing',
      code: 'export type Socket = WebSocket;\nexport type Fetcher = typeof fetch;\nexport declare const s: EventSource;',
      filename: feature,
    },
    {
      name: 'a local binding named globalThis',
      code: 'export const load = (globalThis: { fetch(): void }) => globalThis.fetch();',
      filename: feature,
    },
    {
      name: 'a package whose name merely starts alike',
      code: "import x from 'axios-mock-adapter-types';\nexport default x;",
      filename: feature,
    },
    {
      name: 'a file outside the mobile application',
      code: 'export const call = (url: string) => fetch(url);',
      filename: 'apps/api/src/platform/ports/sms/provider.adapter.ts',
    },
  ],
  invalid: [
    {
      name: 'the fixture: a bare fetch call',
      code: 'export const refresh = async (id: string) => (await fetch(`https://example.invalid/${id}`)).json();',
      filename: feature,
      errors: [{ messageId: 'directGlobal', data: { name: 'fetch' } }],
    },
    {
      name: 'fetch referenced without a call',
      code: 'export const f = fetch;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'fetch.call and fetch.bind',
      code: 'export const a = fetch.call(null, "u");\nexport const b = fetch.bind(null);',
      filename: feature,
      errors: 2,
    },
    {
      name: 'fetch handed to something else',
      code: 'export const c = createClient({ transport: fetch });',
      filename: feature,
      errors: 1,
    },
    {
      name: 'fetch probed with typeof at run time',
      code: "export const has = typeof fetch === 'function';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'globalThis.fetch',
      code: 'export const r = (u: string) => globalThis.fetch(u);',
      filename: feature,
      errors: [{ messageId: 'directGlobal', data: { name: 'fetch' } }],
    },
    {
      name: "globalThis['fetch']",
      code: "export const r = (u: string) => globalThis['fetch'](u);",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a template-literal name',
      code: 'export const r = (u: string) => globalThis[`fetch`](u);',
      filename: feature,
      errors: 1,
    },
    {
      name: 'the other holders',
      code: 'export const a = window.fetch;\nexport const b = self.fetch;\nexport const c = global.fetch;',
      filename: feature,
      errors: 3,
    },
    {
      name: 'a holder behind optional chaining, a cast and a non-null assertion',
      code: 'export const a = globalThis?.fetch;\nexport const b = (globalThis as any).fetch;\nexport const c = globalThis!.fetch;',
      filename: feature,
      errors: 3,
    },
    {
      name: 'new globalThis.WebSocket',
      code: "export const s = () => new globalThis.WebSocket('wss://example.invalid');",
      filename: feature,
      errors: [{ messageId: 'directGlobal', data: { name: 'WebSocket' } }],
    },
    {
      name: 'the other three globals',
      code: "export const a = new XMLHttpRequest();\nexport const b = new WebSocket('wss://example.invalid');\nexport const c = new EventSource('/events');",
      filename: feature,
      errors: [
        { messageId: 'directGlobal', data: { name: 'XMLHttpRequest' } },
        { messageId: 'directGlobal', data: { name: 'WebSocket' } },
        { messageId: 'directGlobal', data: { name: 'EventSource' } },
      ],
    },
    {
      name: 'a route file under app/ is outside lib/ too',
      code: 'export const r = () => fetch("/x");',
      filename: 'apps/mobile/src/app/(student)/index.tsx',
      errors: 1,
    },
    {
      name: 'the global inside a function that binds another name',
      code: 'export const load = (fetcher: () => void) => { fetcher(); return fetch("/x"); };',
      filename: feature,
      errors: 1,
    },
    {
      name: 'axios',
      code: "import axios from 'axios';\nexport const r = () => axios.get('/x');",
      filename: feature,
      errors: [{ messageId: 'clientPackage', data: { specifier: 'axios' } }],
    },
    {
      name: 'an axios subpath, by require',
      code: "const adapter = require('axios/lib/adapters/http');\nexport default adapter;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'axios as a type',
      code: "import type { AxiosInstance } from 'axios';\nexport type A = AxiosInstance;",
      filename: feature,
      errors: 1,
    },
  ],
});
