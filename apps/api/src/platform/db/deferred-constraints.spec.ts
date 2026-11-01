// T006 — deferring the two session exclusions without a database: the one statement sent, naming
// exactly the two constraints. That a uniform shift of back-to-back sessions then commits while a
// true overlap is refused at commit, against Postgres, is `tests/db-integrity/db-errors.spec.ts`: a
// kernel spec may not write the sessions module's rows (R-API-6, `api/table-ownership`), as
// `row-lock.spec.ts` says.
import { describe, expect, it } from 'vitest';

import { withDeferredSessionConstraints } from './deferred-constraints.js';
import type { Transaction } from './prisma.repository.js';

describe('withDeferredSessionConstraints (T006, R-210)', () => {
  it('defers exactly the two session exclusions, in one statement with no values', async () => {
    const sent: { text: string; values: unknown[] }[] = [];
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        sent.push({ text: strings.join('$'), values });
        return 0;
      },
    } as unknown as Pick<Transaction, '$executeRaw'>;
    await withDeferredSessionConstraints(tx);
    expect(sent).toEqual([
      {
        text: 'SET CONSTRAINTS sessions_teacher_no_overlap, sessions_student_no_overlap DEFERRED',
        values: [],
      },
    ]);
  });
});
