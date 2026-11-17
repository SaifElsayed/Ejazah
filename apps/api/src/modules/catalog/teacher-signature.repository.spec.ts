// T003 of specs/005-certification — the `teacher_signatures` queries (R-411; ERD, `teacher_signatures`,
// `teacher_user_id` unique). Queries only: the current row read by the teacher, and the one row
// written by the teacher's unique, inserted the first time and replaced after, its key and instant
// the caller's. The service's lock and its order are teacher-signature.service.spec.ts's; here the
// statements each function sends, over a recording stand-in of the client.
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { signatureOf, writeSignature } from './teacher-signature.repository.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000005d1';
const ROW = {
  id: '0199d0a0-0000-7000-8000-0000000005d2',
  storageKey: `signatures/${TEACHER}/a.png`,
  uploadedAt: new Date('2026-11-17T09:30:00.000Z'),
};
const SELECT = { id: true, storageKey: true, uploadedAt: true };

function clientOf(found: typeof ROW | null) {
  const calls: [string, unknown][] = [];
  const client = {
    teacherSignature: {
      findUnique: async (query: unknown) => {
        calls.push(['findUnique', query]);
        return found;
      },
      upsert: async (query: unknown) => {
        calls.push(['upsert', query]);
        return ROW;
      },
    },
  } as unknown as Pick<Transaction, 'teacherSignature'>;
  return { client, calls };
}

describe('teacher_signatures queries (T003 of specs/005-certification)', () => {
  it('reads the teacher’s current row by the unique, its id, key and instant', async () => {
    const { client, calls } = clientOf(ROW);
    await expect(signatureOf(client, TEACHER)).resolves.toStrictEqual(ROW);
    expect(calls).toEqual([['findUnique', { where: { teacherUserId: TEACHER }, select: SELECT }]]);
  });

  it('answers null for a teacher holding none', async () => {
    const { client, calls } = clientOf(null);
    await expect(signatureOf(client, TEACHER)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('writes the one row by the unique: inserted with the key and instant, or replaced with both', async () => {
    const { client, calls } = clientOf(null);
    const write = {
      teacherUserId: TEACHER,
      storageKey: ROW.storageKey,
      uploadedAt: ROW.uploadedAt,
    };
    await expect(writeSignature(client, write)).resolves.toStrictEqual(ROW);
    expect(calls).toEqual([
      [
        'upsert',
        {
          where: { teacherUserId: TEACHER },
          create: write,
          update: { storageKey: ROW.storageKey, uploadedAt: ROW.uploadedAt },
          select: SELECT,
        },
      ],
    ]);
  });
});
