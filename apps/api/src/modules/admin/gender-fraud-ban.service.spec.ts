// T015 of specs/005-certification — `genderFlags.fraudBan` as the admin module composes it (FR-617;
// SRS FR-GENDER-6; research R-409; the note under T015, Q-G5 (b), with Q-G4 (a) and Q-G6 (a)), over
// steps, a standing service and an idempotency held in memory. Written before the fraud ban, run red
// against its stub, each negative case red under its named mutant (lane D's `mutants\`).
//
// - the person locked, the standing read under the lock, the flag claimed `fraud_ban`, the declared
//   gender written the other one BEFORE the ban (so the ban's lift compares the corrected genders,
//   `ban-lift.service.ts:250-260`), then the ban by role: a student's `banStudent`, an approved or
//   revoked teacher's `ban`, an applicant's `ban` with the note the applicant sees; the person's
//   unsigned ijazahs re-rendered last;
// - an applicant with no note refused CONFLICT `applicant_note_required` before anything is written;
// - `already_resolved` and NOT_FOUND; a replay writes nothing; no line carries a gender or the note.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { Gender } from '../../platform/guards/requester-gender.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import type { AdminGenderFlags } from '../moderation/index.js';
import {
  type CorrectionSteps,
  createGenderDecisions,
  type GenderDecisionReads,
  type PersonStanding,
} from './gender-decisions.service.js';

const FLAG = '0199d0a0-0000-7000-8000-00000000c2f1';
const PERSON = '0199d0a0-0000-7000-8000-00000000c2a1';
const ADMIN = '0199d0a0-0000-7000-8000-00000000c2b9';
const KEY = 'flag-fraud-key-for-the-spec-0004';
const AT = new Date('2026-11-18T10:00:00.000Z');
const REASON = 'ثبت تزوير الجنس المعلن';
const NOTE = 'رُفض طلبك لمخالفة الشروط';

let order: unknown[][];
let keyed: IdempotentRequest[];
let replay: boolean;
let claim: boolean;
let flagThere: boolean;
let declared: Gender;
let standing: PersonStanding | null;
let lines: { fields: Record<string, unknown>; message: string }[];

beforeEach(() => {
  order = [];
  keyed = [];
  replay = false;
  claim = true;
  flagThere = true;
  declared = 'female';
  standing = { accountStatus: 'active', teacher: null };
  lines = [];
});

const unreached = (): never => {
  throw new Error('not this case');
};

const reads: GenderDecisionReads = {
  confirmedEnrollmentsOf: unreached,
  gendersOf: unreached,
  // 005:T023 (rule d): the preview's lines are `get`'s only.
  previewOf: unreached,
};

const steps: CorrectionSteps = {
  flagOf: async (_tx, flagId) => {
    order.push(['flagOf', flagId]);
    return flagThere
      ? {
          id: FLAG,
          flaggedUserId: PERSON,
          raisedByUserId: null,
          reportId: null,
          status: 'open',
          reason: 'سبب',
          createdAt: AT,
          resolutionNotes: null,
          resolvedAt: null,
          resolvedByAdminId: null,
        }
      : null;
  },
  lockAccount: async (_tx, userId) => void order.push(['lockAccount', userId]),
  standingOf: async (_tx, userId) => {
    order.push(['standingOf', userId]);
    return standing;
  },
  resolveFlag: async (_tx, resolution) => {
    order.push(['resolveFlag', resolution]);
    return claim;
  },
  declaredGenderOf: async (_tx, userId) => {
    order.push(['declaredGenderOf', userId]);
    return declared;
  },
  setDeclaredGender: async (_tx, userId, from, to) => {
    order.push(['setDeclaredGender', userId, from, to]);
    return true;
  },
  lockTeacherSlots: unreached,
  lockActiveHoldsOf: unreached,
  cancelRemaining: unreached,
  openCase: unreached,
  closePausedCase: unreached,
  releaseHolds: unreached,
};

const log = {
  info: (fields: Record<string, unknown>, message: string) => void lines.push({ fields, message }),
  warn: (fields: Record<string, unknown>, message: string) => void lines.push({ fields, message }),
} as never;

const flags = new Proxy({} as AdminGenderFlags, {
  get: () => () => Promise.reject(new Error('moderation is not this case')),
});

const decisions = () =>
  createGenderDecisions({
    flags,
    log,
    reads,
    enrollments: { enrollmentFor: unreached, lockEnrollments: unreached, cancel: unreached },
    idempotency: {
      runOn: async <T>(
        tx: Transaction,
        request: IdempotentRequest,
        effect: (tx: Transaction) => Promise<T>,
      ) => {
        keyed.push(request);
        if (replay) {
          return {
            outcome: {
              flaggedUserId: PERSON,
              from: 'female',
              to: 'male',
              accountStatus: 'active',
            } as T,
            replayed: true,
          };
        }
        return { outcome: await effect(tx), replayed: false };
      },
    },
    orders: unreached,
    rerenderOfParty: async (_tx, userId) => {
      order.push(['rerenderOfParty', userId]);
      return [];
    },
    standing: {
      ban: async (_tx, adminId, userId, applicant) => {
        order.push(['ban', adminId, userId, applicant]);
        return {
          before: { accountStatus: 'active' },
          after: { accountStatus: 'banned' },
          applicationStatus: 'in_review',
        };
      },
      banStudent: async (_tx, adminId, userId) => {
        order.push(['banStudent', adminId, userId]);
        return { before: { accountStatus: 'active' }, after: { accountStatus: 'banned' } };
      },
    },
    clock: async () => AT,
    steps,
  });

