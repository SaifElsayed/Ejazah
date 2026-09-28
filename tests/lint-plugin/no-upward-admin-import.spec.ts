// boundaries/no-upward-admin-import (R-API-4, upward half) against a table of code (T035).
//
// Dependencies point inward and nothing points at `admin`. The case the fixture did not cover is
// the importer that is not itself a module: `platform/` and the shared packages sit below the
// modules, so an import from there into the administrative module is as upward as it gets, and the
// rule now refuses every importer that is not admin's own code.

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
    ],
  },
);
