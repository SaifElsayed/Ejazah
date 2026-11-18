// T014 of specs/005-certification — `genderFlags.correct` over the real tables as the application role
// (FR-616, FR-617, FR-GENDER-7; research R-409; the note under T014, Q-G2 (c), Q-G3 (a), Q-G4 (a);
// kernel.md, «a gender correction»), through the admin module's composition on a committed
// transaction bound to an after-commit list, as the administrator kind runs it. Every world is
// committed: a Thursday 09:00 Cairo slot and a four-session enrollment, of each gender.
//
// - the correction, both directions: the declared gender the other one; the confirmed enrollment
//   cancelled `gender_correction` with its one row, its remaining sessions `cancelled_by_admin`, one
//   open `gender_correction` case; the flag `corrected` with the reason;
// - a hold awaiting payment: released `admin`, its enrollment cancelled `gender_correction`, no case
//   (Q-G2 (c)); a paid event after it keeps the enrollment cancelled with its reason and opens one
//   `party_restricted` case; the confirm job reads `gender_correction` as a termination's reason;
// - the restore (DEC-69), the adversarial case in both directions: the correction's own end
//   `not_restorable`; an administrator's direct end of the same pairing `gender_mismatch` (step 3);
// - the race probe against `sessions.restore` on one enrollment, both orders and at once: each
//   outcome valid, no deadlock, never a mixed pairing restored.
//
// THE CORRECTION HERE. R-API-3 and R-API-4 keep this file from importing the admin module (only the
// composition roots may), so `correctAsComposed` below takes the admin composition's calls, in the
// order `admin/gender-correction.service.spec.ts` pins for `gender-decisions.service.ts`, from the
// owners' entries, as `ban-lift.spec.ts` binds the lift «as the admin module binds it». The two
// pure rules it needs (the other gender; the enrollments pairing two genders) are restated in two
// lines each.
// Red first under the named mutants (lane D's `mutants\`): step 3 removed; `gender_correction` out
// of `TERMINATION_REASONS`; the enrollment reason dropped from `releaseHolds`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  confirmationPartiesOf,
  confirmedEnrollmentsOf,
  createEnrollmentSide,
  lockActiveHoldsOf,
  lockForConfirmation,
  releaseHolds,
} from '../../apps/api/src/modules/booking/index.js';
import { lockTeacherSlots } from '../../apps/api/src/modules/catalog/index.js';
import { createPartyRerender } from '../../apps/api/src/modules/certification/index.js';
import {
  declaredGenderOf,
  lockAccount,
  sessionPartiesOf,
  setDeclaredGender,
} from '../../apps/api/src/modules/identity/index.js';
import {
  genderFlagStore,
  openCompensationCase,
} from '../../apps/api/src/modules/moderation/index.js';
import { orderStandingsOf, refundedOf } from '../../apps/api/src/modules/payments/index.js';
import {
  cancelRemainingSessions,
  closePausedCaseOnEnd,
  createEnrollmentEnd,
  createRemedyOffer,
  createRestore,
  pausedCaseStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { clockTimestamp } from '../../apps/api/src/platform/db/db-clock.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { bindToTransaction, RequestLive } from '../../apps/api/src/platform/live/live-publisher.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

type Gender = 'male' | 'female';

const SETTINGS: Record<string, number> = {
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 14,
  slot_release_buffer_weeks: 0,
  idempotency_key_ttl_hours: 24,
  repeated_absence_flag_count: 3,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const SILENT = { info: () => undefined, warn: () => undefined };
const REASON = 'المستندات تثبت خطأ التسجيل';
const OPTIONS = { timeout: 30_000 };

let database: Database;
let db: Db;
let admin: string;

const enrollments = createEnrollmentSide({ settings });
const offers = createRemedyOffer({ enrollments, settings, log: SILENT });

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  db = await connectAsApplication();
  admin = await makeAdmin(db);
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

const idempotency = () =>
  new IdempotencyService<Transaction>({ store: new IdempotencyRepository(database), settings });

const rerender = createPartyRerender({ renders: { enqueue: async () => undefined }, log: SILENT });

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/**
 * The admin composition's correction, in its pinned order, from the owners' entries (this file's
 * head): the flag, the person's lock, the claim, the gender, the slots' keys, the holds, the
 * enrollments, each end with its case, the paused cases, the release, the re-render.
 */
async function correctAsComposed(tx: Transaction, flagId: string) {
  const seen = await genderFlagStore.flagOf(tx, flagId);
  if (seen === null) throw new DomainError('NOT_FOUND');
  const person = seen.flaggedUserId;
  await lockAccount(tx, person);
  const at = await clockTimestamp(tx);
  if (
    !(await genderFlagStore.resolve(tx, {
      flagId,
      outcome: 'corrected',
      note: REASON,
      adminId: admin,
      at,
    }))
  ) {
    throw new DomainError('CONFLICT', undefined, {
      details: [{ path: 'flagId', code: 'already_resolved' }],
    });
  }
  const from = await declaredGenderOf(tx, person);
  if (from === null) throw new DomainError('NOT_FOUND');
  const to = other(from);
  if (!(await setDeclaredGender(tx, person, from, to))) throw new Error('not written');
  const confirmed = await confirmedEnrollmentsOf(tx, person);
  const parties = await sessionPartiesOf(
    tx,
    sortedUnique(
      confirmed.flatMap(({ studentUserId, teacherUserId }) => [studentUserId, teacherUserId]),
    ),
  );
  const ending = confirmed.filter(({ studentUserId, teacherUserId }) => {
    const theirs = parties.get(studentUserId === person ? teacherUserId : studentUserId)?.gender;
    return theirs !== undefined && theirs !== to;
  });
  for (const key of sortedUnique([person, ...ending.map(({ teacherUserId }) => teacherUserId)])) {
    await lockTeacherSlots(tx, key);
  }
  const holds = await lockActiveHoldsOf(tx, person);
  const toLock = sortedUnique([...holds.enrollmentIds, ...ending.map(({ id }) => id)]);
  if (toLock.length > 0) await enrollments.lockEnrollments(tx, toLock);
  const still: string[] = [];
  for (const { id } of ending) {
    if ((await enrollments.enrollmentFor(tx, id))?.status === 'confirmed') still.push(id);
  }
  for (const id of still) await enrollments.cancel(tx, id, 'gender_correction');
  const ended =
    still.length === 0
      ? null
      : await cancelRemainingSessions(
          tx,
          still,
          at,
          async (enrollmentId) =>
            (await openCompensationCase(tx, enrollmentId, 'gender_correction')).caseId,
        );
  for (const enrollmentId of still) {
    await closePausedCaseOnEnd(tx, pausedCaseStore, SILENT, {
      adminId: admin,
      enrollmentId,
      endCaseId: ended?.caseOf.get(enrollmentId) ?? null,
      end: 'gender_correction',
    });
  }
  if (holds.holdIds.length > 0) {
    await releaseHolds(
      tx,
      holds.holdIds,
      'admin',
      { at, orders: orderStandingsOf },
      'gender_correction',
    );
  }
  await rerender.rerenderOfParty(tx, person);
  return { flaggedUserId: person, from, to, endedEnrollments: still.length };
}

/** Runs an action on a committed transaction bound to its own after-commit list, as the kind does. */
async function acted<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const list = new RequestLive({ publish: () => undefined }, SILENT);
  const answer = await database.$transaction(async (tx) => {
    const unbind = bindToTransaction(tx, list);
    try {
      return await work(tx);
    } finally {
      unbind();
    }
  }, OPTIONS);
  list.flush();
  return answer;
}

/** A four-session enrollment of `gender` confirmed by the job, both parties' roles active. */
async function confirmedWorld(gender: Gender): Promise<World> {
  const made = await world({ gender });
  await database.userRole.createMany({
    data: [
      { userId: made.studentId, role: 'student', status: 'active' },
      { userId: made.teacherId, role: 'teacher', status: 'active' },
    ],
  });
  await confirmEnrollment({ database, settings: worldSettings, notices: NO_PUSH, clock: () => NOW }).handle({
    paymentId: await order(made.enrollmentId),
  });
  return made;
}

async function flagOn(userId: string): Promise<string> {
  const { id } = await database.genderFlag.create({
    data: { flaggedUserId: userId, raisedByUserId: null, reason: 'بلاغ', status: 'open' },
    select: { id: true },
  });
  return id;
}

function correct(flagId: string) {
  return acted((tx) => correctAsComposed(tx, flagId));
}

const restorer = () =>
  createRestore({
    enrollments,
    idempotency: idempotency(),
    offers,
    settings,
    log: SILENT,
    payments: { refundedOf },
  });

function restore(enrollmentId: string) {
  return acted((tx) =>
    restorer().restore(tx, admin, {
      enrollmentId,
      reason: 'خطأ',
      idempotencyKey: `restore-${randomUUID()}`,
    }),
  );
}

function endDirectly(enrollmentId: string) {
  return acted((tx) =>
    createEnrollmentEnd({ enrollments, idempotency: idempotency(), log: SILENT }).endEnrollment(
      tx,
      admin,
      {
        enrollmentId,
        partyReason: 'إنهاء إداري',
        slot: 'hold',
        idempotencyKey: `end-${randomUUID()}`,
      },
    ),
  );
}

async function causeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) return undefined;
  if (!(thrown instanceof DomainError)) throw thrown;
  return (thrown.details ?? []).map(({ code }) => code).join(',') || thrown.code;
}

