// boundaries/no-upward-admin-import (R-API-4, upward half) against a table of code (T035).
//
// Dependencies point inward and nothing points at `admin`. The case the fixture did not cover is
// the importer that is not itself a module: `platform/` and the shared packages sit below the
// modules, so an import from there into the administrative module is as upward as it gets, and the
// rule now refuses every importer that is not admin's own code.
//
// T143 adds the three composition files, which sit above every module and may import admin's public
// entry and nothing below it, and the files that still may not: the other surfaces, a job, the
// kernel, another module, and lookalikes of the three paths.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const booking = 'apps/api/src/modules/booking/booking.service.ts';

typescriptRuleTester().run(
  'boundaries/no-upward-admin-import',
  loadRule('no-upward-admin-import.js'),
  {
    valid: [
      {
        name: 'a sideways module import',
        code: "import { c } from '../catalog';",
        filename: booking,
      },
      {
        name: 'admin importing its own file',
        code: "import { repo } from './admin.repository';",
        filename: 'apps/api/src/modules/admin/admin.service.ts',
      },
      {
        name: 'admin calling down into a module',
        code: "import { booking } from '../booking';",
        filename: 'apps/api/src/modules/admin/admin.service.ts',
      },
      { name: 'a package', code: "import { z } from 'zod';", filename: booking },
      // T143 — the three composition files sit above every module and may import admin's entry.
      {
        name: 'main.ts importing the admin entry',
        code: "import { auditWriter } from './modules/admin';",
        filename: 'apps/api/src/main.ts',
      },
      {
        name: 'worker.ts importing the admin entry by its index file',
        code: "import { settingsReader } from './modules/admin/index';",
        filename: 'apps/api/src/worker.ts',
      },
      {
        name: 'admin.router.ts importing the admin entry',
        code: "import { adminRouter } from '../modules/admin';",
        filename: 'apps/api/src/surfaces/admin.router.ts',
      },
      {
        name: 'a composition file under the mirrored fixture tree',
        code: "import { auditWriter } from './modules/admin';",
        filename: 'tests/violations/fixtures/apps/api/src/main.ts',
      },
    ],
    invalid: [
      {
        name: 'a module importing the admin entry',
        code: "import { admin } from '../admin';",
        filename: booking,
        errors: [
          {
            messageId: 'upwardIntoAdmin',
            data: { specifier: '../admin', importer: 'the booking module' },
          },
        ],
      },
      {
        name: 'a module importing below the admin entry',
        code: "import { service } from '../admin/admin.service';",
        filename: booking,
        errors: 1,
      },
      {
        name: 'the kernel importing admin',
        code: "import { admin } from '../modules/admin';",
        filename: 'apps/api/src/platform/bootstrap.ts',
        errors: [
          {
            messageId: 'upwardIntoAdmin',
            data: { specifier: '../modules/admin', importer: 'outside the module tree' },
          },
        ],
      },
      {
        name: 'a shared package importing admin',
        code: "import { admin } from '../../../apps/api/src/modules/admin';",
        filename: 'packages/contracts/src/index.ts',
        errors: 1,
      },
      {
        name: 'require',
        code: "const { admin } = require('../admin');",
        filename: booking,
        errors: 1,
      },
      {
        name: 'import = require',
        code: "import admin = require('../admin');\nexport default admin;",
        filename: booking,
        errors: 1,
      },
      {
        name: 'export * from',
        code: "export * from '../admin';",
        filename: booking,
        errors: 1,
      },
      // T143 — only the three composition files are exempt, and only for the public entry.
      {
        name: 'app.router.ts importing the admin entry',
        code: "import { admin } from '../modules/admin';",
        filename: 'apps/api/src/surfaces/app.router.ts',
        errors: [
          {
            messageId: 'upwardIntoAdmin',
            data: { specifier: '../modules/admin', importer: 'outside the module tree' },
          },
        ],
      },
      {
        name: 'procedures.ts importing the admin entry',
        code: "import { admin } from '../modules/admin';",
        filename: 'apps/api/src/surfaces/procedures.ts',
        errors: 1,
      },
      {
        name: 'a job importing the admin entry',
        code: "import { admin } from '../modules/admin';",
        filename: 'apps/api/src/jobs/expire-idempotency-keys.ts',
        errors: 1,
      },
      {
        name: 'a kernel file importing the admin entry',
        code: "import { admin } from '../../modules/admin';",
        filename: 'apps/api/src/platform/settings/settings-reader.ts',
        errors: 1,
      },
      {
        name: 'another module importing the admin entry',
        code: "import { admin } from '../admin';",
        filename: 'apps/api/src/modules/catalog/catalog.service.ts',
        errors: 1,
      },
      {
        name: 'a composition file reaching below the admin entry',
        code: "import { repo } from './modules/admin/audit.repository';",
        filename: 'apps/api/src/main.ts',
        errors: 1,
      },
      {
        name: 'a lookalike of main.ts with another extension',
        code: "import { admin } from './modules/admin';",
        filename: 'apps/api/src/main.tsx',
        errors: 1,
      },
      {
        name: 'a lookalike of main.ts in another folder',
        code: "import { admin } from '../modules/admin';",
        filename: 'apps/api/src/old/main.ts',
        errors: 1,
      },
      {
        name: 'the spec file beside admin.router.ts',
        code: "import { admin } from '../modules/admin';",
        filename: 'apps/api/src/surfaces/admin.router.spec.ts',
        errors: 1,
      },
    ],
  },
);
