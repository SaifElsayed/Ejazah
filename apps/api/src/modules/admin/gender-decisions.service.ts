// T013 of specs/005-certification: the administrators' gender-flag queue, composed in the admin
// module (FR-614, FR-615; SRS FR-GENDER-4, FR-ADMIN-8; research R-409, «Where the decisions run»;
// contracts/admin-surface.md, `genderFlags.*`; the note under T013, Q-G1 (a)). Moderation holds the
// flag rows and imports neither booking nor sessions; this module imports every entry, so the
// procedures that need another module's rows are composed here and served by this module's router.
//
// - `list`, `raise`, `dismiss`: moderation's, on the administrator kind's transaction.
// - `get`: moderation's flag, with the preview of what a correction would end now: the flagged
//   person's `confirmed` enrollments (booking's entry, `confirmedEnrollmentsOf`) whose two declared
//   genders would differ once the person's gender is the other one (identity's `sessionPartiesOf`).
//   Read with no lock: a preview, decided on again under the correction's locks (T014).
//
// The preview counts the enrollments the correction ends (FR-616: `confirmed` ones only, the note
// under T014, Q-G3 (a)); holds and closed enrollments are not in it. No line carries a gender.
//
// GENDERFLAGS.CORRECT (T014; FR-616, FR-GENDER-7; research R-409; the note under T014: Q-G2 (c),
// Q-G3 (a), Q-G4 (a), Q-G4b (a), Q-G6 (a), Q-G7 (a)). An honest error corrected, on the
// administrator kind's transaction, keyed `genderFlags.correct` (`runOn`; a replay writes nothing);
// the limit, `rate_limit_gender_decision`, and the audit (`gender.corrected` on the person, the
// gender before and after, Q-G6) are the router's. In kernel.md's order («a gender correction»):
// - the flag read with no lock for its person (a flag's person never changes); the person's `users`
//   row `FOR UPDATE` (`lockAccount`); the flag claimed `corrected` by its one conditional update
//   (`already_resolved` when it is not open; every flag closing is the same update); the declared
//   gender read under the lock and written the other one (identity's administrators-only setter,
//   conditional on the value read);
// - the person's `confirmed` enrollments now pairing two genders (Q-G3 (a): no other status); the
//   slots' key of the person and of each such enrollment's teacher, ascending (L1); the person's
//   active holds (`lockActiveHoldsOf`); the holds' and the ending enrollments in one call, each
//   ending one read again under it (still `confirmed`);
// - each ended through `EnrollmentSide.cancel(…, 'gender_correction')`, its remaining sessions
//   `cancelled_by_admin` and its open remedies handed to one `gender_correction` case
//   (`cancelRemainingSessions`: sessions, remedies, then `disputes`), a paused enrollment's
//   `teacher_suspended` case closed covered by it (T071); never restorable (DEC-69);
// - the holds released with the hold reason `admin` and their unpaid enrollments cancelled
//   `gender_correction` (`releaseHolds`, Q-G2 (c): no case, nothing was paid; a paid one stays
//   awaiting payment and a late paid event takes branch 4's `party_restricted` case); the orders
//   after the enrollments, through payments' `orders`;
// - last, the person's unsigned ijazahs re-rendered after the commit (`rerenderOfParty`, Q-G4 (a));
//   open requests and the ended enrollments' ijazahs are left to the administrator (Q-G4b (a));
// - the live `account` event to the person and `enrollment` to both parties of each ended
//   enrollment, after the commit; no push (Q-G7 (a), a v1.1 item).
// ⚠️ Irreversible: the ends are never restored. One info line of ids and counts; never a gender.
import type {
  AdminGenderFlagsCorrectInput,
  AdminGenderFlagsDismissInput,
  AdminGenderFlagsGetInput,
  AdminGenderFlagsGetOutput,
  AdminGenderFlagsListInput,
  AdminGenderFlagsListOutput,
  AdminGenderFlagsRaiseInput,
} from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Gender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import {
  type ConfirmedEnrollment,
  confirmedEnrollmentsOf,
  type LockedHolds,
  lockActiveHoldsOf,
  type OrderStandings,
  releaseHolds,
} from '../booking/index.js';
import { lockTeacherSlots } from '../catalog/index.js';
import {
  declaredGenderOf,
  lockAccount,
  sessionPartiesOf,
  setDeclaredGender,
} from '../identity/index.js';
import {
  type AdminGenderFlags,
  type GenderFlagResolution,
  type GenderFlagRow,
  genderFlagStore,
  openCompensationCase,
} from '../moderation/index.js';
import {
  cancelRemainingSessions,
  closePausedCaseOnEnd,
  type EnrollmentsEnded,
  type EnrollmentSide,
  pausedCaseStore,
} from '../sessions/index.js';

