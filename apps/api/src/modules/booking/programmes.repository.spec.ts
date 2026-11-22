// 006:T005 (R-504; U-1, N-12) — booking's queries on `programmes`: a student's active programmes'
// weekly times (the four active states, a soft-deleted enrollment left out, one enrollment left out
// when asked) and the confirmed assessment's row written once. Over a recording stand-in of the
// client; the rows against Postgres are `tests/db-integrity/programme-confirmation.spec.ts`' and
// `tests/adversarial/programme-assessment.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  activeProgrammeSlotsOf,
  insertAwaitingOffer,
  programmeStateOf,
} from './programmes.repository.js';

const STUDENT = '0199d0a0-0000-7000-8000-0000000006d2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000006e1';
const SLOT = '0199d0a0-0000-7000-8000-0000000006f1';

function clientOf(rows: readonly unknown[]) {
  const calls: [string, unknown][] = [];
  const client = {
    programme: {
      findMany: async (query: unknown) => {
        calls.push(['findMany', query]);
        return rows;
      },
      createMany: async (query: unknown) => {
        calls.push(['createMany', query]);
        return { count: 1 };
      },
    },
  } as unknown as Pick<Transaction, 'programme'>;
  return { client, calls };
}

describe('a student’s active programmes (U-1)', () => {
  it('reads the four active states of the students’ live enrollments, by enrollment id', async () => {
    const { client, calls } = clientOf([
      {
        enrollmentId: ENROLLMENT,
        enrollment: { slotId: SLOT, snapshotSlotTimezone: 'Africa/Cairo' },
      },
    ]);
    await expect(activeProgrammeSlotsOf(client, [STUDENT])).resolves.toStrictEqual([
      { enrollmentId: ENROLLMENT, slotId: SLOT, timezone: 'Africa/Cairo' },
    ]);
    expect(calls).toEqual([
      [
        'findMany',
        {
          where: {
            state: { in: ['awaiting_offer', 'offered', 'active', 'paused'] },
            enrollment: { studentUserId: { in: [STUDENT] }, deletedAt: null },
          },
          orderBy: { enrollmentId: 'asc' },
          select: {
            enrollmentId: true,
            enrollment: { select: { slotId: true, snapshotSlotTimezone: true } },
          },
        },
      ],
    ]);
  });

  it('leaves out the enrollment named', async () => {
    const { client, calls } = clientOf([]);
    await activeProgrammeSlotsOf(client, [STUDENT], ENROLLMENT);
    expect(calls[0]?.[1]).toMatchObject({
      where: { enrollment: { id: { not: ENROLLMENT } } },
    });
  });

  it('reads nothing for no student', async () => {
    const { client, calls } = clientOf([]);
    await expect(activeProgrammeSlotsOf(client, [])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('the confirmed assessment’s programme (R-504)', () => {
  it('writes it `awaiting_offer`, a second write skipped', async () => {
    const { client, calls } = clientOf([]);
    await insertAwaitingOffer(client, ENROLLMENT);
    expect(calls).toEqual([
      [
        'createMany',
        { data: [{ enrollmentId: ENROLLMENT, state: 'awaiting_offer' }], skipDuplicates: true },
      ],
    ]);
  });
});

describe('the programme’s state under its lock (006:T006; R-502)', () => {
  it('reads the enrollment’s programme’s state, and none for an enrollment that is no programme', async () => {
    const calls: unknown[] = [];
    const answers = [{ state: 'active' }, null];
    const client = {
      programme: {
        findUnique: async (query: unknown) => {
          calls.push(query);
          return answers.shift() ?? null;
        },
      },
    } as unknown as Pick<Transaction, 'programme'>;
    await expect(programmeStateOf(client, ENROLLMENT)).resolves.toBe('active');
    await expect(programmeStateOf(client, ENROLLMENT)).resolves.toBeNull();
    expect(calls[0]).toEqual({ where: { enrollmentId: ENROLLMENT }, select: { state: true } });
  });
});
