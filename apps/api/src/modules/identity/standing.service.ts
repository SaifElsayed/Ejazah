// T068 (FR-165, FR-162, FR-166, FR-142, ADR 0016 D2): a person's standing as the administrator
// changes it. A suspension writes `account_status` only (`suspended` is the account's word, no
// longer the profile's, data-model.md); a revocation writes `verification_status = revoked` and the
// application `rejected` with the reason as its note, removes the teacher's subjects (FR-153: a
// subject is the teacher's only while approved; a new approval grants them again) and keeps the
// account active; a ban is one function for the applicant (`applications.ban`, the note written to
// the application) and the teacher (`teachers.ban`), owner's decision 2026-10-22, reaching a revoked
// teacher and a rejected applicant too, and since T072 it is lifted at any time («THE LIFTS» below);
// only a suspended teacher is reinstated (FR-165), to `verification_required` while an identity
// request is open (T113).
// Each action answers what it moved, the state before and after, for its audit entry (T116);
// suspend, ban and reinstate lock the account's row before they read it (T126), so the `before`
// they answer is the state they moved and a concurrent move on the account waits for them; a ban
// then locks the application's row too (T164), always after the account's. A revocation locks the
// account's row first too (PR #120's review, M1): it turns the bookable predicate false, so a Pay or
// a confirmation holding the account is waited for, and one after it reads the revocation; then the
// application's row, as a ban does (T041).
// Each of the three ends every session of the person (`user_sessions.revoked_reason`) and calls the
// one consequences entry (`consequences.ts`), all on the administrator kind's transaction, so the
// change, the revocations, the consequences and the audit entry commit together.
//
// The identity request (FR-166): an open request moves an active account to
// `verification_required`, and its acceptance moves it back; any other standing is left as it is.
//
// A refusal is CONFLICT naming the standing the person is in (`details: [{ path, code }]`), or
// NOT_FOUND for a person who is not a teacher (or not there).
//
// A STUDENT'S STANDING (T005 of specs/004-sessions, `002:T144`; FR-421, FR-486; R-313): the same
// three moves for a student, `suspendStudent`, `banStudent` and `reinstateStudent`, each the
// account's lock first, then the student's own read (`readStudent`: a student has no teacher
// profile), the conditional move, and, for the first two, every sign-in session ended and the one
// consequences entry on the action's transaction; the reinstatement lands as a teacher's does. A
// refusal names the account status (`details: [{ path: 'studentUserId', code }]`), or NOT_FOUND for a
// person who is not a live student.
//
// T071 of specs/004-sessions (FR-504; SRS FR-SESS-16 as amended; the notes under T071, Q5.2 (a) and
// Q6 (a)). `#end` passes the administrator to every consequence as its `actor` (booking's subscriber
// closes a paused enrollment's `teacher_suspended` case in their name, rule 46). A teacher's
// suspension pauses the teacher's confirmed enrollments (booking's subscriber), and the
// reinstatement resumes them through `reinstatement`, handed in by the admin module (identity imports
// no other module, docs/ARCHITECTURE.md §4): the paused enrollments' students read with no lock, then
// `users`, the teacher and those students, in one call in id order in place of `lockAccount`
// (`003:T005`'s rule 2; contracts/kernel.md, the reinstatement's row), the teacher's standing read
// again under it and moved, then, on the same transaction, each session the suspension cancelled
// offered and each `teacher_suspended` case closed; a refusal there (`no_free_week`) rolls the
// whole reinstatement back. Without `reinstatement` the reinstatement moves the account only.
//
// THE LIFTS (T072 of specs/004-sessions; FR-502; SRS FR-ADMIN-5 as amended, DEC-66, DEC-69; the note
// under T072, N1, Q6 (a), Q7 (a), N12). A ban is no longer final, and no longer what the head above
// says: every ban, `teachers.ban`, `applications.ban` and `banStudent` alike, writes `banned_at` (the
// database's instant, with `account_status` in one statement, rule 50), and a profile's ban keeps the
// statuses it moved from in T069's two `*_before_ban` columns. `liftStudentBan`, `liftTeacherBan` (a
// teacher's ban or an applicant's) and `liftRevocation`: the closed enrollments' counterparties read
// with no lock through `lift`, then `users`, the person and they, in one call in id order in place of
// `lockAccount` (kernel.md, the lifts' row), then for a teacher the profile (`lockApplication`, N1, as
// the ban takes it), the standing read again under them; a ban's lift moves the account to `active`
// (`verification_required` while an identity request is open; a teacher banned while suspended
// included, N12), `banned_at` cleared, and the profile back to its statuses before the ban, the two
// columns cleared, the application's note and decision instant left as history; a revocation's lift
// moves the profile and the application to `approved` and grants again the subjects the approved
// credentials name. Then, on the same transaction, `lift.restoreClosed` restores each enrollment the
// ban or the revocation closed (sessions' `createBanLift`), and the person's `account` event follows
// the commit. Refused, writing nothing, with one info line `{ userId, reason }`: `CONFLICT`
// `not_banned` or `not_revoked` (`details: [{ path: 'cause', code }]`), and `NOT_FOUND` for a
// deleted or unknown person or one of the other role. Without `lift` a lift moves the standing only.
import type { BanLiftEnrollmentCause } from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import { lockApplication } from './application.repository.js';
import type { AccountConsequences } from './consequences.js';
import { AccountsRepository } from './identity.repository.js';
import {
  type AccountStatus,
  banAccountStatus,
  banTeacherProfile,
  liftAccountBanStatus,
  liftTeacherProfileBan,
  lockAccount,
  moveAccountStatus,
  type ProfileBan,
  type ProfileDecision,
  type ProfileStatuses,
  readStanding,
  readStatusesBeforeBan,
  restoreTeacherApproval,
  revokeTeacherApproval,
  type Standing,
} from './standing.repository.js';
import { type SessionRevokedReason, UserSessionsRepository } from './user-sessions.repository.js';

