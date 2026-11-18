// T058 of specs/004-sessions (FR-481, FR-459, FR-451, FR-426; SRS FR-ADMIN-4; the notes under T058,
// Q7, Q8, Q9) — the user directory over recorded stand-ins for identity's readers, the kernel's
// folded prefix and sessions' reads. What the procedures audit is `documents.router.spec.ts`'; over
// the real tables, `tests/db-integrity/user-directory.spec.ts`.
//
// THE REVIEWER'S REQUIREMENT (PDPL, a minor's data is sensitive): the date of birth is read only to
// derive `isMinor`; it never appears in `users.get`'s answer, nor in a log line.
import { isMinorOn } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { DirectoryUser, UserRecordRow } from '../identity/index.js';
import type { MarkedEnrollment } from '../sessions/index.js';
import { createUserDirectoryService, type UserDirectoryStore } from './user-directory.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000c2';
const DELETED_STUDENT = '0199d0a0-0000-7000-8000-0000000000c3';
const ENROLLMENT_A = '0199d0a0-0000-7000-8000-0000000000e1';
const ENROLLMENT_B = '0199d0a0-0000-7000-8000-0000000000e2';
const NOW = new Date('2026-11-12T10:00:00Z');
const JOINED = new Date('2026-09-01T08:00:00Z');
const MINOR_BIRTH = new Date('2012-03-04T00:00:00Z');
const ADULT_BIRTH = new Date('1990-01-01T00:00:00Z');
const PAGE_SIZE = 2;
/** B42b, T075 (Q-O2 (a)): `ban_restore_window_days`, unlike the seed's 14 so its read shows. */
const BAN_WINDOW_DAYS = 21;

/** Ten users, newest first, `u9` … `u0`; the even ones named «سارة …», the odd ones «أحمد …». */
const USERS: DirectoryUser[] = Array.from({ length: 10 }, (_unused, index) => {
  const at = 9 - index;
  return {
    id: `0199d0a0-0000-7000-8000-00000000010${String(at)}`,
    displayName: at % 2 === 0 ? `سارة ${String(at)}` : `أحمد ${String(at)}`,
    deleted: false,
    role: 'student' as const,
    accountStatus: 'active' as const,
  };
});

const TEACHER_ROW: UserRecordRow = {
  id: TEACHER,
  displayName: 'سارة',
  email: 'sara@example.test',
  createdAt: JOINED,
  deleted: false,
  gender: 'female',
  dateOfBirth: ADULT_BIRTH,
  accountStatus: 'active',
  role: 'teacher',
  teacherProfile: { bio: 'معلمة قرآن', qualification: 'إجازة', verificationStatus: 'approved' },
};

const STUDENT_ROW: UserRecordRow = {
  id: STUDENT,
  displayName: 'مريم',
  email: null,
  createdAt: JOINED,
  deleted: false,
  gender: 'female',
  dateOfBirth: MINOR_BIRTH,
  accountStatus: 'suspended',
  role: 'student',
  teacherProfile: null,
};

const MARKED: MarkedEnrollment[] = [
  { enrollmentId: ENROLLMENT_A, studentUserId: STUDENT, status: 'confirmed', teacherNoShows: 5 },
  {
    enrollmentId: ENROLLMENT_B,
    studentUserId: DELETED_STUDENT,
    status: 'terminated_no_show',
    teacherNoShows: 6,
  },
];

/** T077: a deleted teacher's kept data, as the kept-data reads answer it. */
const KEPT_DATA = {
  documents: [
    {
      id: '0199d0a0-0000-7000-8000-0000000000d1',
      kind: 'national_id' as const,
      uploadedAt: '2026-10-01T08:00:00.000Z',
    },
  ],
  payoutKept: true,
  eraseAt: null,
  erasedAt: null,
  // 005:T031 (rule d): the kept signature's field.
  signature: null,
};

