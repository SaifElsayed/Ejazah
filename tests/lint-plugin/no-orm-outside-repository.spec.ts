// api/no-orm-outside-repository (R-API-2) against a table of code (T036).
//
// The database client is a name only a `*.repository.ts` file may know. The fixture proves the
// canonical specifier; this table proves the spellings that walk around an exact match — the
// package's subpaths, the generated output path at the end of a deeper relative path — and the two
// type-only forms, which are the easiest place to start leaking the database's shape into a
// service because they survive to runtime as nothing at all.
//
// The one-client-per-process singleton lives in `apps/api/src/platform/db/prisma.repository.ts`
// (decision recorded in the rule header and under T036): a `*.repository` file, so it needs no
// allowlist and no exception. The valid table names it so the decision has a test.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const service = 'apps/api/src/modules/booking/booking.service.ts';
const repository = 'apps/api/src/modules/booking/booking.repository.ts';
const singleton = 'apps/api/src/platform/db/prisma.repository.ts';

typescriptRuleTester().run(
  'api/no-orm-outside-repository',
  loadRule('no-orm-outside-repository.js'),
  {
    valid: [
      {
        name: 'the seed outside apps/api (T074), which must create a client',
        code: "import { PrismaClient } from '@prisma/client';\nexport const client = new PrismaClient();",
        filename: 'prisma/seed.ts',
      },
      {
        name: 'a seed test outside apps/api (T072)',
        code: "import { PrismaClient } from '@prisma/client';\nexport const c = PrismaClient;",
        filename: 'tests/seed/determinism.spec.ts',
      },
      {
        name: 'a repository naming the client',
        code: "import { PrismaClient } from '@prisma/client';\nexport const c = PrismaClient;",
        filename: repository,
      },
      {
        name: 'the kernel’s one client per process, which is a repository file',
        code: "import { PrismaClient } from '@prisma/client';\nexport const client = new PrismaClient();",
        filename: singleton,
      },
      {
        name: 'a service asking the repository instead',
        code: "import { repo } from './booking.repository';\nexport const r = repo;",
        filename: service,
      },
      {
        name: 'a package whose name merely starts alike',
        code: "import { x } from '@prisma/client-extras';\nexport const y = x;",
        filename: service,
      },
    ],
    invalid: [
      {
        name: 'the canonical package',
        code: "import { PrismaClient } from '@prisma/client';\nexport const c = PrismaClient;",
        filename: service,
        errors: [{ messageId: 'outsideRepository', data: { specifier: '@prisma/client' } }],
      },
      {
        name: 'a published subpath',
        code: "import { PrismaClient } from '@prisma/client/edge';\nexport const c = PrismaClient;",
        filename: service,
        errors: 1,
      },
      {
        name: 'a deeper subpath',
        code: "import { X } from '@prisma/client/runtime/library';\nexport const c = X;",
        filename: service,
        errors: 1,
      },
      {
        name: 'the generated output path',
        code: "import { PrismaClient } from '../../../../node_modules/.prisma/client';\nexport const c = PrismaClient;",
        filename: service,
        errors: 1,
      },
      {
        name: 'the generated output path with a file below it',
        code: "import { PrismaClient } from '.prisma/client/index';\nexport const c = PrismaClient;",
        filename: service,
        errors: 1,
      },
      {
        name: 'a type-only import',
        code: "import type { PrismaClient } from '@prisma/client';\nexport type C = PrismaClient;",
        filename: service,
        errors: 1,
      },
      {
        name: 'a type-only import written as an import type node',
        code: "export type C = import('@prisma/client').PrismaClient;",
        filename: service,
        errors: 1,
      },
      {
        name: 'require',
        code: "const { PrismaClient } = require('@prisma/client');\nexport default PrismaClient;",
        filename: service,
        errors: 1,
      },
      {
        name: 'import = require',
        code: "import prisma = require('@prisma/client');\nexport default prisma;",
        filename: service,
        errors: 1,
      },
      {
        name: 'export from',
        code: "export { PrismaClient } from '@prisma/client';",
        filename: service,
        errors: 1,
      },
      {
        name: 'a dynamic import',
        code: "export const load = () => import('@prisma/client');",
        filename: service,
        errors: 1,
      },
    ],
  },
);
