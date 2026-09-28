// mobile/no-direct-network (R-MOBILE-11) against a table of code (T039).
//
// The fixture proves a bare `fetch` from a feature. This table proves the decision that makes the
// rule usable — `fetch` is refused only when it is the global, so a parameter, a local or an import
// named `fetch` is somebody's injected client and is legal — and then the spellings that walk
// around the bare call: `globalThis.fetch`, `window.fetch`, `self.fetch`, the constructors
// (`XMLHttpRequest`, `WebSocket`, `EventSource`), and the network libraries in every import
// spelling `specifiers.js` knows, `@trpc/client` among them because that is how a feature would
// build a second client instead of importing the one in `lib/`.
//
// The path decisions have rows too: `lib/` is the one exempt tree, since building the client
// means calling the primitives; the route tree under `app/` and `design/` are held to the same
// line as `features/`; a file outside `apps/mobile/src` is not read.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/teacher/roster-refresh.ts';
const client = 'apps/mobile/src/lib/client.ts';
const route = 'apps/mobile/src/app/(teacher)/roster.tsx';
const design = 'apps/mobile/src/design/remote-image.tsx';

typescriptRuleTester().run('mobile/no-direct-network', loadRule('no-direct-network.js'), {
  valid: [
    {
      name: 'an injected fetch parameter, which is a client handed in and not the global',
      code: 'export async function load(fetch: (url: string) => Promise<Response>) {\n  return fetch("/roster");\n}',
      filename: feature,
    },
    {
      name: 'a local named fetch, declared in the file',
      code: "import { trpc } from '@/lib/client';\nconst fetch = (id: string) => trpc.roster.query({ id });\nexport const roster = fetch('e1');",
      filename: feature,
    },
    {
      name: 'a fetch imported from the client layer',
      code: "import { fetch } from '@/lib/client';\nexport const roster = fetch('/roster');",
      filename: feature,
    },
    {
      name: 'the tRPC client imported from lib, which is the sanctioned path',
      code: "import { trpc } from '@/lib/client';\nexport const roster = trpc.roster.list.query();",
      filename: feature,
    },
    {
      name: 'the client layer itself calling the global, which is where the client is built',
      code: "export const call = (url: string) => fetch(url, { headers: { 'x-session': 's' } });",
      filename: client,
    },
    {
      name: 'a deeper lib file importing the tRPC client package',
      code: "import { createTRPCClient } from '@trpc/client';\nexport const make = createTRPCClient;",
      filename: 'apps/mobile/src/lib/trpc/links.ts',
    },
    {
      name: 'a WebSocket named as a type, which is not a connection',
      code: 'export let socket: WebSocket | null = null;',
      filename: feature,
    },
    {
      name: 'a constructor that is not a network primitive',
      code: 'export const controller = new AbortController();',
      filename: feature,
    },
    {
      name: 'a package whose name merely starts alike',
      code: "import { Kysely } from 'kysely';\nexport const k = Kysely;",
      filename: feature,
    },
    {
      name: 'a file outside apps/mobile/src, which the rule does not read',
      code: "import axios from 'axios';\nexport const http = axios.create();",
      filename: 'apps/api/src/platform/ports/sms/sms.transport.ts',
    },
  ],
  invalid: [
    {
      name: 'a network library reached through require',
      code: "const got = require('got');\nexport default got;",
      filename: feature,
      errors: [{ messageId: 'library', data: { specifier: 'got' } }],
    },
    {
      name: 'the global fetch from a feature, the fixture’s spelling',
      code: 'export async function refreshRoster(enrollmentId: string): Promise<unknown> {\n  const response = await fetch(`https://example.invalid/roster/${enrollmentId}`);\n  return response.json();\n}',
      filename: feature,
      errors: [{ messageId: 'directCall', data: { name: 'fetch' } }],
    },
    {
      name: 'the global reached through globalThis',
      code: "export const load = () => globalThis.fetch('/roster');",
      filename: feature,
      errors: [{ messageId: 'directCall', data: { name: 'globalThis.fetch' } }],
    },
    {
      name: 'the global reached through window',
      code: "export const load = () => window.fetch('/roster');",
      filename: feature,
      errors: [{ messageId: 'directCall', data: { name: 'window.fetch' } }],
    },
    {
      name: 'the global reached through self',
      code: "export const load = () => self.fetch('/roster');",
      filename: feature,
      errors: 1,
    },
    {
      name: 'the older spelling, XMLHttpRequest',
      code: 'export const request = new XMLHttpRequest();',
      filename: feature,
      errors: [{ messageId: 'directCall', data: { name: 'XMLHttpRequest' } }],
    },
    {
      name: 'the streaming spelling, WebSocket',
      code: "export const socket = new WebSocket('wss://example.invalid/live');",
      filename: feature,
      errors: [{ messageId: 'directCall', data: { name: 'WebSocket' } }],
    },
    {
      name: 'the other streaming spelling, EventSource',
      code: "export const events = new EventSource('/events');",
      filename: feature,
      errors: 1,
    },
    {
      name: 'axios, the library the constitution names',
      code: "import axios from 'axios';\nexport const http = axios.create();",
      filename: feature,
      errors: [{ messageId: 'library', data: { specifier: 'axios' } }],
    },
    {
      name: 'a type-only import of a library',
      code: "import type { Options } from 'ky';\nexport type O = Options;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a type-only import written as an import type node',
      code: "export type C = import('@urql/core').Client;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a dynamic import of the tRPC client package, a second client in the making',
      code: "export const load = () => import('@trpc/client');",
      filename: feature,
      errors: [{ messageId: 'library', data: { specifier: '@trpc/client' } }],
    },
    {
      name: 'import = require',
      code: "import nodeFetch = require('node-fetch');\nexport default nodeFetch;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'export from',
      code: "export { ApolloClient } from '@apollo/client/core';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a route file, held to the same line as a feature',
      code: "export const load = () => fetch('/roster');",
      filename: route,
      errors: 1,
    },
    {
      name: 'a design file, held to the same line as a feature',
      code: "import ky from 'ky';\nexport const http = ky;",
      filename: design,
      errors: 1,
    },
  ],
});
