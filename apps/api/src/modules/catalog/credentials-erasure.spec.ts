// T174 (SRS DEC-97, FR-AUTH-14; the note under T174, (5)): catalog's deletion consequence over a
// transaction that records what it is asked, so the order and the guard are what this proves; the
// real tables are `tests/db-integrity/teacher-credential-history.spec.ts`'s and
// `teacher-deletion.spec.ts`'s. On `account_deleted` of a teacher never approved: the credentials'
// four transcribed columns blanked, their chains deleted, then their history; a teacher once approved
// keeps all of it; any other cause changes nothing.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { catalogDeletionConsequence } from './credentials-erasure.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';

/** A transaction that answers `approvedAt` for the profile and records every call, in order. */
function recording(approvedAt: Date | null) {
  const calls: { readonly call: string; readonly args: unknown }[] = [];
  const note =
    (call: string, answer: unknown = { count: 1 }) =>
    async (args: unknown) => {
      calls.push({ call, args });
      return answer;
    };
  const tx = {
    teacherProfile: { findUnique: note('teacherProfile.findUnique', { approvedAt }) },
    teacherCredential: { updateMany: note('teacherCredential.updateMany') },
    isnadEntry: { deleteMany: note('isnadEntry.deleteMany') },
    teacherCredentialHistory: { deleteMany: note('teacherCredentialHistory.deleteMany') },
  } as unknown as Transaction;
  return { tx, calls };
}

describe('catalogDeletionConsequence (T174)', () => {
  it('blanks the credentials of a teacher never approved, deletes their chains, then their history', async () => {
    const { tx, calls } = recording(null);
    await catalogDeletionConsequence()(tx, TEACHER, 'account_deleted');
    expect(calls).toEqual([
      { call: 'teacherProfile.findUnique', args: expect.anything() },
      {
        call: 'teacherCredential.updateMany',
        args: {
          where: { teacherUserId: TEACHER },
          data: { holderName: null, riwaya: null, tariq: null, reviewReason: null },
        },
      },
      {
        call: 'isnadEntry.deleteMany',
        args: { where: { credential: { teacherUserId: TEACHER } } },
      },
      // The erasure reads `approved_at` again itself (the owner's guard, Q-2 (a)).
      { call: 'teacherProfile.findUnique', args: expect.anything() },
      {
        call: 'teacherCredentialHistory.deleteMany',
        args: { where: { credential: { teacherUserId: TEACHER } } },
      },
    ]);
  });

  it('writes nothing for a teacher once approved', async () => {
    const { tx, calls } = recording(new Date('2026-09-01T00:00:00Z'));
    await catalogDeletionConsequence()(tx, TEACHER, 'account_deleted');
    expect(calls.map(({ call }) => call)).toEqual(['teacherProfile.findUnique']);
  });

  it.each(['suspended', 'approval_revoked', 'banned'] as const)(
    'reads and writes nothing on %s',
    async (cause) => {
      const { tx, calls } = recording(null);
      await catalogDeletionConsequence()(tx, TEACHER, cause);
      expect(calls).toEqual([]);
    },
  );
});