/** What the standing reads and writes, each on the call's transaction (`standing.repository.ts`). */
export interface StandingStore {
  /** Locks the account's row until the transaction ends (T126). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /**
   * T071: locks the accounts' rows in one call, in id order, until the transaction ends (the
   * reinstatement's teacher and the students of the paused enrollments).
   */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** Locks the application's `teacher_profiles` row until the transaction ends (T164). */
  lockApplication(tx: Transaction, userId: string): Promise<void>;
  read(tx: Transaction, userId: string): Promise<Standing | null>;
  /**
   * A live student's account status; null for a person not there, deleted, or not a student (T005
   * of specs/004-sessions: a student has no teacher profile, nor has a teacher before applying).
   */
  readStudent(tx: Transaction, userId: string): Promise<AccountStatus | null>;
  moveAccount(
    tx: Transaction,
    userId: string,
    from: readonly AccountStatus[],
    to: AccountStatus,
  ): Promise<boolean>;
  revokeApproval(tx: Transaction, userId: string, decision: ProfileDecision): Promise<boolean>;
  banProfile(tx: Transaction, userId: string, ban: ProfileBan): Promise<boolean>;
  /**
   * T072: bans the live account from one of `from`, `banned_at` the database's instant, in one
   * statement (rule 50); whether it did.
   */
  banAccount(tx: Transaction, userId: string, from: readonly AccountStatus[]): Promise<boolean>;
  /** T072: the banned account lifted to `to`, `banned_at` cleared in the same statement. */
  liftAccountBan(
    tx: Transaction,
    userId: string,
    to: Exclude<AccountStatus, 'banned'>,
  ): Promise<boolean>;
  /** T072: the profile's statuses before its ban (T069's two columns); null for none kept. */
  readBeforeBan(tx: Transaction, userId: string): Promise<ProfileStatuses | null>;
  /** T072: the banned profile back to `before`, the two columns cleared. */
  liftProfileBan(tx: Transaction, userId: string, before: ProfileStatuses): Promise<boolean>;
  /** T072: a revoked profile back to `approved`, the application `approved`. */
  restoreApproval(tx: Transaction, userId: string): Promise<boolean>;
  revokeSessions(
    tx: Transaction,
    userId: string,
    reason: SessionRevokedReason,
    at: Date,
  ): Promise<number>;
}