function world({
  records = [TEACHER_ROW, STUDENT_ROW],
  heldUntil = new Map<string, Date>(),
  payoutKept = new Set<string>(),
}: {
  records?: UserRecordRow[];
  /** T072: the hold's end of each account's ban or revocation closings, sessions' read. */
  heldUntil?: Map<string, Date>;
  /** T077: the live teachers whose payout account a deleted teacher's kept profile holds. */
  payoutKept?: Set<string>;
} = {}) {
  const keptAsked: string[] = [];
  const pages: [string | undefined, number][] = [];
  const matched: string[][] = [];
  const settingsRead: string[] = [];
  const marksAsked: string[] = [];
  const countsAsked: string[] = [];
  const lines: { fields: unknown; message: string }[] = [];
  const store: UserDirectoryStore = {
    usersPage: async (after, limit) => {
      pages.push([after, limit]);
      const start = after === undefined ? 0 : USERS.findIndex(({ id }) => id === after) + 1;
      return USERS.slice(start, start + limit);
    },
    userRecord: async (userId) => records.find(({ id }) => id === userId) ?? null,
    namePrefixMatches: async (_tx, ids, typed) => {
      matched.push([...ids]);
      return USERS.filter(
        ({ id, displayName }) => ids.includes(id) && (displayName?.startsWith(typed) ?? false),
      ).map(({ id }) => id);
    },
    namesOf: async (_tx, ids) =>
      new Map(ids.flatMap((id) => (id === STUDENT ? [[id, 'مريم'] as const] : []))),
  };
  const settings: SettingsReader = {
    read: async (key, schema) => {
      settingsRead.push(key);
      // B42b, T075 (Q-O2 (a)): `users.get` reads the ban restore window for the panel's words.
      if (key === 'ban_restore_window_days') return schema.parse(BAN_WINDOW_DAYS);
      if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
      return schema.parse(PAGE_SIZE);
    },
  };
  const directory = createUserDirectoryService({
    store,
    settings,
    counts: {
      cancellationRequestCountsOf: async (_tx, userId) => {
        countsAsked.push(userId);
        return { total: 4, recent: 1 };
      },
    },
    marked: {
      markedEnrollmentsWithStudentsOf: async (_tx, teacherUserId) => {
        marksAsked.push(teacherUserId);
        return MARKED;
      },
    },
    log: {
      info: (fields: unknown, message: string) => {
        lines.push({ fields, message });
      },
    } as never,
    clock: async () => NOW,
    // T072 (Q9 (a)): sessions' `slotHeldUntilOf`.
    held: { slotHeldUntilOf: async (_tx, userId) => heldUntil.get(userId) ?? null },
    // T077 (N3): the kept-data reads.
    kept: {
      keptDataOf: async (_tx, userId) => {
        keptAsked.push(`kept ${userId}`);
        return KEPT_DATA;
      },
      payoutKeptOnDeletedTeacher: async (_tx, userId) => {
        keptAsked.push(`payout ${userId}`);
        return payoutKept.has(userId);
      },
    },
  });
  return { directory, pages, matched, settingsRead, marksAsked, countsAsked, lines, keptAsked };
}

const item = (user: DirectoryUser) => ({
  userId: user.id,
  displayName: user.displayName,
  deleted: user.deleted,
  role: user.role,
  accountStatus: user.accountStatus,
});

