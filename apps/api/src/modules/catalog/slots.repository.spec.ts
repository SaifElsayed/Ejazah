// 006:T004 (R-504, FR-701, FR-PROFILE-8 as amended by DEC-94; Q-5 (a)) — `offeredSlotsOf`, the
// slots booking may offer, by the shape of each teacher's active packages. A package with a count
// offers the teacher's active slots of exactly its length (T026, as today); a programme package
// offers every active slot at least as long as the assessment, only when the caller names that
// length (the programme open); with none named, a programme package offers nothing. Over a
// recording stand-in of the client; the rows against Postgres are `tests/db-integrity`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { offeredSlotsOf } from './slots.repository.js';

const FIXED_TEACHER = '0199d0a0-0000-7000-8000-0000000006d1';
const PROGRAMME_TEACHER = '0199d0a0-0000-7000-8000-0000000006d2';
const START = new Date('1970-01-01T17:00:00.000Z');

function slot(id: string, teacherUserId: string, durationMinutes: number) {
  return {
    id,
    teacherUserId,
    dayOfWeek: 2,
    startTimeLocal: START,
    durationMinutes,
    timezone: 'Africa/Cairo',
  };
}

const SLOTS = [
  slot('s1', FIXED_TEACHER, 30),
  slot('s2', FIXED_TEACHER, 60),
  slot('s3', PROGRAMME_TEACHER, 30),
  slot('s4', PROGRAMME_TEACHER, 45),
  slot('s5', PROGRAMME_TEACHER, 60),
];

/** The teachers' active packages: one of 30 minutes, and a programme package. */
const PACKAGES = [
  { teacherUserId: FIXED_TEACHER, isProgramme: false, sessionDurationMinutes: 30 },
  { teacherUserId: PROGRAMME_TEACHER, isProgramme: true, sessionDurationMinutes: null },
];

function clientOf() {
  const calls: [string, unknown][] = [];
  const client = {
    package: {
      findMany: async (query: {
        where: { teacherUserId: { in: string[] }; isProgramme?: boolean };
      }) => {
        calls.push(['package.findMany', query]);
        return PACKAGES.filter(
          (row) =>
            query.where.teacherUserId.in.includes(row.teacherUserId) &&
            (query.where.isProgramme === undefined || row.isProgramme === query.where.isProgramme),
        );
      },
    },
    availabilitySlot: {
      findMany: async (query: unknown) => {
        calls.push(['availabilitySlot.findMany', query]);
        return SLOTS;
      },
    },
  } as unknown as Pick<Transaction, 'availabilitySlot' | 'package'>;
  return { client, calls };
}

const ids = (slots: readonly { readonly id: string }[]) => slots.map(({ id }) => id);

describe('offeredSlotsOf by package shape (006:T004)', () => {
  it('offers a package with a count the teacher’s slots of exactly its length, as today', async () => {
    const { client } = clientOf();
    expect(ids(await offeredSlotsOf(client, [FIXED_TEACHER, PROGRAMME_TEACHER]))).toEqual(['s1']);
  });

  it('offers nothing for a programme package while no assessment length is named (the programme closed)', async () => {
    const { client, calls } = clientOf();
    expect(ids(await offeredSlotsOf(client, [PROGRAMME_TEACHER]))).toEqual([]);
    expect(calls[0]?.[1]).toMatchObject({ where: { isProgramme: false } });
  });

  it('offers a programme package every active slot at least as long as the assessment', async () => {
    const { client } = clientOf();
    expect(ids(await offeredSlotsOf(client, [PROGRAMME_TEACHER], 45))).toEqual(['s4', 's5']);
    const { client: again } = clientOf();
    expect(ids(await offeredSlotsOf(again, [PROGRAMME_TEACHER], 30))).toEqual(['s3', 's4', 's5']);
  });

  it('keeps each teacher’s own rule: the count’s length for one, the assessment’s floor for the other', async () => {
    const { client } = clientOf();
    expect(ids(await offeredSlotsOf(client, [FIXED_TEACHER, PROGRAMME_TEACHER], 45))).toEqual([
      's1',
      's4',
      's5',
    ]);
  });
});
