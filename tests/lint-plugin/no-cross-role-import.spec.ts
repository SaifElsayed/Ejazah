// boundaries/no-cross-role-import (R-MOBILE-1) against a table of code (T035).
//
// The fixture in `tests/violations/` proves the rule refuses one relative import. What it cannot
// show is the spelling a screen is actually written with: `apps/mobile/tsconfig.json` declares
// `"@/*": ["src/*"]`, so `@/features/teacher/roster` names the same file, and a wall that saw only
// the relative form left the alias open. That case is the reason this spec exists; the rest of the
// table is the wall's shape — both directions, the shared tree, a package, and every syntax that
// names a module.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const student = 'apps/mobile/src/features/student/screens/booking.ts';
const teacher = 'apps/mobile/src/features/teacher/screens/roster.ts';

typescriptRuleTester().run('boundaries/no-cross-role-import', loadRule('no-cross-role-import.js'), {
  valid: [
    { name: 'inside its own role tree', code: "import { x } from './detail';", filename: student },
    {
      name: 'the shared tree, which is what both roles may depend on',
      code: "import { x } from '../../shared/session-card';",
      filename: student,
    },
    { name: 'a package', code: "import React from 'react';", filename: student },
    {
      name: 'its own role tree through the alias',
      code: "import { x } from '@/features/teacher/roster';",
      filename: teacher,
    },
    {
      name: 'a file outside the role tree is not this rule’s business',
      code: "import { x } from '../features/student/screens/booking';",
      filename: 'apps/mobile/src/lib/deep-link.ts',
    },
  ],
  invalid: [
    {
      name: 'student reaching into teacher',
      code: "import { roster } from '../../teacher/screens/roster';",
      filename: student,
      errors: [
        {
          messageId: 'crossRole',
          data: { specifier: '../../teacher/screens/roster', from: 'student', to: 'teacher' },
        },
      ],
    },
    {
      name: 'teacher reaching into student, the same wall from the other side',
      code: "import { booking } from '../../student/screens/booking';",
      filename: teacher,
      errors: [
        {
          messageId: 'crossRole',
          data: { specifier: '../../student/screens/booking', from: 'teacher', to: 'student' },
        },
      ],
    },
    {
      name: 'the path alias the application configures',
      code: "import { roster } from '@/features/teacher/screens/roster';",
      filename: student,
      errors: 1,
    },
    {
      name: 'require',
      code: "const { roster } = require('../../teacher/screens/roster');",
      filename: student,
      errors: 1,
    },
    {
      name: 'import = require',
      code: "import roster = require('../../teacher/screens/roster');\nexport default roster;",
      filename: student,
      errors: 1,
    },
    {
      name: 'export * from',
      code: "export * from '../../teacher/screens/roster';",
      filename: student,
      errors: 1,
    },
    {
      name: 'a dynamic import',
      code: "export const load = () => import('../../teacher/screens/roster');",
      filename: student,
      errors: 1,
    },
  ],
});
