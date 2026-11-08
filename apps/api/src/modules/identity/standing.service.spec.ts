// T064 — a teacher's standing (admin-surface.md "`teachers`"; FR-165, FR-142, FR-162, ADR 0016 D2).
// Suspension, revocation and ban change the standing, revoke every session of the person, and call
// the one consequences entry (`onAccountTerminated(tx, userId, cause)`, the registry Phase 2 and 3
// subscribe to; empty in this phase, so a spy subscribes). A suspension writes `account_status` only;
// a revocation writes `verification_status = revoked` and `application_status = rejected` with the
// reason as the note, removes the teacher's subjects and keeps the account active; a ban is
// permanent and is one function for the applicant and the teacher, the applicant's note written to
// the application; only a suspended teacher is reinstated, to `verification_required` while an
// identity request is open and to `active` otherwise (T113). An identity request moves an active
// account to `verification_required` and back. Over a store held in memory that keeps the
// database's rules; the queries are probed in `tests/db-integrity/application-review.spec.ts`.
import { beforeEach, describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { bindToTransaction } from '../../platform/live/live-publisher.js';
import { MemoryStandingStore, TX } from './__fixtures__/standing-store.js';
import { AccountConsequences, type TerminationCause } from './consequences.js';
import { StandingService } from './standing.service.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-10-22T10:00:00Z');

let store: MemoryStandingStore;
let consequences: { userId: string; cause: TerminationCause }[];
let subjectsRevoked: string[];
let openIdentityRequests: Set<string>;
let standing: StandingService;

beforeEach(() => {
  store = new MemoryStandingStore();
  consequences = [];
  subjectsRevoked = [];
  openIdentityRequests = new Set();
  const registry = new AccountConsequences();
  registry.subscribe(async (_tx, userId, cause) => {
    consequences.push({ userId, cause });
  });
  standing = new StandingService({
    store,
    consequences: registry,
    revokeSubjects: async (_tx, userId) => {
      subjectsRevoked.push(userId);
    },
    hasOpenIdentityRequest: async (_tx, userId) => openIdentityRequests.has(userId),
    now: () => NOW,
  });
});

const approvedTeacher = (accountStatus: 'active' | 'suspended' = 'active') =>
  store.plant({
    accountStatus,
    teacher: { verificationStatus: 'approved', applicationStatus: 'approved' },
  });

const applicant = (status: 'in_review' | 'needs_document' | 'rejected') =>
  store.plant({
    teacher: {
      verificationStatus: status === 'rejected' ? 'rejected' : 'pending',
      applicationStatus: status,
    },
  });

async function refusal(call: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return { code: thrown.code, details: thrown.details };
}

const sessionOf = (userId: string) => store.person(userId).sessions[0];

describe('suspend', () => {
  it('suspends the account only, revokes every session and calls the consequences', async () => {
    const userId = approvedTeacher();
    await standing.suspend(TX, ADMIN, userId);
    expect(store.person(userId).accountStatus).toBe('suspended');
    expect(store.person(userId).teacher?.verificationStatus).toBe('approved');
    expect(sessionOf(userId)).toEqual({ revokedReason: 'account_suspended', revokedAt: NOW });
    expect(consequences).toEqual([{ userId, cause: 'suspended' }]);
  });

  it('suspends a teacher whose identity is under request (B13b review, follow-up 2)', async () => {
    const userId = store.plant({
      accountStatus: 'verification_required',
      teacher: { verificationStatus: 'approved', applicationStatus: 'approved' },
    });
    await standing.suspend(TX, ADMIN, userId);
    expect(store.person(userId).accountStatus).toBe('suspended');
    expect(consequences).toEqual([{ userId, cause: 'suspended' }]);
  });

  it('refuses a teacher already suspended, naming the standing, and an applicant', async () => {
    const suspended = approvedTeacher('suspended');
    const pending = applicant('in_review');
    expect(await refusal(standing.suspend(TX, ADMIN, suspended))).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'teacherUserId', code: 'suspended' }],
    });
    expect((await refusal(standing.suspend(TX, ADMIN, pending))).code).toBe('CONFLICT');
    expect(consequences).toEqual([]);
    expect(sessionOf(pending)?.revokedAt).toBeNull();
  });

  it('answers NOT_FOUND for a person with no teacher profile, or no person', async () => {
    const student = store.plant();
    expect((await refusal(standing.suspend(TX, ADMIN, student))).code).toBe('NOT_FOUND');
    expect((await refusal(standing.suspend(TX, ADMIN, ADMIN))).code).toBe('NOT_FOUND');
  });
});