/** The store over the process's database. */
export function standingStoreOver(database: Database): StandingStore {
  const sessions = new UserSessionsRepository(database);
  const accounts = new AccountsRepository(database);
  return {
    lockAccount,
    // T071: `users`, identity's own table, in one statement in id order (the kernel's `lockRows`).
    lockAccounts: (tx, userIds) => lockRows(tx, 'users', userIds),
    lockApplication,
    read: readStanding,
    // The live person (`readStanding` leaves a deleted one out) whose one role is `student`.
    readStudent: async (tx, userId) => {
      const live = await readStanding(tx, userId);
      if (live === null) return null;
      return (await accounts.readStanding(userId, tx))?.role === 'student'
        ? live.accountStatus
        : null;
    },
    moveAccount: moveAccountStatus,
    revokeApproval: revokeTeacherApproval,
    banProfile: banTeacherProfile,
    // T072: `banned_at` the database's clock on the call's transaction.
    banAccount: async (tx, userId, from) =>
      banAccountStatus(tx, userId, from, await clockTimestamp(tx)),
    liftAccountBan: liftAccountBanStatus,
    readBeforeBan: readStatusesBeforeBan,
    liftProfileBan: liftTeacherProfileBan,
    restoreApproval: restoreTeacherApproval,
    revokeSessions: (tx, userId, reason, at) => sessions.revokeAll(tx, userId, reason, { at }),
  };
}

const PATH = 'teacherUserId';

/** What a standing action moved, as its audit entry's `before` and `after` hold it (T116). */
export interface StandingMove<Field extends string, Value extends string> {
  readonly before: { readonly [K in Field]: Value };
  readonly after: { readonly [K in Field]: Value };
}

type AccountMove = StandingMove<'accountStatus', AccountStatus>;
/** A ban's move, and the application status it moved from, the applicant's entry's before. */
type BanMove = AccountMove & {
  readonly applicationStatus: NonNullable<Standing['teacher']>['applicationStatus'];
};
/** T072: a lift's move, the standing before and after it, and each closed enrollment's result. */
export type LiftMove = {
  readonly before: { readonly [field: string]: string | null };
  readonly after: { readonly [field: string]: string | null };
  readonly enrollments: readonly LiftedEnrollment[];
};
type VerificationMove = StandingMove<
  'verificationStatus',
  NonNullable<Standing['teacher']>['verificationStatus']
>;

/**
 * T071 of specs/004-sessions (Q6 (a)): what a teacher's reinstatement needs from the modules that
 * hold the paused enrollments, handed in by the admin module (sessions' `createTeacherReinstatement`).
 */
export interface ReinstatementDependency {
  /** The students of the teacher's paused enrollments, read with no lock. */
  studentsOf(tx: Transaction, teacherUserId: string): Promise<readonly string[]>;
  /**
   * On the reinstatement's transaction, the accounts `lockedUserIds` held and the teacher moved:
   * each session the suspension cancelled offered and each `teacher_suspended` case closed; throws
   * the refusal (`CONFLICT` `no_free_week`) that rolls the whole reinstatement back.
   */
  resume(
    tx: Transaction,
    adminId: string,
    teacherUserId: string,
    lockedUserIds: readonly string[],
  ): Promise<void>;
}

/**
 * T072 of specs/004-sessions (FR-502; the note under T072, Q6 (a)): whose enrollments a lift reads,
 * the student's or the teacher's.
 */
export type LiftSide = 'student' | 'teacher';

/** T072: one enrollment the ban or the revocation closed, as the lift left it. */
export type LiftedEnrollment = {
  readonly enrollmentId: string;
  readonly restored: boolean;
  /** Present when not restored (`banLiftEnrollmentCause`). */
  readonly cause?: BanLiftEnrollmentCause;
};

/** T072: the lifts' keyed scopes (`idempotent-procedures.ts`). */
export type LiftScope = 'students.liftBan' | 'teachers.liftBan' | 'teachers.liftRevocation';