/** What the decisions read with no lock, each on the call's transaction; faked in a spec. */
export interface GenderDecisionReads {
  /** The person's `confirmed` enrollments, as student or teacher, in id order (booking's). */
  confirmedEnrollmentsOf(tx: Transaction, userId: string): Promise<readonly ConfirmedEnrollment[]>;
  /** The live accounts' declared genders (identity's); a deleted account is absent. */
  gendersOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, Gender>>;
}

/** The reads over booking's and identity's entries. */
export const genderDecisionReads: GenderDecisionReads = {
  confirmedEnrollmentsOf,
  gendersOf: async (tx, userIds) =>
    new Map(
      [...(await sessionPartiesOf(tx, [...new Set(userIds)]))].map(([id, { gender }]) => [
        id,
        gender,
      ]),
    ),
};

/** The other declared gender: a correction's only outcome (FR-GENDER-4; the gender is binary). */
export function otherGender(gender: Gender): Gender {
  return gender === 'male' ? 'female' : 'male';
}

/**
 * Of `enrollments` (the person's own), the ids of those whose two declared genders differ once the
 * person's gender is `to`, in id order; an enrollment whose other party is absent is left out.
 */
export function pairingTwoGenders(
  enrollments: readonly ConfirmedEnrollment[],
  genders: ReadonlyMap<string, Gender>,
  userId: string,
  to: Gender,
): string[] {
  return enrollments
    .filter((enrollment) => {
      const other =
        enrollment.studentUserId === userId ? enrollment.teacherUserId : enrollment.studentUserId;
      const theirs = genders.get(other);
      return theirs !== undefined && theirs !== to;
    })
    .map(({ id }) => id)
    .sort();
}

/**
 * 005:T014: what the correction locks and writes besides the enrollment side, each on the call's
 * transaction, over identity's, moderation's, catalog's, booking's and sessions' entries; faked in a
 * spec.
 */
export interface CorrectionSteps {
  flagOf(tx: Transaction, flagId: string): Promise<GenderFlagRow | null>;
  /** Identity's: the person's `users` row, `FOR UPDATE`. */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** Moderation's: the flag closed by one conditional update `WHERE status = 'open'`. */
  resolveFlag(tx: Transaction, resolution: GenderFlagResolution): Promise<boolean>;
  declaredGenderOf(tx: Transaction, userId: string): Promise<Gender | null>;
  /** Identity's administrators-only setter, conditional on `from`. */
  setDeclaredGender(tx: Transaction, userId: string, from: Gender, to: Gender): Promise<boolean>;
  /** Catalog's: the teacher's slots' advisory lock. */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  /** Booking's: the person's active holds, locked, and their enrollments. */
  lockActiveHoldsOf(tx: Transaction, userId: string): Promise<LockedHolds>;
  /** Sessions': the remaining sessions cancelled, the open remedies handed to each one's case. */
  cancelRemaining(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
    caseOf: (enrollmentId: string) => Promise<string | null>,
  ): Promise<EnrollmentsEnded>;
  /** Moderation's: the enrollment's `gender_correction` case, opened (or joined); its id. */
  openCase(tx: Transaction, enrollmentId: string): Promise<string>;
  /** Sessions' (T071): a paused enrollment's `teacher_suspended` case closed, covered by the end's. */
  closePausedCase(
    tx: Transaction,
    log: Pick<Logger, 'info'>,
    end: {
      readonly adminId: string;
      readonly enrollmentId: string;
      readonly endCaseId: string | null;
    },
  ): Promise<void>;
  /** Booking's release: the holds `admin`, their unpaid enrollments `gender_correction` (Q-G2 (c)). */
  releaseHolds(
    tx: Transaction,
    holdIds: readonly string[],
    dependencies: { readonly at: Date; readonly orders: OrderStandings },
  ): Promise<{ readonly released: readonly string[] }>;
}