describe('revokeApproval', () => {
  it('revokes, rejects with the reason as the note, removes the subjects and keeps the account active', async () => {
    const userId = approvedTeacher();
    await standing.revokeApproval(TX, ADMIN, userId, 'شكوى موثّقة من طالب');
    expect(store.person(userId)).toMatchObject({
      accountStatus: 'active',
      teacher: {
        verificationStatus: 'revoked',
        applicationStatus: 'rejected',
        applicationNote: 'شكوى موثّقة من طالب',
        decidedAt: NOW,
        decidedBy: ADMIN,
      },
    });
    expect(subjectsRevoked).toEqual([userId]);
    expect(sessionOf(userId)?.revokedReason).toBe('admin_action');
    expect(consequences).toEqual([{ userId, cause: 'approval_revoked' }]);
  });

  it("revokes a suspended teacher's approval too", async () => {
    const userId = approvedTeacher('suspended');
    await standing.revokeApproval(TX, ADMIN, userId, 'سبب');
    expect(store.person(userId).teacher?.verificationStatus).toBe('revoked');
  });

  it('refuses a teacher who is not approved, removing nothing', async () => {
    const pending = applicant('in_review');
    expect((await refusal(standing.revokeApproval(TX, ADMIN, pending, 'سبب'))).code).toBe(
      'CONFLICT',
    );
    expect(subjectsRevoked).toEqual([]);
  });
});

describe('ban', () => {
  it('bans an approved teacher for good: the account and the standing, sessions and consequences', async () => {
    const userId = approvedTeacher();
    await standing.ban(TX, ADMIN, userId);
    expect(store.person(userId).accountStatus).toBe('banned');
    expect(store.person(userId).teacher?.verificationStatus).toBe('banned');
    expect(sessionOf(userId)?.revokedReason).toBe('account_banned');
    expect(consequences).toEqual([{ userId, cause: 'banned' }]);
  });

  it('bans a suspended teacher too', async () => {
    const userId = approvedTeacher('suspended');
    await standing.ban(TX, ADMIN, userId);
    expect(store.person(userId).accountStatus).toBe('banned');
  });

  it.each(['in_review', 'needs_document'] as const)(
    'bans an applicant whose application is %s, writing the note the applicant sees',
    async (status) => {
      const userId = applicant(status);
      await standing.ban(TX, ADMIN, userId, { applicantNote: 'وثيقة الهوية معدَّلة' });
      expect(store.person(userId)).toMatchObject({
        accountStatus: 'banned',
        teacher: {
          verificationStatus: 'banned',
          applicationStatus: 'banned',
          applicationNote: 'وثيقة الهوية معدَّلة',
          decidedBy: ADMIN,
          decidedAt: NOW,
        },
      });
      expect(sessionOf(userId)?.revokedReason).toBe('account_banned');
      expect(consequences).toEqual([{ userId, cause: 'banned' }]);
    },
  );

  it('bans a teacher whose approval was revoked, through the teacher path (B13b review, follow-up 3)', async () => {
    const userId = store.plant({
      teacher: { verificationStatus: 'revoked', applicationStatus: 'rejected' },
    });
    await standing.ban(TX, ADMIN, userId);
    expect(store.person(userId)).toMatchObject({
      accountStatus: 'banned',
      teacher: { verificationStatus: 'banned', applicationStatus: 'rejected' },
    });
    expect(consequences).toEqual([{ userId, cause: 'banned' }]);
  });

  it('bans a rejected applicant through the applicant path, writing the note (B13b review, follow-up 3)', async () => {
    const userId = applicant('rejected');
    await standing.ban(TX, ADMIN, userId, { applicantNote: 'وثائق مزوّرة' });
    expect(store.person(userId)).toMatchObject({
      accountStatus: 'banned',
      teacher: {
        verificationStatus: 'banned',
        applicationStatus: 'banned',
        applicationNote: 'وثائق مزوّرة',
      },
    });
  });

  it('refuses an applicant through the teacher path and a teacher through the applicant path', async () => {
    const pending = applicant('in_review');
    const teacher = approvedTeacher();
    expect((await refusal(standing.ban(TX, ADMIN, pending))).code).toBe('CONFLICT');
    expect((await refusal(standing.ban(TX, ADMIN, teacher, { applicantNote: 'سبب' }))).code).toBe(
      'CONFLICT',
    );
    expect(store.person(pending).accountStatus).toBe('active');
    expect(store.person(teacher).accountStatus).toBe('active');
  });

  it('refuses an account already banned, by either path', async () => {
    const teacher = approvedTeacher();
    await standing.ban(TX, ADMIN, teacher);
    expect((await refusal(standing.ban(TX, ADMIN, teacher, { applicantNote: 'سبب' }))).code).toBe(
      'CONFLICT',
    );
    expect(await refusal(standing.ban(TX, ADMIN, teacher))).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'teacherUserId', code: 'banned' }],
    });
  });
});