/** T072: a keyed lift as its router asks it: the person, the reason and the key. */
export interface KeyedLift {
  readonly scope: LiftScope;
  readonly userId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/**
 * T072 of specs/004-sessions (Q6 (a)): what a lift needs from the modules that hold the closed
 * enrollments and the subjects, handed in by the admin module (sessions' `createBanLift`).
 */
export interface LiftDependency {
  /** The other parties of the enrollments the person's ban or revocation closed, read with no lock. */
  counterpartiesOf(tx: Transaction, userId: string, side: LiftSide): Promise<readonly string[]>;
  /**
   * On the lift's transaction, the accounts `lockedUserIds` held (and a teacher's profile) and the
   * person moved: the rest of the locks, then each closed enrollment, in id order, through
   * `restoreClosed`; throws the whole lift's refusal (`CONFLICT` `restore_failed`).
   */
  restoreClosed(
    tx: Transaction,
    adminId: string,
    userId: string,
    side: LiftSide,
    lockedUserIds: readonly string[],
  ): Promise<readonly LiftedEnrollment[]>;
  /** The subjects the teacher's approved credentials grant, made theirs again (catalog's). */
  grantApprovedSubjects(tx: Transaction, teacherUserId: string): Promise<void>;
}

export interface StandingDependencies {
  readonly store: StandingStore;
  readonly consequences: AccountConsequences;
  /** Removes the teacher's subjects (catalog's `teacher_subjects`), on the action's transaction. */
  readonly revokeSubjects: (tx: Transaction, teacherUserId: string) => Promise<void>;
  /** Whether the person has an `open` identity request (verification's), on the action's transaction. */
  readonly hasOpenIdentityRequest: (tx: Transaction, userId: string) => Promise<boolean>;
  /** T071: the paused enrollments resumed at a teacher's reinstatement; absent, none is. */
  readonly reinstatement?: ReinstatementDependency;
  /** T072: the closed enrollments restored at a lift and a revocation's subjects; absent, none is. */
  readonly lift?: LiftDependency;
  /** T072: a lift's refusal lines, ids and a reason only. */
  readonly log?: Pick<Logger, 'info'>;
  /** T072: the kernel's idempotency, a lift keyed on the call's transaction (`runOn`). */
  readonly idempotency?: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly now?: () => Date;
}

export class StandingService {
  readonly #store: StandingStore;
  readonly #consequences: AccountConsequences;
  readonly #revokeSubjects: StandingDependencies['revokeSubjects'];
  readonly #hasOpenIdentityRequest: StandingDependencies['hasOpenIdentityRequest'];
  readonly #reinstatement: ReinstatementDependency | undefined;
  readonly #lift: LiftDependency | undefined;
  readonly #log: Pick<Logger, 'info'>;
  readonly #idempotency: Pick<IdempotencyService<Transaction>, 'runOn'> | undefined;
  readonly #now: () => Date;

