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
// 005:T023 (B49, Q-G1 (b); admin-surface.md:22): one line per such enrollment, in the preview's id
// order: its subject (booking's `enrollmentsAmong`, the snapshot's subject and session count;
// catalog's `subjectSummariesOf`) and its other party relative to the person, named through
// identity's `sessionPartiesOf` (null once that account is deleted). The count is the number of
// lines: an enrollment gone between the reads is neither drawn nor counted. No lock; no log line.
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
//
// GENDERFLAGS.FRAUDBAN (T015; FR-617; SRS FR-GENDER-6; research R-409; the note under T015, Q-G5 (b),
// with Q-G4 (a) and Q-G6 (a)). On the administrator kind's transaction, keyed `genderFlags.fraudBan`
// (`runOn`); the limit and the audit (`gender.fraud_banned` on the person, with the reason, the
// gender and the standing before and after) are the router's. The person's `users` row first, then
// the standing read under it: an applicant (a teacher neither approved nor revoked) with no
// `applicantNote` is refused CONFLICT `applicant_note_required` before anything is written (Q-G5
// (b)). Then the flag claimed `fraud_ban` and the declared gender written the other one by the
// correction's setter, without its closings, BEFORE the ban, so the ban's lift compares the
// corrected genders (`ban-lift.service.ts:250-260`); then `StandingService`'s ban by role, on the
// same transaction, with its own closings and reasons (`student_banned`, `teacher_ended`):
// `banStudent`, a teacher's `ban`, an applicant's `ban` with the note the applicant sees (the
// ban takes the person's row again, then `teacher_profiles`, then its consequences' locks); last,
// the person's unsigned ijazahs re-rendered after the commit (Q-G4 (a)). `kindsOf`, `END_REASONS`
// and `KIND_OF` are unchanged. The ban's own live `account` event follows the commit.
// ⚠️ Liftable: `students.liftBan` and `teachers.liftBan` restore only the pairings the corrected
// genders allow. One info line of ids and the role; never a gender, the reason or the note.
import type { SubjectSummary } from '@ijazah/contracts';
import type {
  AdminGenderFlagsCorrectInput,
  AdminGenderFlagsDismissInput,
  AdminGenderFlagsFraudBanInput,
  AdminGenderFlagsGetInput,
  AdminGenderFlagsGetOutput,
  AdminGenderFlagsListInput,
  AdminGenderFlagsListOutput,
  AdminGenderFlagsRaiseInput,
  GenderCorrectionLine,
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
  enrollmentsAmong,
  type LockedHolds,
  lockActiveHoldsOf,
  type OrderStandings,
  releaseHolds,
} from '../booking/index.js';
import { lockTeacherSlots, subjectSummariesOf } from '../catalog/index.js';
import {
  declaredGenderOf,
  lockAccount,
  readStanding,
  sessionPartiesOf,
  setDeclaredGender,
  type StandingService,
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
  /**
   * 005:T023 (Q-G1 (b)): what the preview's lines are drawn from: the enrollments (booking's
   * `enrollmentsAmong`; a soft-deleted one absent), their subjects (catalog's `subjectSummariesOf`)
   * and their live parties' names (identity's `sessionPartiesOf`; a deleted account absent).
   */
  previewOf(tx: Transaction, enrollmentIds: readonly string[]): Promise<PreviewReads>;
}

/** 005:T023: one enrollment as a preview line reads it. */
export interface PreviewEnrollment {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly snapshotSubjectId: string;
  readonly snapshotSessionCount: number;
}

/** 005:T023: `previewOf`'s answer. */
export interface PreviewReads {
  readonly enrollments: readonly PreviewEnrollment[];
  readonly subjects: ReadonlyMap<string, SubjectSummary>;
  /** The live parties' display names, by user id. */
  readonly names: ReadonlyMap<string, string>;
}

/** The reads over booking's, catalog's and identity's entries. */
export const genderDecisionReads: GenderDecisionReads = {
  confirmedEnrollmentsOf,
  gendersOf: async (tx, userIds) =>
    new Map(
      [...(await sessionPartiesOf(tx, [...new Set(userIds)]))].map(([id, { gender }]) => [
        id,
        gender,
      ]),
    ),
  previewOf: async (tx, enrollmentIds) => {
    const enrollments = await enrollmentsAmong(tx, enrollmentIds);
    const subjects = await subjectSummariesOf(tx, [
      ...new Set(enrollments.map(({ snapshotSubjectId }) => snapshotSubjectId)),
    ]);
    const parties = await sessionPartiesOf(tx, [
      ...new Set(
        enrollments.flatMap(({ studentUserId, teacherUserId }) => [studentUserId, teacherUserId]),
      ),
    ]);
    return {
      enrollments,
      subjects,
      names: new Map([...parties].map(([id, { displayName }]) => [id, displayName])),
    };
  },
};

/**
 * 005:T023 (Q-G1 (b)): the preview's lines, one per enrollment of `enrollmentIds` (the preview's
 * order) still read: its own subject and sessions, and its other party relative to `person`, the
 * name null once that account is deleted.
 */
export function previewLines(
  { enrollments, subjects, names }: PreviewReads,
  person: string,
  enrollmentIds: readonly string[],
): GenderCorrectionLine[] {
  const byId = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
  return enrollmentIds.flatMap((enrollmentId) => {
    const enrollment = byId.get(enrollmentId);
    if (enrollment === undefined) return [];
    const subject = subjects.get(enrollment.snapshotSubjectId);
    if (subject === undefined) {
      throw new Error('gender preview: an enrollment’s subject was not read');
    }
    const counterpart =
      enrollment.studentUserId === person ? enrollment.teacherUserId : enrollment.studentUserId;
    return [
      {
        enrollmentId,
        subject: { id: subject.id, nameAr: subject.nameAr, nameEn: subject.nameEn },
        sessions: enrollment.snapshotSessionCount,
        counterpart: { userId: counterpart, displayName: names.get(counterpart) ?? null },
      },
    ];
  });
}

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
  /** 005:T015: identity's standing of the live person, read under the lock; null for none. */
  standingOf(tx: Transaction, userId: string): Promise<PersonStanding | null>;
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