describe('reinstate', () => {
  it('returns a suspended teacher with no open identity request to active, calling no consequence', async () => {
    const userId = approvedTeacher('suspended');
    await standing.reinstate(TX, ADMIN, userId);
    expect(store.person(userId).accountStatus).toBe('active');
    expect(consequences).toEqual([]);
  });

  it('returns a suspended teacher with an open identity request to verification_required (T113)', async () => {
    const userId = approvedTeacher('suspended');
    openIdentityRequests.add(userId);
    await standing.reinstate(TX, ADMIN, userId);
    expect(store.person(userId).accountStatus).toBe('verification_required');
    expect(consequences).toEqual([]);
  });

  it('refuses an active teacher and a banned one: a ban is not lifted from the panel', async () => {
    const active = approvedTeacher();
    const banned = approvedTeacher();
    await standing.ban(TX, ADMIN, banned);
    expect((await refusal(standing.reinstate(TX, ADMIN, active))).code).toBe('CONFLICT');
    expect((await refusal(standing.reinstate(TX, ADMIN, banned))).code).toBe('CONFLICT');
    expect(store.person(banned).accountStatus).toBe('banned');
  });
});

describe('the identity request', () => {
  it('moves an active account to verification_required and back', async () => {
    const userId = store.plant();
    expect(await standing.requireIdentity(TX, userId)).toBe(true);
    expect(store.person(userId).accountStatus).toBe('verification_required');
    await standing.identityAccepted(TX, userId);
    expect(store.person(userId).accountStatus).toBe('active');
  });

  it('leaves a suspended account as it is either way', async () => {
    const userId = store.plant({ accountStatus: 'suspended' });
    expect(await standing.requireIdentity(TX, userId)).toBe(false);
    await standing.identityAccepted(TX, userId);
    expect(store.person(userId).accountStatus).toBe('suspended');
  });
});

describe("the audit entry's before and after (T116)", () => {
  it('suspend answers the account status it moved from, active or under an identity request', async () => {
    const active = approvedTeacher();
    const underRequest = store.plant({
      accountStatus: 'verification_required',
      teacher: { verificationStatus: 'approved', applicationStatus: 'approved' },
    });
    expect(await standing.suspend(TX, ADMIN, active)).toEqual({
      before: { accountStatus: 'active' },
      after: { accountStatus: 'suspended' },
    });
    expect(await standing.suspend(TX, ADMIN, underRequest)).toEqual({
      before: { accountStatus: 'verification_required' },
      after: { accountStatus: 'suspended' },
    });
  });

  it('revokeApproval answers the verification status it moved from', async () => {
    const userId = approvedTeacher('suspended');
    expect(await standing.revokeApproval(TX, ADMIN, userId, 'شكوى')).toEqual({
      before: { verificationStatus: 'approved' },
      after: { verificationStatus: 'revoked' },
    });
  });

  it('ban answers the account status it moved from, and the application status for the applicant', async () => {
    const userId = approvedTeacher('suspended');
    expect(await standing.ban(TX, ADMIN, userId)).toMatchObject({
      before: { accountStatus: 'suspended' },
      after: { accountStatus: 'banned' },
    });
    const rejected = applicant('rejected');
    expect(await standing.ban(TX, ADMIN, rejected, { applicantNote: 'معدَّلة' })).toEqual({
      before: { accountStatus: 'active' },
      after: { accountStatus: 'banned' },
      applicationStatus: 'rejected',
    });
  });

  it('reinstate answers the state it landed on, verification_required under an open request', async () => {
    const plain = approvedTeacher('suspended');
    const requested = approvedTeacher('suspended');
    openIdentityRequests.add(requested);
    expect(await standing.reinstate(TX, ADMIN, plain)).toEqual({
      before: { accountStatus: 'suspended' },
      after: { accountStatus: 'active' },
    });
    expect(await standing.reinstate(TX, ADMIN, requested)).toEqual({
      before: { accountStatus: 'suspended' },
      after: { accountStatus: 'verification_required' },
    });
  });
});