describe('users.list (T058, FR-481)', () => {
  it('reads one page of admin_list_page_size and one more, newest first, with the cursor of the last shown', async () => {
    const { directory, pages, settingsRead } = world();
    expect(await directory.list(tx, ADMIN, {})).toEqual({
      items: USERS.slice(0, PAGE_SIZE).map(item),
      nextCursor: USERS[PAGE_SIZE - 1]!.id,
    });
    expect(pages).toEqual([[undefined, PAGE_SIZE + 1]]);
    expect(settingsRead).toEqual(['admin_list_page_size']);
  });

  it('answers the last page without a cursor', async () => {
    const { directory } = world();
    expect(await directory.list(tx, ADMIN, { cursor: USERS[7]!.id })).toEqual({
      items: USERS.slice(8).map(item),
    });
  });

  it('searches the name in doubling batches, matching only the ids each batch read, until the page holds one more', async () => {
    const { directory, pages, matched } = world();
    // «سارة» is every other user: batches of 3 then 6 read six users and keep three.
    expect(await directory.list(tx, ADMIN, { name: 'سارة' })).toEqual({
      items: [USERS[1]!, USERS[3]!].map(item),
      nextCursor: USERS[3]!.id,
    });
    expect(pages).toEqual([
      [undefined, PAGE_SIZE + 1],
      [USERS[PAGE_SIZE]!.id, 2 * (PAGE_SIZE + 1)],
    ]);
    expect(matched).toEqual([
      USERS.slice(0, 3).map(({ id }) => id),
      USERS.slice(3, 9).map(({ id }) => id),
    ]);
  });

  it('stops at the end of the users with a short page and no cursor', async () => {
    const { directory, pages } = world();
    expect(await directory.list(tx, ADMIN, { name: 'لا أحد' })).toEqual({ items: [] });
    expect(pages.at(-1)).toEqual([USERS[8]!.id, 4 * (PAGE_SIZE + 1)]);
  });
});

