// T010 — the kernel's name-prefix query without a database: the one statement it sends, the fold on
// both sides of one LIKE, the typed text's `%`, `_` and `\` escaped before it reaches the LIKE, the
// candidates bound as one uuid array, and no statement for no candidates. The query against
// Postgres, where a typed `%` or `_` matches only itself, is
// `modules/identity/visible-teachers.repository.spec.ts`: a kernel spec may not write the identity
// module's rows the match needs (R-API-6, `api/table-ownership`), as `row-lock.spec.ts` says.
import { describe, expect, it } from 'vitest';

import { idsWithFoldedNamePrefix } from './folded-name.js';
import type { Transaction } from './prisma.repository.js';

interface Sent {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A transaction that records each tagged raw query it is handed, and answers the given rows. */
function recordingTransaction(answer: readonly { id: string }[] = []): {
  readonly tx: Pick<Transaction, '$queryRaw'>;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sent.push({ text: strings.join('$'), values });
      return answer;
    },
  } as unknown as Pick<Transaction, '$queryRaw'>;
  return { tx, sent };
}

const IDS = ['0199d0a0-0000-7000-8000-000000000001', '0199d0a0-0000-7000-8000-000000000002'];

describe('idsWithFoldedNamePrefix (T010, R-203)', () => {
  it('folds both sides of one LIKE, the candidates bound as one uuid array', async () => {
    const { tx, sent } = recordingTransaction();
    await idsWithFoldedNamePrefix(tx, IDS, 'أحمد');
    expect(sent).toEqual([
      {
        text: "SELECT id FROM users WHERE id = ANY($::uuid[]) AND ijazah_fold(display_name) LIKE ijazah_fold($) || '%' ESCAPE '\\'",
        values: [IDS, 'أحمد'],
      },
    ]);
  });

  it('escapes a typed %, _ and the escape character before the LIKE, so each matches only itself', async () => {
    const { tx, sent } = recordingTransaction();
    await idsWithFoldedNamePrefix(tx, IDS, '50%_\\x');
    expect(sent[0]?.values[1]).toBe('50\\%\\_\\\\x');
  });

  it('answers the ids the database matched', async () => {
    const { tx } = recordingTransaction([{ id: IDS[1] ?? '' }]);
    expect(await idsWithFoldedNamePrefix(tx, IDS, 'م')).toEqual([IDS[1]]);
  });

  it('sends no statement for no candidates', async () => {
    const { tx, sent } = recordingTransaction();
    expect(await idsWithFoldedNamePrefix(tx, [], 'م')).toEqual([]);
    expect(sent).toEqual([]);
  });
});