describe("the account's lock (T126)", () => {
  // The store's journal names each lock and each read in order; the open request's read is added
  // by `hasOpenIdentityRequest` below, so a reinstatement's reads are seen too.
  beforeEach(() => {
    standing = new StandingService({
      store,
      consequences: new AccountConsequences(),
      revokeSubjects: async () => undefined,
      hasOpenIdentityRequest: async (_tx, userId) => {
        store.journal.push(`request:${userId}`);
        return openIdentityRequests.has(userId);
      },
      now: () => NOW,
    });
  });

  it('suspend locks the account before it reads the standing', async () => {
    const userId = approvedTeacher();
    await standing.suspend(TX, ADMIN, userId);
    expect(store.journal.slice(0, 2)).toEqual([`lock:${userId}`, `read:${userId}`]);
  });

  it('ban locks the account, then the application, before it reads the standing, by either path (T164)', async () => {
    const teacher = approvedTeacher();
    await standing.ban(TX, ADMIN, teacher);
    expect(store.journal.slice(0, 3)).toEqual([
      `lock:${teacher}`,
      `lock-application:${teacher}`,
      `read:${teacher}`,
    ]);
    store.journal.length = 0;
    const rejected = applicant('rejected');
    await standing.ban(TX, ADMIN, rejected, { applicantNote: 'معدَّلة' });
    expect(store.journal.slice(0, 3)).toEqual([
      `lock:${rejected}`,
      `lock-application:${rejected}`,
      `read:${rejected}`,
    ]);
  });

  it('revokeApproval locks the account, then the application, before it reads the standing (T041)', async () => {
    const teacher = approvedTeacher();
    await standing.revokeApproval(TX, ADMIN, teacher, 'شكوى');
    expect(store.journal.slice(0, 3)).toEqual([
      `lock:${teacher}`,
      `lock-application:${teacher}`,
      `read:${teacher}`,
    ]);
  });

  it('reinstate locks the account before it reads the standing and the open request', async () => {
    const userId = approvedTeacher('suspended');
    await standing.reinstate(TX, ADMIN, userId);
    expect(store.journal).toEqual([`lock:${userId}`, `read:${userId}`, `request:${userId}`]);
  });

  it('a refused move has taken the lock all the same, and only once', async () => {
    const userId = approvedTeacher();
    await expect(standing.reinstate(TX, ADMIN, userId)).rejects.toBeInstanceOf(DomainError);
    expect(store.journal.filter((entry) => entry.startsWith('lock:'))).toEqual([`lock:${userId}`]);
  });
});

describe('the consequences registry', () => {
  it('calls every subscriber in the order it subscribed, with the cause', async () => {
    const registry = new AccountConsequences();
    const calls: string[] = [];
    registry.subscribe(async (_tx, _userId, cause) => {
      calls.push(`first:${cause}`);
    });
    registry.subscribe(async (_tx, _userId, cause) => {
      calls.push(`second:${cause}`);
    });
    await registry.onAccountTerminated(TX, ADMIN, 'suspended');
    expect(calls).toEqual(['first:suspended', 'second:suspended']);
  });
});

