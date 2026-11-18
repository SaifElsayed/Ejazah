// T014 of specs/005-certification — `genderFlags.correct` as the admin module composes it (FR-616,
// FR-GENDER-7; research R-409; the note under T014, Q-G2 (c), Q-G3 (a), Q-G4 (a), Q-G6 (a), Q-G7 (a);
// kernel.md, «a gender correction»), over steps, an enrollment side and an idempotency held in
// memory. Written before the correction, run red against its stub, each negative case red under its
// named mutant (lane D's `mutants\`).
//
// - the locks and writes in the kernel row's order: the flag read, the person locked, the flag
//   claimed, the gender read and written the other one, the slots' keys ascending, the holds, the
//   enrollments in one call, each ending one read again, cancelled `gender_correction`, its remaining
//   sessions and one case each, a paused case closed, the holds released, the ijazahs re-rendered last;
// - only `confirmed` enrollments now pairing two genders end, in both directions;
// - `already_resolved` and NOT_FOUND write nothing after the refusal (the call rolls back);
// - the live events after the commit only; a replay writes nothing; no line carries a gender.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { Gender } from '../../platform/guards/requester-gender.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import type { LiveMessage } from '../../platform/live/live-bus.js';
import { bindToTransaction, RequestLive } from '../../platform/live/live-publisher.js';
import type { AdminGenderFlags } from '../moderation/index.js';
import type { EnrollmentTerms } from '../sessions/index.js';
import {
  type CorrectionSteps,
  createGenderDecisions,
  type GenderDecisionReads,
  otherGender,
} from './gender-decisions.service.js';

const FLAG = '0199d0a0-0000-7000-8000-00000000c1f1';
const PERSON = '0199d0a0-0000-7000-8000-00000000c1a1';
const SAME = '0199d0a0-0000-7000-8000-00000000c1a2';
const SAME_TOO = '0199d0a0-0000-7000-8000-00000000c1a3';
const OTHER_TEACHER = '0199d0a0-0000-7000-8000-00000000c1a6';
const CROSS = '0199d0a0-0000-7000-8000-00000000c1a4';
const ADMIN = '0199d0a0-0000-7000-8000-00000000c1b9';
const E1 = '0199d0a0-0000-7000-8000-00000000c1e1';
const E2 = '0199d0a0-0000-7000-8000-00000000c1e2';
const E3 = '0199d0a0-0000-7000-8000-00000000c1e3';
const E4 = '0199d0a0-0000-7000-8000-00000000c1e4';
const HOLD_ENROLLMENT = '0199d0a0-0000-7000-8000-00000000c1e9';
const HOLD = '0199d0a0-0000-7000-8000-00000000c1d1';
const C1 = '0199d0a0-0000-7000-8000-00000000c1c1';
const C2 = '0199d0a0-0000-7000-8000-00000000c1c2';
const KEY = 'flag-correction-key-for-the-spec-0003';
const AT = new Date('2026-11-18T10:00:00.000Z');
const REASON = 'المستندات تثبت خطأ التسجيل';

let order: unknown[][];
let keyed: IdempotentRequest[];
let replay: boolean;
let claim: boolean;
let flagThere: boolean;
let genders: Map<string, Gender>;
let statuses: Map<string, EnrollmentTerms['status']>;
let holds: { holdIds: string[]; enrollmentIds: string[] };
let lines: { fields: Record<string, unknown>; message: string }[];
let published: LiveMessage[];

/** The person teaches E1, E2 and E4 and studies in E3; E4 already pairs two genders. */
const confirmed = [
  { id: E1, studentUserId: SAME_TOO, teacherUserId: PERSON },
  { id: E2, studentUserId: SAME, teacherUserId: PERSON },
  { id: E3, studentUserId: PERSON, teacherUserId: OTHER_TEACHER },
  { id: E4, studentUserId: CROSS, teacherUserId: PERSON },
];
const partiesOf = new Map(confirmed.map((row) => [row.id, row]));

function arrange(person: Gender) {
  genders = new Map([
    [PERSON, person],
    [SAME, person],
    [SAME_TOO, person],
    [OTHER_TEACHER, person],
    [CROSS, otherGender(person)],
  ]);
}

beforeEach(() => {
  order = [];
  keyed = [];
  replay = false;
  claim = true;
  flagThere = true;
  statuses = new Map([E1, E2, E3, E4].map((id) => [id, 'confirmed' as const]));
  holds = { holdIds: [HOLD], enrollmentIds: [HOLD_ENROLLMENT] };
  lines = [];
  published = [];
  arrange('male');
});