const fraudBan = (applicantNote?: string) =>
  decisions().fraudBan({} as Transaction, ADMIN, {
    flagId: FLAG,
    reason: REASON,
    ...(applicantNote === undefined ? {} : { applicantNote }),
    idempotencyKey: KEY,
  });

const claimed = [
  'resolveFlag',
  { flagId: FLAG, outcome: 'fraud_ban', note: REASON, adminId: ADMIN, at: AT },
];

describe('genderFlags.fraudBan (005:T015)', () => {
  it.each([
    ['female', 'male'],
    ['male', 'female'],
  ] as const)(
    'a %s student: the gender written %s before the ban, banStudent, the re-render last',
    async (from, to) => {
      declared = from;
      expect(await fraudBan()).toEqual({
        flaggedUserId: PERSON,
        from,
        to,
        accountStatus: 'active',
        replayed: false,
      });
      expect(order).toEqual([
        ['flagOf', FLAG],
        ['lockAccount', PERSON],
        ['standingOf', PERSON],
        claimed,
        ['declaredGenderOf', PERSON],
        ['setDeclaredGender', PERSON, from, to],
        ['banStudent', ADMIN, PERSON],
        ['rerenderOfParty', PERSON],
      ]);
      expect(keyed).toEqual([
        {
          scope: 'genderFlags.fraudBan',
          key: KEY,
          actorId: ADMIN,
          input: { flagId: FLAG, reason: REASON },
        },
      ]);
    },
  );

  it.each(['approved', 'revoked'] as const)(
    'a %s teacher: the teacher’s ban, no applicant note',
    async (verificationStatus) => {
      standing = {
        accountStatus: 'active',
        teacher: { verificationStatus, applicationStatus: 'approved' },
      };
      await fraudBan(NOTE);
      expect(order.filter(([name]) => name === 'ban')).toEqual([['ban', ADMIN, PERSON, undefined]]);
    },
  );

  it('an applicant: the ban with the note the applicant sees', async () => {
    standing = {
      accountStatus: 'active',
      teacher: { verificationStatus: 'pending', applicationStatus: 'in_review' },
    };
    await fraudBan(NOTE);
    expect(order.filter(([name]) => name === 'ban')).toEqual([
      ['ban', ADMIN, PERSON, { applicantNote: NOTE }],
    ]);
    expect(keyed[0]?.input).toEqual({ flagId: FLAG, reason: REASON, applicantNote: NOTE });
  });

  it('refuses an applicant with no note applicant_note_required before anything is written', async () => {
    standing = {
      accountStatus: 'active',
      teacher: { verificationStatus: 'pending', applicationStatus: 'in_review' },
    };
    const thrown = await fraudBan().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('CONFLICT');
    expect((thrown as DomainError).details).toEqual([
      { path: 'applicantNote', code: 'applicant_note_required' },
    ]);
    expect(order).toEqual([
      ['flagOf', FLAG],
      ['lockAccount', PERSON],
      ['standingOf', PERSON],
    ]);
  });

  it('refuses a flag no longer open already_resolved, writing nothing after the claim', async () => {
    claim = false;
    const thrown = await fraudBan().catch((error: unknown) => error);
    expect((thrown as DomainError).details).toEqual([{ path: 'flagId', code: 'already_resolved' }]);
    expect(order.map(([name]) => name)).toEqual([
      'flagOf',
      'lockAccount',
      'standingOf',
      'resolveFlag',
    ]);
  });

  it('refuses no flag and no person NOT_FOUND', async () => {
    flagThere = false;
    expect(((await fraudBan().catch((e: unknown) => e)) as DomainError).code).toBe('NOT_FOUND');
    expect(order).toEqual([['flagOf', FLAG]]);
    flagThere = true;
    standing = null;
    order = [];
    expect(((await fraudBan().catch((e: unknown) => e)) as DomainError).code).toBe('NOT_FOUND');
    expect(order.map(([name]) => name)).toEqual(['flagOf', 'lockAccount', 'standingOf']);
  });

  it('logs ids only, never a gender, the reason or the applicant’s note', async () => {
    standing = {
      accountStatus: 'active',
      teacher: { verificationStatus: 'pending', applicationStatus: 'in_review' },
    };
    await fraudBan(NOTE);
    expect(lines).toEqual([
      {
        fields: { adminId: ADMIN, flagId: FLAG, userId: PERSON, role: 'applicant' },
        message: 'A declared gender was found fraudulent and the account banned',
      },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/male|female/);
    expect(JSON.stringify(lines)).not.toContain(NOTE);
    expect(JSON.stringify(lines)).not.toContain(REASON);
  });

  it('a replay answers the first fraud ban and writes nothing', async () => {
    replay = true;
    expect(await fraudBan()).toEqual({
      flaggedUserId: PERSON,
      from: 'female',
      to: 'male',
      accountStatus: 'active',
      replayed: true,
    });
    expect(order).toEqual([]);
  });
});