// T005 of specs/004-sessions (`002:T144`; FR-421, FR-486; R-313; admin-surface.md "`students`"): a
// student's suspension, ban and reinstatement, as the teacher's: the account's lock first, the
// student's own read (a student has no teacher profile), the move, every sign-in session ended and
// the one consequences entry, on the action's transaction; the reinstatement as the teacher's
// (`002:T113`, `002:T126`, the note under T005), restoring the account only.
const student = (
  accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned' = 'active',
) => store.plant({ accountStatus, role: 'student' });

describe('suspendStudent', () => {
  it.each(['active', 'verification_required'] as const)(
    'suspends a student %s, ends every sign-in session and calls the consequences with suspended',
    async (accountStatus) => {
      const userId = student(accountStatus);
      expect(await standing.suspendStudent(TX, ADMIN, userId)).toEqual({
        before: { accountStatus },
        after: { accountStatus: 'suspended' },
      });
      expect(store.person(userId).accountStatus).toBe('suspended');
      expect(sessionOf(userId)).toEqual({ revokedReason: 'account_suspended', revokedAt: NOW });
      expect(consequences).toEqual([{ userId, cause: 'suspended' }]);
    },
  );

  it('refuses a student suspended or banned, naming the standing, and ends nothing', async () => {
    for (const accountStatus of ['suspended', 'banned'] as const) {
      const userId = student(accountStatus);
      expect(await refusal(standing.suspendStudent(TX, ADMIN, userId))).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'studentUserId', code: accountStatus }],
      });
      expect(sessionOf(userId)?.revokedAt).toBeNull();
    }
    expect(consequences).toEqual([]);
  });

  it('answers NOT_FOUND for a teacher, an account with the teacher role and no profile, and no person', async () => {
    const teacher = approvedTeacher();
    const onboarding = store.plant({ role: 'teacher' });
    for (const userId of [teacher, onboarding, ADMIN]) {
      expect((await refusal(standing.suspendStudent(TX, ADMIN, userId))).code).toBe('NOT_FOUND');
    }
    expect(store.person(teacher).accountStatus).toBe('active');
    expect(consequences).toEqual([]);
  });
});

describe('banStudent', () => {
  it.each(['active', 'verification_required', 'suspended'] as const)(
    'bans a student %s for good, ends every sign-in session and calls the consequences with banned',
    async (accountStatus) => {
      const userId = student(accountStatus);
      expect(await standing.banStudent(TX, ADMIN, userId)).toEqual({
        before: { accountStatus },
        after: { accountStatus: 'banned' },
      });
      expect(store.person(userId).accountStatus).toBe('banned');
      expect(sessionOf(userId)).toEqual({ revokedReason: 'account_banned', revokedAt: NOW });
      expect(consequences).toEqual([{ userId, cause: 'banned' }]);
    },
  );

  it('refuses a student already banned, and answers NOT_FOUND for a teacher', async () => {
    expect(await refusal(standing.banStudent(TX, ADMIN, student('banned')))).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'studentUserId', code: 'banned' }],
    });
    expect((await refusal(standing.banStudent(TX, ADMIN, approvedTeacher()))).code).toBe(
      'NOT_FOUND',
    );
    expect(consequences).toEqual([]);
  });
});

describe('reinstateStudent (the note under T005: as a teacher’s)', () => {
  it('returns a suspended student with no open identity request to active, calling no consequence', async () => {
    const userId = student('suspended');
    expect(await standing.reinstateStudent(TX, ADMIN, userId)).toEqual({
      before: { accountStatus: 'suspended' },
      after: { accountStatus: 'active' },
    });
    expect(store.person(userId).accountStatus).toBe('active');
    expect(sessionOf(userId)?.revokedAt).toBeNull();
    expect(consequences).toEqual([]);
  });

  it('lands a suspended student with an open identity request on verification_required', async () => {
    const userId = student('suspended');
    openIdentityRequests.add(userId);
    expect(await standing.reinstateStudent(TX, ADMIN, userId)).toEqual({
      before: { accountStatus: 'suspended' },
      after: { accountStatus: 'verification_required' },
    });
    expect(store.person(userId).accountStatus).toBe('verification_required');
    expect(consequences).toEqual([]);
  });

  it('refuses an active student and a banned one, and answers NOT_FOUND for a teacher', async () => {
    for (const accountStatus of ['active', 'banned'] as const) {
      expect(await refusal(standing.reinstateStudent(TX, ADMIN, student(accountStatus)))).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'studentUserId', code: accountStatus }],
      });
    }
    expect(
      (await refusal(standing.reinstateStudent(TX, ADMIN, approvedTeacher('suspended')))).code,
    ).toBe('NOT_FOUND');
  });
});