const reads: GenderDecisionReads = {
  confirmedEnrollmentsOf: async () => confirmed,
  gendersOf: async (_tx, userIds) => new Map([...genders].filter(([id]) => userIds.includes(id))),
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
  standingOf: async () => {
    throw new Error('the correction reads no standing');
  },
  resolveFlag: async (_tx, resolution) => {
    order.push(['resolveFlag', resolution]);
    return claim;
  },
  declaredGenderOf: async (_tx, userId) => {
    order.push(['declaredGenderOf', userId]);
    return genders.get(userId) ?? null;
  },
  setDeclaredGender: async (_tx, userId, from, to) => {
    order.push(['setDeclaredGender', userId, from, to]);
    genders.set(userId, to);
    return true;
  },
  lockTeacherSlots: async (_tx, teacherUserId) =>
    void order.push(['lockTeacherSlots', teacherUserId]),
  lockActiveHoldsOf: async (_tx, userId) => {
    order.push(['lockActiveHoldsOf', userId]);
    return holds;
  },
  cancelRemaining: async (_tx, enrollmentIds, now, caseOf) => {
    order.push(['cancelRemaining', enrollmentIds, now]);
    const cases = new Map<string, string | null>();
    for (const id of enrollmentIds) cases.set(id, await caseOf(id));
    return {
      cancelledSessionIds: ['s1', 's2'],
      handedRemedyIds: [],
      lapsedRemedyIds: [],
      caseOf: cases,
    };
  },
  openCase: async (_tx, enrollmentId) => {
    order.push(['openCase', enrollmentId]);
    return enrollmentId === E1 ? C1 : C2;
  },
  closePausedCase: async (_tx, _log, end) => void order.push(['closePausedCase', end]),
  releaseHolds: async (_tx, holdIds, dependencies) => {
    order.push(['releaseHolds', holdIds, dependencies.at]);
    return { released: holdIds };
  },
};

const enrollments = {
  enrollmentFor: async (_tx: Transaction, id: string) => {
    order.push(['enrollmentFor', id]);
    const row = partiesOf.get(id);
    const status = statuses.get(id);
    return row === undefined || status === undefined
      ? null
      : ({ ...row, status } as unknown as EnrollmentTerms);
  },
  lockEnrollments: async (_tx: Transaction, ids: readonly string[]) =>
    void order.push(['lockEnrollments', ids]),
  cancel: async (_tx: Transaction, id: string, reason: string) => {
    order.push(['cancel', id, reason]);
    return true;
  },
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
    enrollments,
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
              from: 'male',
              to: 'female',
              endedEnrollments: 3,
            } as T,
            replayed: true,
          };
        }
        return { outcome: await effect(tx), replayed: false };
      },
    },
    orders: async () => new Map(),
    rerenderOfParty: async (_tx, userId) => {
      order.push(['rerenderOfParty', userId]);
      return [];
    },
    standing: {
      ban: async () => Promise.reject(new Error('the correction bans nobody')),
      banStudent: async () => Promise.reject(new Error('the correction bans nobody')),
    },
    clock: async () => AT,
    steps,
  });

/** A transaction bound to an after-commit list, as the administrator kind binds its own. */
function bound() {
  const tx = {} as Transaction;
  const live = new RequestLive({ publish: (message) => void published.push(message) }, log);
  const unbind = bindToTransaction(tx, live);
  return { tx, live, unbind };
}

const correct = (tx: Transaction = {} as Transaction) =>
  decisions().correct(tx, ADMIN, { flagId: FLAG, reason: REASON, idempotencyKey: KEY });