describe('users.get (T058, SRS FR-ADMIN-4)', () => {
  it("answers a teacher's record: profile, role, gender, the minor flag, statuses, counts and the marked enrollments", async () => {
    const { directory, marksAsked, countsAsked, lines } = world();
    expect(await directory.get(tx, ADMIN, { targetUserId: TEACHER })).toEqual({
      userId: TEACHER,
      profile: {
        displayName: 'سارة',
        email: 'sara@example.test',
        joinedAt: JOINED.toISOString(),
        deleted: false,
        teacher: { bio: 'معلمة قرآن', qualification: 'إجازة' },
      },
      role: 'teacher',
      gender: 'female',
      isMinor: false,
      verificationStatus: 'approved',
      accountStatus: 'active',
      cancellationRequests: { total: 4, recent: 1 },
      repeatedAbsences: [
        {
          enrollmentId: ENROLLMENT_A,
          student: { userId: STUDENT, displayName: 'مريم', deleted: false },
          status: 'confirmed',
          teacherNoShows: 5,
        },
        {
          enrollmentId: ENROLLMENT_B,
          student: { userId: DELETED_STUDENT, displayName: null, deleted: true },
          status: 'terminated_no_show',
          teacherNoShows: 6,
        },
      ],
      enrollmentsSlotHeldUntil: null,
      banRestoreWindowDays: BAN_WINDOW_DAYS,
      // T077 (rule d): a live teacher's payout match, additive.
      payoutKeptOnDeletedTeacher: false,
    });
    expect(marksAsked).toEqual([TEACHER]);
    expect(countsAsked).toEqual([TEACHER]);
    expect(lines).toEqual([]);
  });

  it("answers a student's record with the minor flag at the database's clock, and no teacher's fields", async () => {
    const { directory, marksAsked } = world();
    const answer = await directory.get(tx, ADMIN, { targetUserId: STUDENT });
    expect(isMinorOn('2012-03-04', '2026-11-12')).toBe(true);
    expect(answer).toEqual({
      userId: STUDENT,
      profile: { displayName: 'مريم', email: null, joinedAt: JOINED.toISOString(), deleted: false },
      role: 'student',
      gender: 'female',
      isMinor: true,
      verificationStatus: null,
      accountStatus: 'suspended',
      cancellationRequests: { total: 4, recent: 1 },
      enrollmentsSlotHeldUntil: null,
      banRestoreWindowDays: BAN_WINDOW_DAYS,
    });
    expect(marksAsked).toEqual([]);
  });

  // T072 of specs/004-sessions (FR-502, FR-503; the note under T072, Q9 (a)).
  it('answers enrollmentsSlotHeldUntil, the hold end sessions reads for the account’s ban or revocation closings', async () => {
    const until = new Date('2026-11-27T08:00:00Z');
    const { directory } = world({ heldUntil: new Map([[STUDENT, until]]) });
    expect(
      (await directory.get(tx, ADMIN, { targetUserId: STUDENT })).enrollmentsSlotHeldUntil,
    ).toBe(until.toISOString());
    expect(
      (await directory.get(tx, ADMIN, { targetUserId: TEACHER })).enrollmentsSlotHeldUntil,
    ).toBeNull();
  });

  // B42b, T075 of specs/004-sessions (Q-O2 (a)): the panel's `{days}` in the ban's and the lift's words.
  it('answers banRestoreWindowDays, the ban_restore_window_days setting, for a student and a teacher', async () => {
    const { directory, settingsRead } = world();
    for (const targetUserId of [STUDENT, TEACHER]) {
      expect((await directory.get(tx, ADMIN, { targetUserId })).banRestoreWindowDays).toBe(
        BAN_WINDOW_DAYS,
      );
    }
    expect(settingsRead).toEqual(['ban_restore_window_days', 'ban_restore_window_days']);
  });

  it('never answers or logs the date of birth (PDPL)', async () => {
    const { directory, lines } = world();
    for (const targetUserId of [TEACHER, STUDENT]) {
      const text = JSON.stringify(await directory.get(tx, ADMIN, { targetUserId }));
      expect(text).not.toMatch(/birth|dob/i);
      for (const date of [MINOR_BIRTH, ADULT_BIRTH]) {
        expect(text).not.toContain(date.toISOString().slice(0, 10));
      }
    }
    expect(JSON.stringify(lines)).not.toContain('2012-03-04');
  });

  it('refuses NOT_FOUND for no such user, one info line of ids and a reason, reading nothing else', async () => {
    const { directory, lines, countsAsked, marksAsked } = world({ records: [] });
    await expect(directory.get(tx, ADMIN, { targetUserId: TEACHER })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(lines).toEqual([
      {
        fields: { adminId: ADMIN, userId: TEACHER, errorCode: 'NOT_FOUND', reason: 'not_found' },
        message: 'A user directory read was refused',
      },
    ]);
    expect(countsAsked).toEqual([]);
    expect(marksAsked).toEqual([]);
  });
});

// T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077, N3): `users.get` answers a
// deleted teacher's kept data and a live teacher's payout match, both optional and additive; a
// student answers neither, and neither read is asked for one.
describe('users.get: the kept data (T077)', () => {
  const DELETED_TEACHER: UserRecordRow = {
    ...TEACHER_ROW,
    displayName: null,
    email: null,
    deleted: true,
    dateOfBirth: null,
    teacherProfile: { bio: '', qualification: '', verificationStatus: 'approved' },
  };

  it("answers a deleted teacher's kept data, and no payout match", async () => {
    const { directory, keptAsked } = world({ records: [DELETED_TEACHER] });
    const record = await directory.get(tx, ADMIN, { targetUserId: TEACHER });
    expect(record.keptData).toEqual(KEPT_DATA);
    expect(record).not.toHaveProperty('payoutKeptOnDeletedTeacher');
    expect(keptAsked).toEqual([`kept ${TEACHER}`]);
  });

  it("answers a live teacher's payout match, and no kept data", async () => {
    const { directory, keptAsked } = world({ payoutKept: new Set([TEACHER]) });
    const record = await directory.get(tx, ADMIN, { targetUserId: TEACHER });
    expect(record.payoutKeptOnDeletedTeacher).toBe(true);
    expect(record).not.toHaveProperty('keptData');
    expect(keptAsked).toEqual([`payout ${TEACHER}`]);
  });

  it('answers a student, live or deleted, neither', async () => {
    const deletedStudent = { ...STUDENT_ROW, deleted: true, displayName: null };
    for (const records of [[STUDENT_ROW], [deletedStudent]]) {
      const { directory, keptAsked } = world({ records });
      const record = await directory.get(tx, ADMIN, { targetUserId: STUDENT });
      expect(record).not.toHaveProperty('keptData');
      expect(record).not.toHaveProperty('payoutKeptOnDeletedTeacher');
      expect(keptAsked).toEqual([]);
    }
  });
});