async function stateOf(enrollmentId: string) {
  const [enrollment, events, sessions, cases] = await Promise.all([
    database.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { status: true, cancellationReason: true },
    }),
    database.enrollmentEvent.findMany({
      where: { enrollmentId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { kind: true, cancellationReason: true },
    }),
    database.session.findMany({ where: { enrollmentId }, select: { status: true } }),
    database.dispute.findMany({
      where: { enrollmentId },
      orderBy: { id: 'asc' },
      select: { kind: true, reason: true, status: true },
    }),
  ]);
  return { enrollment, events, sessions, cases };
}

const genderOf = async (userId: string) =>
  (await database.user.findUniqueOrThrow({ where: { id: userId }, select: { gender: true } }))
    .gender;

const other = (gender: Gender): Gender => (gender === 'male' ? 'female' : 'male');

describe('genderFlags.correct over the real tables (FR-616, FR-GENDER-7)', () => {
  it.each(['female', 'male'] as const)(
    'corrects a %s student: the confirmed enrollment ended gender_correction with one case',
    async (gender) => {
      const made = await confirmedWorld(gender);
      const flagId = await flagOn(made.studentId);
      const answer = await correct(flagId);
      expect(answer).toEqual({
        flaggedUserId: made.studentId,
        from: gender,
        to: other(gender),
        endedEnrollments: 1,
      });
      expect(await genderOf(made.studentId)).toBe(other(gender));
      const state = await stateOf(made.enrollmentId);
      expect(state.enrollment).toEqual({
        status: 'cancelled',
        cancellationReason: 'gender_correction',
      });
      expect(state.events.at(-1)).toEqual({
        kind: 'cancelled',
        cancellationReason: 'gender_correction',
      });
      expect(state.sessions.length).toBeGreaterThan(0);
      expect(new Set(state.sessions.map(({ status }) => status))).toEqual(
        new Set(['cancelled_by_admin']),
      );
      expect(state.cases).toEqual([
        { kind: 'compensation_case', reason: 'gender_correction', status: 'open' },
      ]);
      expect(
        await database.genderFlag.findUniqueOrThrow({
          where: { id: flagId },
          select: { status: true, resolutionNotes: true, resolvedByAdminId: true },
        }),
      ).toEqual({ status: 'corrected', resolutionNotes: REASON, resolvedByAdminId: admin });
    },
  );

  it('refuses a second correction of the same flag already_resolved, changing nothing', async () => {
    const made = await confirmedWorld('female');
    const flagId = await flagOn(made.studentId);
    await correct(flagId);
    expect(await causeOf(correct(flagId))).toBe('already_resolved');
    expect(await genderOf(made.studentId)).toBe('male');
  });
});

