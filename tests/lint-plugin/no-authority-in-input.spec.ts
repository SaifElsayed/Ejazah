// gender/no-authority-in-input (R-GENDER-4) against a table of code (T159).
//
// An input schema in packages/contracts/src is a declaration whose name ends in `Input` or
// `InputSchema`. Anywhere inside one, a key the client could use to say who it is — `gender`,
// `role`, `userId`, `user_id` — is refused: the server-held session is the only source (FR-046).
// Another user's id under its own name (`teacherUserId`) is data, not authority, and passes.
//
// T038 adds the allow-list of `packages/contracts/src/authority-allow-list.ts`, per schema and per
// field: `onboardingCompleteInput` may carry `gender` and `role`, the declarations a person makes
// once before any account exists (R-GENDER-6), and nothing else may; the same schema may still not
// carry `userId`, and another schema may not carry `gender` (T029's test asserts the list itself).

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const contracts = 'packages/contracts/src/booking.ts';
const api = 'apps/api/src/modules/booking/booking.service.ts';

const refused = (name: string) => ({ messageId: 'authority', data: { name } });

typescriptRuleTester().run('gender/no-authority-in-input', loadRule('no-authority-in-input.js'), {
  valid: [
    {
      name: 'an input schema with no authority key',
      code: "import { z } from 'zod';\nexport const bookSessionInput = z.object({ offerId: z.string(), teacherUserId: z.string() });",
      filename: contracts,
    },
    {
      name: 'an output schema may carry gender, role and user id: the server writes it',
      code: "import { z } from 'zod';\nexport const teacherView = z.object({ userId: z.string(), gender: z.enum(['male', 'female']), role: z.string() });",
      filename: contracts,
    },
    {
      name: 'the same keys outside packages/contracts are not an input schema',
      code: "import { z } from 'zod';\nexport const filterInput = z.object({ gender: z.string() });",
      filename: api,
    },
    {
      name: 'a name that only contains Input',
      code: "import { z } from 'zod';\nexport const inputLimits = z.object({ role: z.string() });",
      filename: contracts,
    },
    {
      name: 'the one allow-listed schema may carry its two allow-listed fields (T038, R-GENDER-6)',
      code: "import { z } from 'zod';\nexport const onboardingCompleteInput = z.object({ role: z.enum(['student', 'teacher']), gender: z.enum(['male', 'female']), displayName: z.string() });",
      filename: 'packages/contracts/src/onboarding.ts',
    },
    {
      name: 'a computed key is not read',
      code: "import { z } from 'zod';\nconst key = 'gender';\nexport const fooInput = z.object({ [key]: z.string() });",
      filename: contracts,
    },
  ],
  invalid: [
    {
      name: 'gender in an input schema',
      code: "import { z } from 'zod';\nexport const searchTeachersInput = z.object({ gender: z.enum(['male', 'female']) });",
      filename: contracts,
      errors: [refused('gender')],
    },
    {
      name: 'role, userId and user_id, nested',
      code: "import { z } from 'zod';\nexport const updateProfileInput = z.object({ profile: z.object({ role: z.string(), userId: z.string(), user_id: z.string() }) });",
      filename: contracts,
      errors: [refused('role'), refused('userId'), refused('user_id')],
    },
    {
      name: 'a quoted key',
      code: "import { z } from 'zod';\nexport const fooInput = z.object({ 'gender': z.string() });",
      filename: contracts,
      errors: [refused('gender')],
    },
    {
      name: 'an InputSchema name, and a key added through extend',
      code: "import { z } from 'zod';\nconst base = z.object({ offerId: z.string() });\nexport const bookInputSchema = base.extend({ userId: z.string() });",
      filename: contracts,
      errors: [refused('userId')],
    },
    {
      name: 'an input schema that is not exported is still one',
      code: "import { z } from 'zod';\nconst cancelInput = z.object({ role: z.literal('teacher') });\nexport { cancelInput };",
      filename: contracts,
      errors: [refused('role')],
    },
    {
      name: 'the allow-listed schema may still not carry a user id (T038)',
      code: "import { z } from 'zod';\nexport const onboardingCompleteInput = z.object({ role: z.string(), userId: z.string() });",
      filename: 'packages/contracts/src/onboarding.ts',
      errors: [refused('userId')],
    },
    {
      name: 'another schema may not carry what the allow-listed one may (T038)',
      code: "import { z } from 'zod';\nexport const onboardingResumeInput = z.object({ gender: z.string(), role: z.string() });",
      filename: 'packages/contracts/src/onboarding.ts',
      errors: [refused('gender'), refused('role')],
    },
    {
      name: 'a nested folder of packages/contracts/src',
      code: "import { z } from 'zod';\nexport const listInput = z.object({ gender: z.string() });",
      filename: 'packages/contracts/src/catalog/discovery.ts',
      errors: [refused('gender')],
    },
  ],
});
