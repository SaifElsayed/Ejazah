// B6 (owner's decision, 2026-10-19): the phone's tRPC client is typed by the API's router type,
// imported type-only from `apps/api` (lib/client.ts). A value import from the API in the phone
// would bundle server code into the application, so the fast set refuses one in every spelling the
// phone can write, and lets a type-only import through.
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const ruleId = '@typescript-eslint/no-restricted-imports';

async function messagesFor(code: string, file = 'apps/mobile/src/lib/client.ts') {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: path.join(repositoryRoot, 'eslint.config.js'),
  });
  const [result] = await eslint.lintText(code, { filePath: path.join(repositoryRoot, file) });
  return (result?.messages ?? []).filter((message) => message.ruleId === ruleId);
}

describe('the phone imports only types from the API', () => {
  it('lets a type-only import of the router type through', async () => {
    expect(
      await messagesFor(
        "import type { AppRouter } from '../../../api/src/surfaces/app.router';\nexport type R = AppRouter;\n",
      ),
    ).toEqual([]);
    expect(
      await messagesFor(
        "import { type AppRouter } from '../../../api/src/surfaces/app.router';\nexport type R = AppRouter;\n",
      ),
    ).toEqual([]);
  });

  it.each([
    "import { appRouter } from '../../../api/src/surfaces/app.router';\nexport const r = appRouter;\n",
    "import * as api from '../../../api/src/surfaces/app.router';\nexport const r = api;\n",
    "export { appRouter } from '../../../api/src/surfaces/app.router';\n",
    "import { createApplication } from '@ijazah/api';\nexport const r = createApplication;\n",
    "import { main } from '@ijazah/api/src/main';\nexport const r = main;\n",
  ])('refuses a value import from the API: %s', async (code) => {
    const messages = await messagesFor(code);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('R-MOBILE-11');
  });

  it('reads the two clients only, so the API is untouched', async () => {
    expect(
      await messagesFor(
        "import { appRouter } from '../surfaces/app.router';\nexport const r = appRouter;\n",
        'apps/api/src/main.ts',
      ),
    ).toEqual([]);
  });
});

// B8 (T037): the admin panel's client is typed by the administrator router the same way, under the
// same rule: a value import would bundle server code into the panel.
describe('the admin panel imports only types from the API', () => {
  const adminClient = 'apps/admin/src/lib/client.ts';

  it('lets a type-only import of the router type through', async () => {
    expect(
      await messagesFor(
        "import type { AdminRouter } from '../../../api/src/surfaces/admin.router';\nexport type R = AdminRouter;\n",
        adminClient,
      ),
    ).toEqual([]);
  });

  it.each([
    "import { adminRouter } from '../../../api/src/surfaces/admin.router';\nexport const r = adminRouter;\n",
    "export { adminRouter } from '../../../api/src/surfaces/admin.router';\n",
    "import { createApplication } from '@ijazah/api';\nexport const r = createApplication;\n",
  ])('refuses a value import from the API: %s', async (code) => {
    const messages = await messagesFor(code, adminClient);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('admin panel');
  });
});
