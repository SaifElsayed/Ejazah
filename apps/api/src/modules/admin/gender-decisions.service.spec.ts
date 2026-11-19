// T013 of specs/005-certification — the administrators' gender-flag queue as the admin module
// composes it (FR-614, FR-615; research R-409; contracts/admin-surface.md, `genderFlags.*`; the note
// under T013, Q-G1 (a)). Written before the composition, run red against its stub.
//
// - `get` answers moderation's flag and the preview of what a correction would end now: the
//   person's confirmed enrollments whose two declared genders would differ once the person's gender
//   is the other one, read from booking's and identity's entries; nothing for a deleted person;
//   005:T023 (B49, Q-G1 (b)): one line per such enrollment, in that order, with its own subject and
//   sessions and its other party relative to the person (whichever side the person is on), the name
//   null once that account is deleted; the count is the number of lines. Red first on the old
//   composition, then under named mutants (lane C's runs, `mutants`).
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
/** 005:T023: the live accounts' names, as identity's `sessionPartiesOf` answers them. */
let names: Map<string, string>;
/** 005:T023: the enrollments booking's `enrollmentsAmong` still answers. */
let present: Set<string>;

beforeEach(() => {
  calls = [];
  genders = new Map();
  names = new Map([
    [PERSON, 'الشخص المبلغ عنه'],
    [SAME, 'الطالب'],
    [SAME_TOO, 'المعلم'],
    [DIFFERENT, 'الآخر'],
  ]);
  present = new Set([E1, E2, E3, E4]);
});

/** 005:T023: two subjects, so a line drawn with another enrollment's subject shows. */
const TAJWEED = {
  id: '0199d0a0-0000-7000-8000-00000000c0d1',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const HIFZ = {
  id: '0199d0a0-0000-7000-8000-00000000c0d2',
  nameAr: 'الحفظ',
  nameEn: 'Memorisation',
};

/**
 * The person learns from `SAME_TOO` (E1, the person the student) and teaches `SAME` (E2),
 * `DIFFERENT` (E3) and a deleted one (E4). 005:T023: E1 is eight sessions of Tajweed, E2 four of
 * Hifz.
 */
const ENROLLMENTS = [
  { id: E1, studentUserId: PERSON, teacherUserId: SAME_TOO, subject: TAJWEED, sessions: 8 },
  { id: E2, studentUserId: SAME, teacherUserId: PERSON, subject: HIFZ, sessions: 4 },
  { id: E3, studentUserId: DIFFERENT, teacherUserId: PERSON, subject: HIFZ, sessions: 4 },
  { id: E4, studentUserId: GONE, teacherUserId: PERSON, subject: HIFZ, sessions: 4 },
];

const reads: GenderDecisionReads = {
  confirmedEnrollmentsOf: async (_tx, userId) => {
    calls.push({ name: 'confirmedEnrollmentsOf', args: [userId] });
    return ENROLLMENTS.map(({ id, studentUserId, teacherUserId }) => ({
      id,
      studentUserId,
      teacherUserId,
    }));
  },
  gendersOf: async (_tx, userIds) => {
    calls.push({ name: 'gendersOf', args: [userIds] });
    return new Map([...genders].filter(([id]) => userIds.includes(id)));
  },
  previewOf: async (_tx, enrollmentIds) => {
    calls.push({ name: 'previewOf', args: [enrollmentIds] });
    const rows = ENROLLMENTS.filter(({ id }) => enrollmentIds.includes(id) && present.has(id));
    return {
      enrollments: rows.map(({ id, studentUserId, teacherUserId, subject, sessions }) => ({
        id,
        studentUserId,
        teacherUserId,
        snapshotSubjectId: subject.id,
        snapshotSessionCount: sessions,
      })),
      subjects: new Map(rows.map(({ subject }) => [subject.id, subject])),
      names: new Map(
        [...names].filter(([id]) =>
          rows.some(
            ({ studentUserId, teacherUserId }) => id === studentUserId || id === teacherUserId,
          ),
        ),
      ),
    };
  },
};

/** 005:T023: the line of E1 (the person the student: the teacher the other party) and of E2. */
const LINE_E1 = {
  enrollmentId: E1,
  subject: TAJWEED,
  sessions: 8,
  counterpart: { userId: SAME_TOO, displayName: 'المعلم' },
};
const LINE_E2 = {
  enrollmentId: E2,
  subject: HIFZ,
  sessions: 4,
  counterpart: { userId: SAME, displayName: 'الطالب' },
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

/** T013's cases reach none of the correction's dependencies (005:T014). */
const unreached = (): never => {
  throw new Error('the correction is not this case');
};
const decisions = createGenderDecisions({
  flags,
  log,
  reads,
  enrollments: { enrollmentFor: unreached, lockEnrollments: unreached, cancel: unreached },
  idempotency: { runOn: unreached },
  orders: unreached,
  rerenderOfParty: unreached,
  standing: { ban: unreached, banStudent: unreached },
});

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
        correctionWouldEnd: { count: 2, lines: [LINE_E1, LINE_E2] },
      });
      expect(calls.map(({ name }) => name)).toEqual([
        'detail',
        'confirmedEnrollmentsOf',
        'gendersOf',
        'previewOf',
      ]);
      expect(calls[1]?.args).toEqual([PERSON]);
      // 005:T023: the lines read for the enrollments the preview ends, in its order.
      expect(calls[3]?.args).toEqual([[E1, E2]]);
    });
  }

  it('previews nothing for a person no longer there, reading no line', async () => {
    worldOf('male');
    genders.delete(PERSON);
    expect((await decisions.get(TX, ADMIN, { flagId: FLAG })).correctionWouldEnd).toEqual({
      count: 0,
      lines: [],
    });
    expect(calls.map(({ name }) => name)).not.toContain('previewOf');
  });

  // 005:T023 (Q-G1 (b)): the lines.
  it('names the other party of each line, whichever side the person is on, never the person', async () => {
    worldOf('female');
    const { lines } = (await decisions.get(TX, ADMIN, { flagId: FLAG })).correctionWouldEnd;
    expect(lines.map(({ counterpart }) => counterpart.userId)).toEqual([SAME_TOO, SAME]);
    expect(lines.map(({ counterpart }) => counterpart.userId)).not.toContain(PERSON);
  });

  it('draws each line with its own enrollment’s subject and sessions', async () => {
    worldOf('male');
    const { lines } = (await decisions.get(TX, ADMIN, { flagId: FLAG })).correctionWouldEnd;
    expect(
      lines.map(({ enrollmentId, subject, sessions }) => [enrollmentId, subject, sessions]),
    ).toEqual([
      [E1, TAJWEED, 8],
      [E2, HIFZ, 4],
    ]);
  });

  it('counts the lines it draws: an enrollment gone between the reads is neither drawn nor counted', async () => {
    worldOf('male');
    present.delete(E2);
    expect((await decisions.get(TX, ADMIN, { flagId: FLAG })).correctionWouldEnd).toEqual({
      count: 1,
      lines: [LINE_E1],
    });
  });

  it('keeps the other party’s id with no name once that account is deleted', async () => {
    worldOf('male');
    names.delete(SAME);
    expect((await decisions.get(TX, ADMIN, { flagId: FLAG })).correctionWouldEnd).toEqual({
      count: 2,
      lines: [LINE_E1, { ...LINE_E2, counterpart: { userId: SAME, displayName: null } }],
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