/** The steps over the owners' entries. */
export const correctionSteps: CorrectionSteps = {
  flagOf: (tx, flagId) => genderFlagStore.flagOf(tx, flagId),
  lockAccount,
  resolveFlag: (tx, resolution) => genderFlagStore.resolve(tx, resolution),
  declaredGenderOf,
  setDeclaredGender,
  lockTeacherSlots,
  lockActiveHoldsOf: (tx, userId) => lockActiveHoldsOf(tx, userId),
  cancelRemaining: (tx, enrollmentIds, now, caseOf) =>
    cancelRemainingSessions(tx, enrollmentIds, now, caseOf),
  openCase: async (tx, enrollmentId) =>
    (await openCompensationCase(tx, enrollmentId, 'gender_correction')).caseId,
  closePausedCase: async (tx, log, end) => {
    await closePausedCaseOnEnd(tx, pausedCaseStore, log, { ...end, end: 'gender_correction' });
  },
  releaseHolds: (tx, holdIds, dependencies) =>
    releaseHolds(tx, holdIds, 'admin', dependencies, 'gender_correction'),
};

export interface GenderDecisionsDependencies {
  /** Moderation's flags, the administrator's half (one `createGenderFlags` built by `main.ts`). */
  readonly flags: AdminGenderFlags;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  readonly reads?: GenderDecisionReads;
  /** 005:T014: sessions' `EnrollmentSide`, bound by `main.ts` to booking's. */
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments' | 'cancel'>;
  /** 005:T014: the kernel's idempotency, keyed on the call's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** 005:T014: payments' `orderStandingsOf`, for the release's orders (Q-G2 (c)). */
  readonly orders: OrderStandings;
  /** 005:T014: certification's `rerenderOfParty` (Q-G4 (a)). */
  readonly rerenderOfParty: (tx: Transaction, userId: string) => Promise<readonly unknown[]>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly steps?: CorrectionSteps;
}

/** 005:T014: what a correction did, for the router's audit (Q-G6: the gender before and after). */
export type Correction = {
  readonly flaggedUserId: string;
  readonly from: Gender;
  readonly to: Gender;
  readonly endedEnrollments: number;
};

/** The administrator surface's `genderFlags.*`, each on the administrator kind's transaction. */
export interface GenderDecisions {
  list(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsListInput,
  ): Promise<AdminGenderFlagsListOutput>;
  get(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsGetInput,
  ): Promise<AdminGenderFlagsGetOutput>;
  raise(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsRaiseInput,
  ): Promise<{ readonly flagId: string; readonly replayed: boolean }>;
  dismiss(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsDismissInput,
  ): Promise<{ readonly flaggedUserId: string; readonly replayed: boolean }>;
  /** 005:T014: `genderFlags.correct` (this file's head). */
  correct(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsCorrectInput,
  ): Promise<Correction & { readonly replayed: boolean }>;
}

const CORRECT_SCOPE = 'genderFlags.correct';

/** Why a decision was refused, as its one line names it. */
type DecisionRefusal = 'no_flag' | 'no_person' | 'already_resolved';

/** Logs the refusal with ids and its reason only, and answers the error to throw, marked logged. */
function decisionRefusal(
  log: Pick<Logger, 'info'>,
  ids: Readonly<Record<string, string>>,
  errorCode: ErrorCode,
  reason: DecisionRefusal,
  details?: readonly FieldIssue[],
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A gender decision was refused');
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details === undefined ? undefined : { details }),
  );
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

