// time/no-client-timestamp (R-TIME-6) against a table of code (T159).
//
// An input schema in packages/contracts/src is a declaration whose name ends in `Input` or
// `InputSchema`. Inside one, a server-event timestamp (`createdAt`, `updatedAt`, `expiresAt`,
// `joinedAt`, `paidAt`, `occurredAt`, `timestamp`, and their snake_case forms) is refused, and so is
// any field validated as an absolute instant (`z.date()`, `z.coerce.date()`, a `.datetime()` that
// accepts an offset) whatever its name: attendance, ordering and expiry come from the server clock
// (FR-021). A local wall-clock time with its zone, which R-TIME-3 requires a teacher's slot to be
// entered as, is accepted: `z.iso.datetime({ local: true })`, a date, a time.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const contracts = 'packages/contracts/src/sessions.ts';

const stamped = (name: string) => ({ messageId: 'timestamp', data: { name } });
const instant = (name: string) => ({ messageId: 'instant', data: { name } });

typescriptRuleTester().run('time/no-client-timestamp', loadRule('no-client-timestamp.js'), {
  valid: [
    {
      name: "a teacher's slot as local wall-clock time with its zone (R-TIME-3)",
      code: "import { z } from 'zod';\nexport const createSlotInput = z.object({ startLocal: z.iso.datetime({ local: true }), timezone: z.string(), durationMinutes: z.number() });",
      filename: contracts,
    },
    {
      name: 'local dates and times',
      code: "import { z } from 'zod';\nexport const searchInput = z.object({ from: z.iso.date(), to: z.string().date(), at: z.iso.time() });",
      filename: contracts,
    },
    {
      name: 'an output schema stamped by the server',
      code: "import { z } from 'zod';\nexport const sessionView = z.object({ createdAt: z.date(), expiresAt: z.iso.datetime() });",
      filename: contracts,
    },
    {
      name: 'the same keys outside packages/contracts',
      code: "import { z } from 'zod';\nexport const eventInput = z.object({ occurredAt: z.date() });",
      filename: 'apps/api/src/modules/sessions/sessions.service.ts',
    },
    {
      name: 'a date method on something that is not zod',
      code: "import { z } from 'zod';\nconst calendar = { date: () => z.string() };\nexport const fooInput = z.object({ day: calendar.date() });",
      filename: contracts,
    },
  ],
  invalid: [
    {
      name: 'each server-event timestamp by name',
      code: "import { z } from 'zod';\nexport const markInput = z.object({ createdAt: z.string(), updatedAt: z.string(), expiresAt: z.string(), joinedAt: z.string(), paidAt: z.string(), occurredAt: z.string(), timestamp: z.string(), created_at: z.string() });",
      filename: contracts,
      errors: [
        stamped('createdAt'),
        stamped('updatedAt'),
        stamped('expiresAt'),
        stamped('joinedAt'),
        stamped('paidAt'),
        stamped('occurredAt'),
        stamped('timestamp'),
        stamped('created_at'),
      ],
    },
    {
      name: 'an absolute instant under any name',
      code: "import { z } from 'zod';\nexport const reportInput = z.object({ seenAt: z.date(), at: z.coerce.date(), when: z.string().datetime(), then: z.iso.datetime(), later: z.iso.datetime({ offset: true }) });",
      filename: contracts,
      errors: [
        instant('seenAt'),
        instant('at'),
        instant('when'),
        instant('then'),
        instant('later'),
      ],
    },
    {
      name: 'a local datetime that also accepts an offset is an instant',
      code: "import { z } from 'zod';\nexport const fooInput = z.object({ startLocal: z.iso.datetime({ local: true, offset: true }) });",
      filename: contracts,
      errors: [instant('startLocal')],
    },
    {
      name: 'a named timestamp that is also an instant is reported once, as a timestamp',
      code: "import { z } from 'zod';\nexport const joinInput = z.object({ joinedAt: z.date().optional() });",
      filename: contracts,
      errors: [stamped('joinedAt')],
    },
    {
      name: 'nested, and in an InputSchema name',
      code: "import { z } from 'zod';\nexport const payInputSchema = z.object({ receipt: z.object({ paidAt: z.number() }) });",
      filename: contracts,
      errors: [stamped('paidAt')],
    },
    {
      name: 'an instant passed straight to the schema, with no key',
      code: "import { z } from 'zod';\nexport const cursorInput = z.date();",
      filename: contracts,
      errors: [instant('cursorInput')],
    },
  ],
});
