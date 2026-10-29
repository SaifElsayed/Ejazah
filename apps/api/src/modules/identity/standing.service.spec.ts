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

  it('ban answers the account status it moved from', async () => {
    const userId = approvedTeacher('suspended');
    expect(await standing.ban(TX, ADMIN, userId)).toEqual({
      before: { accountStatus: 'suspended' },
      after: { accountStatus: 'banned' },
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