/** 005:T015: a person's standing as the fraud ban chooses its ban by (identity's `Standing`). */
export interface PersonStanding {
  readonly accountStatus: string;
  readonly teacher: {
    readonly verificationStatus: string;
    readonly applicationStatus: string | null;
  } | null;
}

/** The steps over the owners' entries. */
export const correctionSteps: CorrectionSteps = {
  flagOf: (tx, flagId) => genderFlagStore.flagOf(tx, flagId),
  lockAccount,
  standingOf: readStanding,
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
  /** 005:T015: identity's `StandingService`, the one the admin module builds (its bans). */
  readonly standing: Pick<StandingService, 'ban' | 'banStudent'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly steps?: CorrectionSteps;
}

/** 005:T015: what a fraud ban did, for the router's audit (the gender and the standing before). */
export type FraudBan = {
  readonly flaggedUserId: string;
  readonly from: Gender;
  readonly to: Gender;
  readonly accountStatus: string;
};

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
  /** 005:T015: `genderFlags.fraudBan` (this file's head). */
  fraudBan(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsFraudBanInput,
  ): Promise<FraudBan & { readonly replayed: boolean }>;
}

const CORRECT_SCOPE = 'genderFlags.correct';
const FRAUD_BAN_SCOPE = 'genderFlags.fraudBan';

/** Why a decision was refused, as its one line names it. */
type DecisionRefusal = 'no_flag' | 'no_person' | 'already_resolved' | 'applicant_note_required';

/** 005:T015: how the fraud ban bans the person (Q-G5 (b)): by role, an applicant apart. */
type BanRole = 'student' | 'teacher' | 'applicant';

function banRoleOf({ teacher }: PersonStanding): BanRole {
  if (teacher === null) return 'student';
  const { verificationStatus } = teacher;
  return verificationStatus === 'approved' || verificationStatus === 'revoked'
    ? 'teacher'
    : 'applicant';
}

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
  standing,
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
    outcome: 'corrected' | 'fraud_ban' = 'corrected',
    underLock: (person: string) => Promise<void> = async () => undefined,
  ): Promise<{ readonly person: string; readonly from: Gender; readonly to: Gender }> => {
    const ids = { adminId, flagId };
    const seen = await steps.flagOf(tx, flagId);
    if (seen === null) throw decisionRefusal(log, ids, 'NOT_FOUND', 'no_flag');
    const person = seen.flaggedUserId;
    await steps.lockAccount(tx, person);
    // T015: the fraud ban's refusals, read under the person's lock, before any write.
    await underLock(person);
    const at = await clock(tx);
    if (!(await steps.resolveFlag(tx, { flagId, outcome, note: reason, adminId, at }))) {
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

  /** 005:T015: the fraud ban on the keyed transaction (this file's head). */
  const fraudBanLocked = async (
    tx: Transaction,
    adminId: string,
    {
      flagId,
      reason,
      applicantNote,
    }: {
      readonly flagId: string;
      readonly reason: string;
      readonly applicantNote?: string | undefined;
    },
  ): Promise<FraudBan> => {
    let found: { readonly role: BanRole; readonly accountStatus: string } | undefined;
    const { person, from, to } = await corrected(
      tx,
      adminId,
      flagId,
      reason,
      'fraud_ban',
      async (userId) => {
        const read = await steps.standingOf(tx, userId);
        if (read === null)
          throw decisionRefusal(log, { adminId, flagId }, 'NOT_FOUND', 'no_person');
        const role = banRoleOf(read);
        if (role === 'applicant' && applicantNote === undefined) {
          throw decisionRefusal(log, { adminId, flagId }, 'CONFLICT', 'applicant_note_required', [
            { path: 'applicantNote', code: 'applicant_note_required' },
          ]);
        }
        found = { role, accountStatus: read.accountStatus };
      },
    );
    if (found === undefined) throw new Error('fraud ban: no standing read under the lock');
    const { role, accountStatus } = found;
    if (role === 'student') await standing.banStudent(tx, adminId, person);
    else if (role === 'teacher') await standing.ban(tx, adminId, person);
    else await standing.ban(tx, adminId, person, { applicantNote: applicantNote ?? '' });
    await rerenderOfParty(tx, person);
    log.info(
      { adminId, flagId, userId: person, role },
      'A declared gender was found fraudulent and the account banned',
    );
    return { flaggedUserId: person, from, to, accountStatus };
  };

  return {
    list: async (tx, adminId, input) => {
      const page = await flags.list(tx, adminId, input, log);
      return { ...page, items: [...page.items] };
    },
    get: async (tx, adminId, input) => {
      const detail = await flags.detail(tx, adminId, input, log);
      const person = detail.flaggedUserId;
      const enrollmentIds = await wouldEnd(tx, person);
      const lines =
        enrollmentIds.length === 0
          ? []
          : previewLines(await reads.previewOf(tx, enrollmentIds), person, enrollmentIds);
      return { ...detail, correctionWouldEnd: { count: lines.length, lines } };
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
    fraudBan: async (tx, adminId, { idempotencyKey, ...asked }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        { scope: FRAUD_BAN_SCOPE, key: idempotencyKey, actorId: adminId, input: asked },
        (keyed) => fraudBanLocked(keyed, adminId, asked),
      );
      return { ...outcome, replayed };
    },
  };
}
