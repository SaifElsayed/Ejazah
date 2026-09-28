// boundaries/no-deep-module-import (R-API-3) against a table of code (T035).
//
// A module is reached only through its public entry, and the interesting cases are the two the
// rule must stay silent on: the entry itself, spelled as the folder or as its index file, and a
// module's own internal wiring, which is not a wall at all.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const booking = 'apps/api/src/modules/booking/booking.service.ts';

typescriptRuleTester().run(
  'boundaries/no-deep-module-import',
  loadRule('no-deep-module-import.js'),
  {
    valid: [
      {
        name: 'the public entry as the module folder',
        code: "import { catalog } from '../catalog';",
        filename: booking,
      },
      {
        name: 'the public entry as its index file',
        code: "import { catalog } from '../catalog/index';",
        filename: booking,
      },
      {
        name: 'the public entry with an extension',
        code: "import { catalog } from '../catalog/index.ts';",
        filename: booking,
      },
      {
        name: 'internal wiring inside one module',
        code: "import { repo } from './booking.repository';",
        filename: booking,
      },
      { name: 'a package', code: "import { z } from 'zod';", filename: booking },
    ],
    invalid: [
      {
        name: 'the inline type import past another module’s public entry',
        code: "export type X = import('../catalog/catalog.repository').Teacher;",
        filename: booking,
        errors: 1,
      },
      {
        name: 'below the entry',
        code: "import { find } from '../catalog/catalog.service';",
        filename: booking,
        errors: [
          {
            messageId: 'belowEntry',
            data: { specifier: '../catalog/catalog.service', module: 'catalog' },
          },
        ],
      },
      {
        name: 'deeper still',
        code: "import { row } from '../catalog/internal/rows';",
        filename: booking,
        errors: 1,
      },
      {
        name: 'from outside the module tree, which breaks the same wall',
        code: "import { find } from '../modules/catalog/catalog.service';",
        filename: 'apps/api/src/platform/bootstrap.ts',
        errors: 1,
      },
      {
        name: 'require',
        code: "const { find } = require('../catalog/catalog.service');",
        filename: booking,
        errors: 1,
      },
      {
        name: 'import = require',
        code: "import service = require('../catalog/catalog.service');\nexport default service;",
        filename: booking,
        errors: 1,
      },
      {
        name: 'export * from',
        code: "export * from '../catalog/catalog.service';",
        filename: booking,
        errors: 1,
      },
    ],
  },
);