describe('genderFlags.correct (005:T014)', () => {
  it.each([
    ['male', 'female'],
    ['female', 'male'],
  ] as const)(
    'corrects %s to %s in the kernel row’s order, ending the enrollments now pairing two genders',
    async (from, to) => {
      arrange(from);
      expect(await correct()).toEqual({
        flaggedUserId: PERSON,
        from,
        to,
        endedEnrollments: 3,
        replayed: false,
      });
      expect(order).toEqual([
        ['flagOf', FLAG],
        ['lockAccount', PERSON],
        [
          'resolveFlag',
          { flagId: FLAG, outcome: 'corrected', note: REASON, adminId: ADMIN, at: AT },
        ],
        ['declaredGenderOf', PERSON],
        ['setDeclaredGender', PERSON, from, to],
        ...[PERSON, OTHER_TEACHER].sort().map((key) => ['lockTeacherSlots', key]),
        ['lockActiveHoldsOf', PERSON],
        ['lockEnrollments', [E1, E2, E3, HOLD_ENROLLMENT].sort()],
        ['enrollmentFor', E1],
        ['enrollmentFor', E2],
        ['enrollmentFor', E3],
        ['cancel', E1, 'gender_correction'],
        ['cancel', E2, 'gender_correction'],
        ['cancel', E3, 'gender_correction'],
        ['cancelRemaining', [E1, E2, E3], AT],
        ['openCase', E1],
        ['openCase', E2],
        ['openCase', E3],
        ['closePausedCase', { adminId: ADMIN, enrollmentId: E1, endCaseId: C1 }],
        ['closePausedCase', { adminId: ADMIN, enrollmentId: E2, endCaseId: C2 }],
        ['closePausedCase', { adminId: ADMIN, enrollmentId: E3, endCaseId: C2 }],
        ['releaseHolds', [HOLD], AT],
        ['rerenderOfParty', PERSON],
      ]);
      expect(keyed).toEqual([
        {
          scope: 'genderFlags.correct',
          key: KEY,
          actorId: ADMIN,
          input: { flagId: FLAG, reason: REASON },
        },
      ]);
    },
  );

  it('ends only enrollments still confirmed under their lock, and never one already across', async () => {
    statuses.set(E2, 'completed');
    expect((await correct()).endedEnrollments).toBe(2);
    expect(order.filter(([name]) => name === 'cancel')).toEqual([
      ['cancel', E1, 'gender_correction'],
      ['cancel', E3, 'gender_correction'],
    ]);
    expect(order.filter(([name]) => name === 'enrollmentFor').map(([, id]) => id)).not.toContain(
      E4,
    );
  });

  it('with nothing to end and no hold, cancels and releases nothing, and still re-renders last', async () => {
    holds = { holdIds: [], enrollmentIds: [] };
    for (const id of [E1, E2, E3]) statuses.set(id, 'cancelled');
    expect((await correct()).endedEnrollments).toBe(0);
    const names = order.map(([name]) => name);
    expect(names).not.toContain('cancel');
    expect(names).not.toContain('cancelRemaining');
    expect(names).not.toContain('releaseHolds');
    expect(names.at(-1)).toBe('rerenderOfParty');
  });

  it('refuses a flag no longer open already_resolved, writing nothing after the claim', async () => {
    claim = false;
    const thrown = await correct().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('CONFLICT');
    expect((thrown as DomainError).details).toEqual([{ path: 'flagId', code: 'already_resolved' }]);
    expect(order.map(([name]) => name)).toEqual(['flagOf', 'lockAccount', 'resolveFlag']);
  });

  it('refuses no flag NOT_FOUND before any lock', async () => {
    flagThere = false;
    const thrown = await correct().catch((error: unknown) => error);
    expect((thrown as DomainError).code).toBe('NOT_FOUND');
    expect(order).toEqual([['flagOf', FLAG]]);
  });

  it('tells the person and both parties of each ended enrollment after the commit, nothing on a rollback', async () => {
    const committed = bound();
    await correct(committed.tx);
    expect(published).toEqual([]);
    committed.live.flush();
    committed.unbind();
    expect(published).toEqual([
      { to: [PERSON], event: { type: 'account' } },
      { to: [SAME_TOO, PERSON], event: { type: 'enrollment', enrollmentId: E1 } },
      { to: [SAME, PERSON], event: { type: 'enrollment', enrollmentId: E2 } },
      { to: [PERSON, OTHER_TEACHER], event: { type: 'enrollment', enrollmentId: E3 } },
    ]);
    published = [];
    const rolledBack = bound();
    await correct(rolledBack.tx);
    rolledBack.live.drop();
    rolledBack.live.flush();
    rolledBack.unbind();
    expect(published).toEqual([]);
  });

  it('logs ids and counts only, never a gender or the reason', async () => {
    await correct();
    expect(lines).toEqual([
      {
        fields: {
          adminId: ADMIN,
          flagId: FLAG,
          userId: PERSON,
          endedEnrollments: 3,
          cancelledSessions: 2,
          releasedHolds: 1,
          rerenderedIjazahs: 0,
        },
        message: 'A declared gender was corrected',
      },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/male|female/);
    expect(JSON.stringify(lines)).not.toContain(REASON);
  });

  it('a replay answers the first correction and writes nothing', async () => {
    replay = true;
    expect(await correct()).toEqual({
      flaggedUserId: PERSON,
      from: 'male',
      to: 'female',
      endedEnrollments: 3,
      replayed: true,
    });
    expect(order).toEqual([]);
  });
});