describe('a hold awaiting payment (Q-G2 (c))', () => {
  it('releases the hold admin and cancels its enrollment gender_correction, opening no case', async () => {
    const made = await world({ gender: 'female' });
    await correct(await flagOn(made.studentId));
    expect(
      await database.slotHold.findUniqueOrThrow({
        where: { id: made.holdId },
        select: { releaseReason: true },
      }),
    ).toEqual({ releaseReason: 'admin' });
    const state = await stateOf(made.enrollmentId);
    expect(state.enrollment).toEqual({
      status: 'cancelled',
      cancellationReason: 'gender_correction',
    });
    expect(state.cases).toEqual([]);
  });

  it('the confirm job reads gender_correction as a termination’s reason', async () => {
    const made = await world({ gender: 'male' });
    await correct(await flagOn(made.studentId));
    const parties = await confirmationPartiesOf(
      database as unknown as Transaction,
      made.enrollmentId,
    );
    if (parties === null) throw new Error('no parties');
    const locked = await database.$transaction(
      (tx) => lockForConfirmation(tx, parties, { orders: orderStandingsOf }),
      OPTIONS,
    );
    expect(locked).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'gender_correction',
      cancelledByTermination: true,
    });
  });

  it('a paid event after it keeps the enrollment cancelled with its reason and opens party_restricted', async () => {
    const made = await world({ gender: 'female' });
    await correct(await flagOn(made.studentId));
    await confirmEnrollment({ database, settings: worldSettings, notices: NO_PUSH, clock: () => NOW }).handle({
      paymentId: await order(made.enrollmentId),
    });
    const state = await stateOf(made.enrollmentId);
    expect(state.enrollment).toEqual({
      status: 'cancelled',
      cancellationReason: 'gender_correction',
    });
    expect(state.cases.map(({ reason }) => reason)).toEqual(['party_restricted']);
  });
});

