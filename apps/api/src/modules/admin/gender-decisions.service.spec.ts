// T013 of specs/005-certification — the administrators' gender-flag queue as the admin module
// composes it (FR-614, FR-615; research R-409; contracts/admin-surface.md, `genderFlags.*`; the note
// under T013, Q-G1 (a)). Written before the composition, run red against its stub.
//
// - `get` answers moderation's flag and the preview of what a correction would end now: the
//   person's confirmed enrollments whose two declared genders would differ once the person's gender
//   is the other one, read from booking's and identity's entries; nothing for a deleted person;
// - `list`, `raise` and `dismiss` are moderation's, on the call's transaction, with the log.
// Both genders are proved: a man corrected to a woman and a woman to a man.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Gender } from '../../platform/guards/requester-gender.js';
import type { AdminGenderFlags, GenderFlagDetail } from '../moderation/index.js';
import {
  createGenderDecisions,
  type GenderDecisionReads,
  otherGender,
  pairingTwoGenders,
} from './gender-decisions.service.js';

const FLAG = '0199d0a0-0000-7000-8000-00000000c0f1';
const PERSON = '0199d0a0-0000-7000-8000-00000000c0a1';
const SAME = '0199d0a0-0000-7000-8000-00000000c0a2';
const SAME_TOO = '0199d0a0-0000-7000-8000-00000000c0a3';
const DIFFERENT = '0199d0a0-0000-7000-8000-00000000c0a4';
const GONE = '0199d0a0-0000-7000-8000-00000000c0a5';
const ADMIN = '0199d0a0-0000-7000-8000-00000000c0b9';
const E1 = '0199d0a0-0000-7000-8000-00000000c0e1';
const E2 = '0199d0a0-0000-7000-8000-00000000c0e2';
const E3 = '0199d0a0-0000-7000-8000-00000000c0e3';
const E4 = '0199d0a0-0000-7000-8000-00000000c0e4';
const TX = {} as Transaction;
const KEY = 'flag-decision-key-for-the-spec-0002';

const DETAIL: GenderFlagDetail = {
  flagId: FLAG,
  flaggedUserId: PERSON,
  raisedByUserId: null,
  reportId: null,
  status: 'open',
  createdAt: '2026-11-18T09:00:00.000Z',
  reason: 'سبب',
  resolution: null,
};

let calls: { name: string; args: unknown[] }[];
let genders: Map<string, Gender>;

beforeEach(() => {
  calls = [];
  genders = new Map();
});

/** The person teaches `SAME` (E2) and `SAME_TOO` (E1), `DIFFERENT` (E3) and a deleted one (E4). */
const reads: GenderDecisionReads = {
  confirmedEnrollmentsOf: async (_tx, userId) => {
    calls.push({ name: 'confirmedEnrollmentsOf', args: [userId] });
    return [
      { id: E1, studentUserId: SAME_TOO, teacherUserId: PERSON },
      { id: E2, studentUserId: SAME, teacherUserId: PERSON },
      { id: E3, studentUserId: DIFFERENT, teacherUserId: PERSON },
      { id: E4, studentUserId: GONE, teacherUserId: PERSON },
    ];
  },
  gendersOf: async (_tx, userIds) => {
    calls.push({ name: 'gendersOf', args: [userIds] });
    return new Map([...genders].filter(([id]) => userIds.includes(id)));
  },
};

const log = { info: () => undefined, warn: () => undefined };

const flags: AdminGenderFlags = {
  raiseByAdministrator: async (...args) => {
    calls.push({ name: 'raiseByAdministrator', args });
    return { flagId: FLAG, replayed: false };
  },
  list: async (...args) => {
    calls.push({ name: 'list', args });
    return { items: [DETAIL], nextCursor: FLAG };
  },
  detail: async (...args) => {
    calls.push({ name: 'detail', args });
    return DETAIL;
  },
  dismiss: async (...args) => {
    calls.push({ name: 'dismiss', args });
    return { flaggedUserId: PERSON, replayed: false };
  },
};

const decisions = createGenderDecisions({ flags, log, reads });

function worldOf(person: Gender) {
  const other = otherGender(person);
  genders.set(PERSON, person);
  genders.set(SAME, person);
  genders.set(SAME_TOO, person);
  genders.set(DIFFERENT, other);
}

describe('the correction’s preview (pairingTwoGenders, otherGender)', () => {
  it('the other gender of each', () => {
    expect(otherGender('male')).toBe('female');
    expect(otherGender('female')).toBe('male');
  });

  it('the person’s enrollments that would pair two genders, in id order, an absent party left out', () => {
    worldOf('male');
    const enrollments = [
      { id: E2, studentUserId: SAME, teacherUserId: PERSON },
      { id: E1, studentUserId: PERSON, teacherUserId: SAME_TOO },
      { id: E3, studentUserId: DIFFERENT, teacherUserId: PERSON },
      { id: E4, studentUserId: GONE, teacherUserId: PERSON },
    ];
    expect(pairingTwoGenders(enrollments, genders, PERSON, 'female')).toEqual([E1, E2]);
    expect(pairingTwoGenders(enrollments, genders, PERSON, 'male')).toEqual([E3]);
  });
});

describe('genderFlags.get', () => {
  for (const person of ['male', 'female'] as const) {
    it(`adds what a correction of a ${person} declaration would end now`, async () => {
      worldOf(person);
      expect(await decisions.get(TX, ADMIN, { flagId: FLAG })).toEqual({
        ...DETAIL,
        correctionWouldEnd: { count: 2, enrollmentIds: [E1, E2] },
      });
      expect(calls.map(({ name }) => name)).toEqual([
        'detail',
        'confirmedEnrollmentsOf',
        'gendersOf',
      ]);
      expect(calls[1]?.args).toEqual([PERSON]);
    });
  }

  it('previews nothing for a person no longer there', async () => {
    worldOf('male');
    genders.delete(PERSON);
    expect((await decisions.get(TX, ADMIN, { flagId: FLAG })).correctionWouldEnd).toEqual({
      count: 0,
      enrollmentIds: [],
    });
  });
});

describe('genderFlags.list, .raise and .dismiss', () => {
  it('are moderation’s, on the call’s transaction, with the log', async () => {
    expect(await decisions.list(TX, ADMIN, { status: 'open' })).toEqual({
      items: [DETAIL],
      nextCursor: FLAG,
    });
    const raise = { targetUserId: PERSON, reason: 'سبب', idempotencyKey: KEY };
    expect(await decisions.raise(TX, ADMIN, raise)).toEqual({ flagId: FLAG, replayed: false });
    const dismiss = { flagId: FLAG, reason: 'سبب', idempotencyKey: KEY };
    expect(await decisions.dismiss(TX, ADMIN, dismiss)).toEqual({
      flaggedUserId: PERSON,
      replayed: false,
    });
    expect(calls).toEqual([
      { name: 'list', args: [TX, ADMIN, { status: 'open' }, log] },
      { name: 'raiseByAdministrator', args: [TX, ADMIN, raise, log] },
      { name: 'dismiss', args: [TX, ADMIN, dismiss, log] },
    ]);
  });
});
