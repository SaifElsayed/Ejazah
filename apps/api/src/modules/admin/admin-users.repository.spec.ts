// T016's follow-up (PR #129's review, round 1, nit 4; the owner's decision of 2026-11-08) —
// `readAdministratorNames`, the outage list's recorders' names (sessions' `AdminNames`): one
// `findMany` for the page's ids, never one read per row; an id with no row named by an empty string.
import { describe, expect, it } from 'vitest';

import { readAdministratorNames } from './admin-users.repository.js';

const A1 = '0199d0a0-0000-7000-8000-0000000000a1';
const A2 = '0199d0a0-0000-7000-8000-0000000000a2';
const GONE = '0199d0a0-0000-7000-8000-0000000000a9';

function client(rows: readonly { id: string; displayName: string }[]) {
  const asked: unknown[] = [];
  const tx = {
    adminUser: {
      findMany: async (args: { where: { id: { in: string[] } } }) => {
        asked.push(args);
        return rows.filter(({ id }) => args.where.id.in.includes(id));
      },
      findUnique: async () => {
        throw new Error('one read per administrator');
      },
    },
  } as unknown as Parameters<typeof readAdministratorNames>[0];
  return { tx, asked };
}

describe('readAdministratorNames (T016, nit 4)', () => {
  it('reads every recorder of the page in one findMany, by id', async () => {
    const { tx, asked } = client([
      { id: A1, displayName: 'المشرف الأول' },
      { id: A2, displayName: 'المشرف الثاني' },
    ]);
    const names = await readAdministratorNames(tx, [A1, A2, GONE]);
    expect(asked).toEqual([
      { where: { id: { in: [A1, A2, GONE] } }, select: { id: true, displayName: true } },
    ]);
    expect(names).toEqual(
      new Map([
        [A1, 'المشرف الأول'],
        [A2, 'المشرف الثاني'],
        [GONE, ''],
      ]),
    );
  });

  it('reads nothing for an empty page', async () => {
    const { tx, asked } = client([]);
    expect(await readAdministratorNames(tx, [])).toEqual(new Map());
    expect(asked).toEqual([]);
  });
});
