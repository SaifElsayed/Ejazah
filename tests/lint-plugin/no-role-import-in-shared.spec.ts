// boundaries/no-role-import-in-shared (R-MOBILE-2) against a table of code (T035).
//
// `features/shared/` is what both roles may depend on, so it depends on neither. The alias case is
// here for the same reason as in `no-cross-role-import.spec.ts`: the wall has to hold for the
// spelling the application ships, not only for the relative one.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const shared = 'apps/mobile/src/features/shared/components/session-card.ts';

typescriptRuleTester().run(
  'boundaries/no-role-import-in-shared',
  loadRule('no-role-import-in-shared.js'),
  {
    valid: [
      { name: 'inside shared', code: "import { x } from './avatar';", filename: shared },
      { name: 'a package', code: "import React from 'react';", filename: shared },
      {
        name: 'a role tree importing shared, which is the direction that is allowed',
        code: "import { card } from '../../shared/components/session-card';",
        filename: 'apps/mobile/src/features/student/screens/booking.ts',
      },
    ],
    invalid: [
      {
        name: 'shared reaching into student',
        code: "import { booking } from '../../student/screens/booking';",
        filename: shared,
        errors: [
          {
            messageId: 'roleInShared',
            data: { specifier: '../../student/screens/booking', to: 'student' },
          },
        ],
      },
      {
        name: 'shared reaching into teacher, the same wall from the other side',
        code: "import { roster } from '../../teacher/screens/roster';",
        filename: shared,
        errors: [
          {
            messageId: 'roleInShared',
            data: { specifier: '../../teacher/screens/roster', to: 'teacher' },
          },
        ],
      },
      {
        name: 'the path alias the application configures',
        code: "import { booking } from '@/features/student/screens/booking';",
        filename: shared,
        errors: 1,
      },
      {
        name: 'require',
        code: "const { booking } = require('../../student/screens/booking');",
        filename: shared,
        errors: 1,
      },
      {
        name: 'import = require',
        code: "import booking = require('../../student/screens/booking');\nexport default booking;",
        filename: shared,
        errors: 1,
      },
      {
        name: 'export * from',
        code: "export * from '../../teacher/screens/roster';",
        filename: shared,
        errors: 1,
      },
    ],
  },
);