export function createGenderDecisions({
  flags,
  log,
  reads = genderDecisionReads,
  enrollments,
  idempotency,
  orders,
  rerenderOfParty,
  clock = clockTimestamp,
  steps = correctionSteps,
}: GenderDecisionsDependencies): GenderDecisions {
  /** The preview: the person's confirmed enrollments a correction would end now (this file's head). */
  const wouldEnd = async (tx: Transaction, userId: string): Promise<readonly string[]> => {
    const enrollmentsOf = await reads.confirmedEnrollmentsOf(tx, userId);
    const genders = await reads.gendersOf(tx, [
      userId,
      ...enrollmentsOf.flatMap(({ studentUserId, teacherUserId }) => [
        studentUserId,
        teacherUserId,
      ]),
    ]);
    const declared = genders.get(userId);
    if (declared === undefined) return [];
    return pairingTwoGenders(enrollmentsOf, genders, userId, otherGender(declared));
  };

  /** The flag claimed under the person's lock, the gender written the other one (this file's head). */
  const corrected = async (
    tx: Transaction,
    adminId: string,
    flagId: string,
    reason: string,
  ): Promise<{ readonly person: string; readonly from: Gender; readonly to: Gender }> => {
    const ids = { adminId, flagId };
    const seen = await steps.flagOf(tx, flagId);
    if (seen === null) throw decisionRefusal(log, ids, 'NOT_FOUND', 'no_flag');
    const person = seen.flaggedUserId;
    await steps.lockAccount(tx, person);
    const at = await clock(tx);
    if (
      !(await steps.resolveFlag(tx, { flagId, outcome: 'corrected', note: reason, adminId, at }))
    ) {
      throw decisionRefusal(log, ids, 'CONFLICT', 'already_resolved', [
        { path: 'flagId', code: 'already_resolved' },
      ]);
    }
    const from = await steps.declaredGenderOf(tx, person);
    if (from === null) throw decisionRefusal(log, ids, 'NOT_FOUND', 'no_person');
    const to = otherGender(from);
    if (!(await steps.setDeclaredGender(tx, person, from, to))) {
      throw new Error('gender correction: a gender read under the person lock was not written');
    }
    return { person, from, to };
  };

  /** The correction on the keyed transaction (this file's head, in the kernel row's order). */
  const correctLocked = async (
    tx: Transaction,
    adminId: string,
    { flagId, reason }: { readonly flagId: string; readonly reason: string },
  ): Promise<Correction> => {
    const { person, from, to } = await corrected(tx, adminId, flagId, reason);
    const confirmed = await reads.confirmedEnrollmentsOf(tx, person);
    const genders = await reads.gendersOf(tx, [
      person,
      ...confirmed.flatMap(({ studentUserId, teacherUserId }) => [studentUserId, teacherUserId]),
    ]);
    const ending = pairingTwoGenders(confirmed, genders, person, to);
    const teachers = confirmed
      .filter(({ id }) => ending.includes(id))
      .map(({ teacherUserId }) => teacherUserId);
    for (const key of sortedUnique([person, ...teachers])) await steps.lockTeacherSlots(tx, key);
    const holds = await steps.lockActiveHoldsOf(tx, person);
    const toLock = sortedUnique([...holds.enrollmentIds, ...ending]);
    if (toLock.length > 0) await enrollments.lockEnrollments(tx, toLock);
    const still = [];
    for (const enrollmentId of ending) {
      const terms = await enrollments.enrollmentFor(tx, enrollmentId);
      if (terms?.status === 'confirmed') still.push(terms);
    }
    for (const { id } of still) {
      if (!(await enrollments.cancel(tx, id, 'gender_correction'))) {
        throw new Error(
          'gender correction: a confirmed enrollment read under its lock did not move',
        );
      }
    }
    const endedIds = still.map(({ id }) => id);
    const at = await clock(tx);
    const ended =
      endedIds.length === 0
        ? null
        : await steps.cancelRemaining(tx, endedIds, at, (enrollmentId) =>
            steps.openCase(tx, enrollmentId),
          );
    for (const enrollmentId of endedIds) {
      await steps.closePausedCase(tx, log, {
        adminId,
        enrollmentId,
        endCaseId: ended?.caseOf.get(enrollmentId) ?? null,
      });
    }
    const released =
      holds.holdIds.length === 0
        ? []
        : (await steps.releaseHolds(tx, holds.holdIds, { at, orders })).released;
    const rerendered = await rerenderOfParty(tx, person);
    const live = publisherOn(tx);
    live?.afterCommit([person], { type: 'account' });
    for (const { id, studentUserId, teacherUserId } of still) {
      live?.afterCommit([studentUserId, teacherUserId], { type: 'enrollment', enrollmentId: id });
    }
    log.info(
      {
        adminId,
        flagId,
        userId: person,
        endedEnrollments: endedIds.length,
        cancelledSessions: ended?.cancelledSessionIds.length ?? 0,
        releasedHolds: released.length,
        rerenderedIjazahs: rerendered.length,
      },
      'A declared gender was corrected',
    );
    return { flaggedUserId: person, from, to, endedEnrollments: endedIds.length };
  };

  return {
    list: async (tx, adminId, input) => {
      const page = await flags.list(tx, adminId, input, log);
      return { ...page, items: [...page.items] };
    },
    get: async (tx, adminId, input) => {
      const detail = await flags.detail(tx, adminId, input, log);
      const enrollmentIds = [...(await wouldEnd(tx, detail.flaggedUserId))];
      return { ...detail, correctionWouldEnd: { count: enrollmentIds.length, enrollmentIds } };
    },
    raise: (tx, adminId, input) => flags.raiseByAdministrator(tx, adminId, input, log),
    dismiss: (tx, adminId, input) => flags.dismiss(tx, adminId, input, log),
    correct: async (tx, adminId, { idempotencyKey, ...asked }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        { scope: CORRECT_SCOPE, key: idempotencyKey, actorId: adminId, input: asked },
        (keyed) => correctLocked(keyed, adminId, asked),
      );
      return { ...outcome, replayed };
    },
  };
}