describe('the restore refuses (DEC-69; the adversarial case, both directions)', () => {
  it.each(['female', 'male'] as const)(
    'a %s pairing: the correction’s end not_restorable, a direct end gender_mismatch',
    async (gender) => {
      const ended = await confirmedWorld(gender);
      await correct(await flagOn(ended.studentId));
      expect(await causeOf(restore(ended.enrollmentId))).toBe('not_restorable');

      const direct = await confirmedWorld(gender);
      await endDirectly(direct.enrollmentId);
      await correct(await flagOn(direct.teacherId));
      expect(await causeOf(restore(direct.enrollmentId))).toBe('gender_mismatch');
      expect((await stateOf(direct.enrollmentId)).enrollment).toEqual({
        status: 'cancelled',
        cancellationReason: 'admin',
      });
    },
  );
});

describe('race probe: a correction against sessions.restore (kernel.md, «a gender correction»)', () => {
  /** An enrollment an administrator ended directly, and a flag on its student. */
  async function directlyEnded(gender: Gender) {
    const made = await confirmedWorld(gender);
    await endDirectly(made.enrollmentId);
    return { made, flagId: await flagOn(made.studentId) };
  }

  it('the restore first, then the correction: restored, then ended gender_correction', async () => {
    const { made, flagId } = await directlyEnded('female');
    await restore(made.enrollmentId);
    expect((await correct(flagId)).endedEnrollments).toBe(1);
    expect((await stateOf(made.enrollmentId)).enrollment).toEqual({
      status: 'cancelled',
      cancellationReason: 'gender_correction',
    });
  });

  it('the correction first, then the restore: refused gender_mismatch, the end kept', async () => {
    const { made, flagId } = await directlyEnded('male');
    expect((await correct(flagId)).endedEnrollments).toBe(0);
    expect(await causeOf(restore(made.enrollmentId))).toBe('gender_mismatch');
    expect((await stateOf(made.enrollmentId)).enrollment).toEqual({
      status: 'cancelled',
      cancellationReason: 'admin',
    });
  });

  it.each([1, 2, 3])(
    'at once (run %i): one valid outcome, no deadlock, never a mixed pairing restored',
    async () => {
      const { made, flagId } = await directlyEnded('female');
      const [corrected, restored] = await Promise.allSettled([
        correct(flagId),
        restore(made.enrollmentId),
      ]);
      for (const settled of [corrected, restored]) {
        if (settled.status === 'rejected') expect(isDeadlock(settled.reason)).toBe(false);
      }
      expect(corrected.status).toBe('fulfilled');
      const { enrollment } = await stateOf(made.enrollmentId);
      if (restored.status === 'fulfilled') {
        // The restore first: confirmed again, then the correction ended it.
        expect(enrollment).toEqual({
          status: 'cancelled',
          cancellationReason: 'gender_correction',
        });
      } else {
        // The correction first: the restore refused at step 3, the direct end kept.
        expect(await causeOf(Promise.reject(restored.reason))).toBe('gender_mismatch');
        expect(enrollment).toEqual({ status: 'cancelled', cancellationReason: 'admin' });
      }
    },
  );
});