describe("a student's account lock (T126, the note under T005)", () => {
  beforeEach(() => {
    standing = new StandingService({
      store,
      consequences: new AccountConsequences(),
      revokeSubjects: async () => undefined,
      hasOpenIdentityRequest: async (_tx, userId) => {
        store.journal.push(`request:${userId}`);
        return openIdentityRequests.has(userId);
      },
      now: () => NOW,
    });
  });

  it.each(['suspendStudent', 'banStudent'] as const)(
    '%s locks the account before it reads the student',
    async (method) => {
      const userId = student();
      await standing[method](TX, ADMIN, userId);
      expect(store.journal).toEqual([`lock:${userId}`, `read-student:${userId}`]);
    },
  );

  it('reinstateStudent locks the account before it reads the student and the open request', async () => {
    const userId = student('suspended');
    await standing.reinstateStudent(TX, ADMIN, userId);
    expect(store.journal).toEqual([
      `lock:${userId}`,
      `read-student:${userId}`,
      `request:${userId}`,
    ]);
  });
});

// T063 of specs/004-sessions (FR-429; research R-324, item 6): a suspension, a ban and a revocation,
// a teacher's or a student's, add the person's `account` to the action's after-commit list, which
// the administrator kind binds to its transaction; nothing is added for a reinstatement or a refusal,
// and a transaction no kind bound reaches no list.
describe('the `account` event after a standing change (T063)', () => {
  function bound() {
    const added: Array<{ to: readonly string[]; event: unknown }> = [];
    const tx = {} as typeof TX;
    const unbind = bindToTransaction(tx, {
      afterCommit: (to, event) => void added.push({ to, event }),
    });
    return { tx, added, unbind };
  }

  it.each([
    ['suspend', (tx: typeof TX, userId: string) => standing.suspend(tx, ADMIN, userId)],
    ['revokeApproval', (tx: typeof TX, userId: string) => standing.revokeApproval(tx, ADMIN, userId, 'a reason')],
    ['ban', (tx: typeof TX, userId: string) => standing.ban(tx, ADMIN, userId)],
  ] as const)('%s adds one `account` to the person’s streams', async (_, act) => {
    const { tx, added, unbind } = bound();
    const userId = approvedTeacher();
    await act(tx, userId);
    unbind();
    expect(added).toEqual([{ to: [userId], event: { type: 'account' } }]);
  });

  it.each([
    ['suspendStudent', (tx: typeof TX, userId: string) => standing.suspendStudent(tx, ADMIN, userId)],
    ['banStudent', (tx: typeof TX, userId: string) => standing.banStudent(tx, ADMIN, userId)],
  ] as const)('%s adds one `account` to the student’s streams', async (_, act) => {
    const { tx, added, unbind } = bound();
    const userId = student();
    await act(tx, userId);
    unbind();
    expect(added).toEqual([{ to: [userId], event: { type: 'account' } }]);
  });

  it('adds nothing for a reinstatement, nor for a refused change', async () => {
    const { tx, added, unbind } = bound();
    await standing.reinstate(tx, ADMIN, approvedTeacher('suspended'));
    await standing.reinstateStudent(tx, ADMIN, student('suspended'));
    await refusal(standing.suspendStudent(tx, ADMIN, student('banned')));
    unbind();
    expect(added).toEqual([]);
  });

  it('reaches no list on a transaction no caller kind bound', async () => {
    const userId = approvedTeacher();
    await expect(standing.suspend(TX, ADMIN, userId)).resolves.toMatchObject({
      after: { accountStatus: 'suspended' },
    });
  });
});