  constructor(dependencies: StandingDependencies) {
    this.#store = dependencies.store;
    this.#consequences = dependencies.consequences;
    this.#revokeSubjects = dependencies.revokeSubjects;
    this.#hasOpenIdentityRequest = dependencies.hasOpenIdentityRequest;
    this.#reinstatement = dependencies.reinstatement;
    this.#lift = dependencies.lift;
    this.#log = dependencies.log ?? { info: () => undefined };
    this.#idempotency = dependencies.idempotency;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /**
   * `teachers.suspend`: an approved teacher, active or under an identity request (B13b review,
   * follow-up 2, owner's decision 2026-10-22); the request stays open, and its acceptance leaves
   * the suspension as it is.
   */
  async suspend(tx: Transaction, adminId: string, teacherUserId: string): Promise<AccountMove> {
    await this.#store.lockAccount(tx, teacherUserId);
    const standing = await this.#teacher(tx, teacherUserId);
    const suspendable: readonly AccountStatus[] = ['active', 'verification_required'];
    if (
      standing.teacher.verificationStatus !== 'approved' ||
      !suspendable.includes(standing.accountStatus)
    ) {
      throw conflict(standing);
    }
    if (!(await this.#store.moveAccount(tx, teacherUserId, suspendable, 'suspended'))) {
      throw conflict(await this.#teacher(tx, teacherUserId));
    }
    await this.#end(tx, adminId, teacherUserId, 'suspended');
    return accountMove(standing.accountStatus, 'suspended');
  }

  /** `teachers.revokeApproval`: an approved teacher, active or suspended. */
  async revokeApproval(
    tx: Transaction,
    adminId: string,
    teacherUserId: string,
    reason: string,
  ): Promise<VerificationMove> {
    await this.#store.lockAccount(tx, teacherUserId);
    // The application's after the account's, as a ban takes them (T164, T041), so a revocation and
    // a ban of one teacher take their locks in one order before booking's consequence runs.
    await this.#store.lockApplication(tx, teacherUserId);
    const standing = await this.#teacher(tx, teacherUserId);
    if (standing.teacher.verificationStatus !== 'approved' || standing.accountStatus === 'banned') {
      throw conflict(standing);
    }
    const decision = { adminId, at: this.#now(), note: reason };
    if (!(await this.#store.revokeApproval(tx, teacherUserId, decision))) {
      throw conflict(await this.#teacher(tx, teacherUserId));
    }
    await this.#revokeSubjects(tx, teacherUserId);
    await this.#end(tx, adminId, teacherUserId, 'approval_revoked');
    return {
      before: { verificationStatus: standing.teacher.verificationStatus },
      after: { verificationStatus: 'revoked' },
    };
  }

  /**
   * `teachers.ban` (a teacher approved or whose approval was revoked) and `applications.ban` (an
   * open or rejected application, with the note the applicant sees): the account banned for good.
   * A fraud found after a revocation or a rejection is banned at once, not when the person reapplies
   * (B13b review, follow-up 3, owner's decision 2026-10-22).
   */
  async ban(
    tx: Transaction,
    adminId: string,
    userId: string,
    applicant?: { readonly applicantNote: string },
  ): Promise<BanMove> {
    await this.#store.lockAccount(tx, userId);
    // The application's lock after the account's, the one order both are taken in (T164), so the
    // application status answered as the applicant's `before` is the one banned.
    await this.#store.lockApplication(tx, userId);
    const standing = await this.#teacher(tx, userId);
    const { applicationStatus, verificationStatus } = standing.teacher;
    const allowed =
      standing.accountStatus !== 'banned' &&
      (applicant === undefined
        ? verificationStatus === 'approved' || verificationStatus === 'revoked'
        : applicationStatus === 'in_review' ||
          applicationStatus === 'needs_document' ||
          applicationStatus === 'rejected');
    if (!allowed) throw conflict(standing);
    // T072: the statuses read under the application's lock, kept for the lift.
    const before = { verificationStatus, applicationStatus };
    const written = await this.#store.banProfile(
      tx,
      userId,
      applicant === undefined
        ? { kind: 'teacher', before }
        : { kind: 'applicant', before, adminId, at: this.#now(), note: applicant.applicantNote },
    );
    const banned =
      written &&
      (await this.#store.banAccount(tx, userId, ['active', 'suspended', 'verification_required']));
    if (!banned) throw conflict(await this.#teacher(tx, userId));
    await this.#end(tx, adminId, userId, 'banned');
    return {
      ...accountMove(standing.accountStatus, 'banned'),
      applicationStatus: standing.teacher.applicationStatus,
    };
  }

  /**
   * `teachers.reinstate`: a suspended teacher back to `active`, or to `verification_required` while
   * an identity request is open (T113, owner's decision 2026-10-28). T071: the paused enrollments
   * resumed on the same transaction through `reinstatement` (this file's head).
   */
  async reinstate(tx: Transaction, adminId: string, teacherUserId: string): Promise<AccountMove> {
    // Under the account's lock, an identity request opened meanwhile is committed before this reads
    // it, so the account never lands `active` with a request open (T126). T071: the paused
    // enrollments' students read first with no lock, then the teacher and they in one call, in id
    // order; `resume` reads the paused enrollments again under their own locks.
    const reinstatement = this.#reinstatement;
    const locked =
      reinstatement === undefined
        ? [teacherUserId]
        : [...new Set([teacherUserId, ...(await reinstatement.studentsOf(tx, teacherUserId))])].sort();
    if (reinstatement === undefined) await this.#store.lockAccount(tx, teacherUserId);
    else await this.#store.lockAccounts(tx, locked);
    const standing = await this.#teacher(tx, teacherUserId);
    if (standing.accountStatus !== 'suspended') throw conflict(standing);
    const to: AccountStatus = (await this.#hasOpenIdentityRequest(tx, teacherUserId))
      ? 'verification_required'
      : 'active';
    if (!(await this.#store.moveAccount(tx, teacherUserId, ['suspended'], to))) {
      throw conflict(await this.#teacher(tx, teacherUserId));
    }
    // T071: after the move, so T028's offer reads the teacher no longer suspended.
    await reinstatement?.resume(tx, adminId, teacherUserId, locked);
    return accountMove('suspended', to);
  }

  /**
   * `students.suspend` (T005 of specs/004-sessions, `002:T144`; FR-421, FR-486; R-313): a student,
   * active or under an identity request, suspended; booking's subscriber keeps the confirmed
   * enrollments `confirmed`, cancels their upcoming sessions, freezes their open remedies and opens
   * one `student_suspended` case each, on this transaction. A dispute's `party_suspended` against a
   * student calls this on the resolution's transaction (T034).
   */
  async suspendStudent(tx: Transaction, adminId: string, userId: string): Promise<AccountMove> {
    await this.#store.lockAccount(tx, userId);
    const accountStatus = await this.#student(tx, userId);
    const suspendable: readonly AccountStatus[] = ['active', 'verification_required'];
    if (!suspendable.includes(accountStatus)) throw studentConflict(accountStatus);
    if (!(await this.#store.moveAccount(tx, userId, suspendable, 'suspended'))) {
      throw studentConflict(await this.#student(tx, userId));
    }
    await this.#end(tx, adminId, userId, 'suspended');
    return accountMove(accountStatus, 'suspended');
  }

  /**
   * `students.ban` (T005, R-313, plan.md decision 1 (a)): a student not banned, banned for good;
   * booking's subscriber cancels the confirmed enrollments `admin` at once, with one
   * `student_banned` case each. A dispute's `party_banned` against a student calls this (T034).
   */
  async banStudent(tx: Transaction, adminId: string, userId: string): Promise<AccountMove> {
    await this.#store.lockAccount(tx, userId);
    const accountStatus = await this.#student(tx, userId);
    const bannable: readonly AccountStatus[] = ['active', 'suspended', 'verification_required'];
    if (!bannable.includes(accountStatus)) throw studentConflict(accountStatus);
    if (!(await this.#store.banAccount(tx, userId, bannable))) {
      throw studentConflict(await this.#student(tx, userId));
    }
    await this.#end(tx, adminId, userId, 'banned');
    return accountMove(accountStatus, 'banned');
  }

  /**
   * `students.reinstate` (T005, the note under it): a suspended student back to `active`, or to
   * `verification_required` while an identity request is open, as a teacher's reinstatement
   * (`002:T113`, `002:T126`). The account only: nothing cancelled is restored, the case deciding,
   * and the frozen remedies are offered again by `advance-remedies` (T028, C3).
   */
  async reinstateStudent(tx: Transaction, _adminId: string, userId: string): Promise<AccountMove> {
    // Under the account's lock, as `reinstate`: `requireIdentity` takes it first too (T126), so an
    // identity request opened meanwhile is committed before this reads it.
    await this.#store.lockAccount(tx, userId);
    const accountStatus = await this.#student(tx, userId);
    if (accountStatus !== 'suspended') throw studentConflict(accountStatus);
    const to: AccountStatus = (await this.#hasOpenIdentityRequest(tx, userId))
      ? 'verification_required'
      : 'active';
    if (!(await this.#store.moveAccount(tx, userId, ['suspended'], to))) {
      throw studentConflict(await this.#student(tx, userId));
    }
    return accountMove('suspended', to);
  }

  /**
   * `students.liftBan` (T072 of specs/004-sessions; FR-502, SRS FR-ADMIN-5 as amended, DEC-66): a
   * banned student back to `active`, or `verification_required` while an identity request is open,
   * `banned_at` cleared; then each enrollment the ban closed restored through `lift` (this file's
   * head, «THE LIFTS»).
   */
  async liftStudentBan(tx: Transaction, adminId: string, userId: string): Promise<LiftMove> {
    const locked = await this.#lockForLift(tx, userId, 'student');
    const accountStatus = await this.#store.readStudent(tx, userId);
    if (accountStatus === null) throw this.#liftNotFound(userId);
    if (accountStatus !== 'banned') throw this.#liftRefused(userId, 'not_banned');
    const to = await this.#liftAccount(tx, userId);
    const enrollments = await this.#restoreClosed(tx, adminId, userId, 'student', locked);
    publisherOn(tx)?.afterCommit([userId], { type: 'account' });
    return { before: { accountStatus }, after: { accountStatus: to }, enrollments };
  }

  /**
   * `teachers.liftBan` (T072; FR-502): a banned teacher or applicant (`ban` serves both) back to
   * the account's `active` (or `verification_required`) and the profile's statuses before the ban,
   * T069's two columns cleared, the application's note and decision instant left as history; a
   * teacher banned while suspended returns to `active` (N12). Then the closed enrollments restored.
   */
  async liftTeacherBan(tx: Transaction, adminId: string, userId: string): Promise<LiftMove> {
    const locked = await this.#lockForLift(tx, userId, 'teacher');
    await this.#store.lockApplication(tx, userId);
    const standing = await this.#liftedTeacher(tx, userId);
    if (standing.accountStatus !== 'banned') throw this.#liftRefused(userId, 'not_banned');
    const before = await this.#store.readBeforeBan(tx, userId);
    // Every ban writes the two columns (T072); none lacks them but a ban before T069 (no launch).
    if (before === null) {
      throw new Error('lift: a banned profile without its statuses before the ban');
    }
    if (!(await this.#store.liftProfileBan(tx, userId, before))) {
      throw new Error('lift: the banned profile, read under its lock, did not move back');
    }
    const to = await this.#liftAccount(tx, userId);
    const enrollments = await this.#restoreClosed(tx, adminId, userId, 'teacher', locked);
    publisherOn(tx)?.afterCommit([userId], { type: 'account' });
    return {
      before: {
        accountStatus: 'banned',
        verificationStatus: standing.teacher.verificationStatus,
        applicationStatus: standing.teacher.applicationStatus,
      },
      after: { accountStatus: to, ...before },
      enrollments,
    };
  }

  /**
   * `teachers.liftRevocation` (T072; FR-502): a revoked teacher, not banned, back to `approved`, the
   * application `approved`, the subjects the approved credentials grant made theirs again; the
   * account as it is (a revocation never moved it). Then the closed enrollments restored.
   */
  async liftRevocation(tx: Transaction, adminId: string, userId: string): Promise<LiftMove> {
    const locked = await this.#lockForLift(tx, userId, 'teacher');
    await this.#store.lockApplication(tx, userId);
    const standing = await this.#liftedTeacher(tx, userId);
    if (standing.teacher.verificationStatus !== 'revoked' || standing.accountStatus === 'banned') {
      throw this.#liftRefused(userId, 'not_revoked');
    }
    if (!(await this.#store.restoreApproval(tx, userId))) {
      throw new Error('lift: the revoked profile, read under its lock, did not move back');
    }
    await this.#lift?.grantApprovedSubjects(tx, userId);
    const enrollments = await this.#restoreClosed(tx, adminId, userId, 'teacher', locked);
    publisherOn(tx)?.afterCommit([userId], { type: 'account' });
    return {
      before: {
        verificationStatus: 'revoked',
        applicationStatus: standing.teacher.applicationStatus,
      },
      after: { verificationStatus: 'approved', applicationStatus: 'approved' },
      enrollments,
    };
  }

  /**
   * T072: a lift keyed through the kernel's `runOn` on the call's transaction (as `sessions.restore`
   * is): scope the procedure's path, the administrator the actor, the person and the reason what was
   * asked. A repeat answers the first move and writes nothing (`replayed`); the same key with another
   * input is the kernel's `CONFLICT`.
   */
  async keyedLift(
    tx: Transaction,
    adminId: string,
    { scope, userId, reason, idempotencyKey }: KeyedLift,
  ): Promise<{ readonly move: LiftMove; readonly replayed: boolean }> {
    if (this.#idempotency === undefined) throw new Error('lift: no idempotency handed in');
    const lift =
      scope === 'students.liftBan'
        ? this.liftStudentBan
        : scope === 'teachers.liftBan'
          ? this.liftTeacherBan
          : this.liftRevocation;
    const { outcome, replayed } = await this.#idempotency.runOn(
      tx,
      { scope, key: idempotencyKey, actorId: adminId, input: { userId, reason } },
      (keyed) => lift.call(this, keyed, adminId, userId),
    );
    return { move: outcome, replayed };
  }

  /** An identity request opened: an active account waits on it; whether it moved. */
  requireIdentity(tx: Transaction, userId: string): Promise<boolean> {
    return this.#store.moveAccount(tx, userId, ['active'], 'verification_required');
  }

  /** The identity document accepted: an account waiting on it is active again. */
  async identityAccepted(tx: Transaction, userId: string): Promise<void> {
    await this.#store.moveAccount(tx, userId, ['verification_required'], 'active');
  }

  /**
   * Every session ended, then the one consequences entry; and the person's `account` event added to
   * the action's after-commit list (T063 of specs/004-sessions, FR-429; research R-324, item 6), so
   * once the transaction commits their live streams read `account.me` and end, and on a rollback
   * nothing is sent. The list is the administrator kind's, bound to this transaction. T071: the
   * administrator reaches every consequence as its `actor` (Q5.2 (a)).
   */
  async #end(
    tx: Transaction,
    adminId: string,
    userId: string,
    cause: 'suspended' | 'approval_revoked' | 'banned',
  ): Promise<void> {
    const reason =
      cause === 'suspended'
        ? 'account_suspended'
        : cause === 'banned'
          ? 'account_banned'
          : 'admin_action';
    await this.#store.revokeSessions(tx, userId, reason, this.#now());
    await this.#consequences.onAccountTerminated(tx, userId, cause, { adminId });
    publisherOn(tx)?.afterCommit([userId], { type: 'account' });
  }

  /**
   * T072: the closed enrollments' counterparties read with no lock, then `users`, the person and
   * they, in one call in id order, in place of `lockAccount` (a teacher's profile next, N1); the
   * accounts locked.
   */
  async #lockForLift(tx: Transaction, userId: string, side: LiftSide): Promise<string[]> {
    const counterparties = (await this.#lift?.counterpartiesOf(tx, userId, side)) ?? [];
    const locked = [...new Set([userId, ...counterparties])].sort();
    await this.#store.lockAccounts(tx, locked);
    return locked;
  }

  /** T072: the banned account to `active`, or `verification_required` under an open request. */
  async #liftAccount(tx: Transaction, userId: string): Promise<Exclude<AccountStatus, 'banned'>> {
    const to = (await this.#hasOpenIdentityRequest(tx, userId))
      ? 'verification_required'
      : 'active';
    if (!(await this.#store.liftAccountBan(tx, userId, to))) {
      throw new Error('lift: the banned account, read under its lock, did not move');
    }
    return to;
  }

  /** T072: the closed enrollments restored through `lift`; none without it. */
  async #restoreClosed(
    tx: Transaction,
    adminId: string,
    userId: string,
    side: LiftSide,
    locked: readonly string[],
  ): Promise<readonly LiftedEnrollment[]> {
    return (await this.#lift?.restoreClosed(tx, adminId, userId, side, locked)) ?? [];
  }

  /** T072: the teacher's standing for a lift, NOT_FOUND (logged) for no live teacher profile. */
  async #liftedTeacher(
    tx: Transaction,
    userId: string,
  ): Promise<Standing & { readonly teacher: NonNullable<Standing['teacher']> }> {
    const standing = await this.#store.read(tx, userId);
    if (standing?.teacher == null) throw this.#liftNotFound(userId);
    return { ...standing, teacher: standing.teacher };
  }

  /** T072: a lift refused CONFLICT with its cause, after one info line of ids and the reason. */
  #liftRefused(userId: string, reason: 'not_banned' | 'not_revoked'): DomainError {
    this.#log.info({ userId, reason }, 'A lift was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: reason }] }),
    );
  }

  /** T072: a lift of a deleted or unknown person, or of the other role, NOT_FOUND. */
  #liftNotFound(userId: string): DomainError {
    this.#log.info({ userId, reason: 'not_found' }, 'A lift was refused');
    return markRefusalLogged(new DomainError('NOT_FOUND'));
  }

  async #teacher(
    tx: Transaction,
    userId: string,
  ): Promise<Standing & { readonly teacher: NonNullable<Standing['teacher']> }> {
    const standing = await this.#store.read(tx, userId);
    if (standing?.teacher == null) throw new DomainError('NOT_FOUND');
    return { ...standing, teacher: standing.teacher };
  }

  /** The student's account status; NOT_FOUND for a person who is not a live student. */
  async #student(tx: Transaction, userId: string): Promise<AccountStatus> {
    const accountStatus = await this.#store.readStudent(tx, userId);
    if (accountStatus === null) throw new DomainError('NOT_FOUND');
    return accountStatus;
  }
}

/** CONFLICT naming the student's account status (T005; the input's `studentUserId`). */
function studentConflict(accountStatus: AccountStatus): DomainError {
  return new DomainError('CONFLICT', undefined, {
    details: [{ path: 'studentUserId', code: accountStatus }],
  });
}

function accountMove(before: AccountStatus, after: AccountStatus): AccountMove {
  return { before: { accountStatus: before }, after: { accountStatus: after } };
}

/** CONFLICT naming the standing: the account's when it is not active, else the teacher's. */
function conflict(standing: Standing): DomainError {
  const code =
    standing.accountStatus === 'active'
      ? standing.teacher?.applicationStatus === 'approved'
        ? standing.teacher.verificationStatus
        : (standing.teacher?.applicationStatus ?? 'active')
      : standing.accountStatus;
  return new DomainError('CONFLICT', undefined, { details: [{ path: PATH, code }] });
}
