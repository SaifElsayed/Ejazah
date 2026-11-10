// T068 (FR-165, FR-162, FR-166, FR-142, ADR 0016 D2): a person's standing as the administrator
// changes it. A suspension writes `account_status` only (`suspended` is the account's word, no
// longer the profile's, data-model.md); a revocation writes `verification_status = revoked` and the
// application `rejected` with the reason as its note, removes the teacher's subjects (FR-153: a
// subject is the teacher's only while approved; a new approval grants them again) and keeps the
// account active; a ban is permanent and one function for the applicant (`applications.ban`, the
// note written to the application) and the teacher (`teachers.ban`), owner's decision 2026-10-22,
// reaching a revoked teacher and a rejected applicant too;
// only a suspended teacher is reinstated (FR-165), to `verification_required` while an identity
// request is open (T113), and no ban is lifted from the panel (FR-162).
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
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import { lockApplication } from './application.repository.js';
import type { AccountConsequences } from './consequences.js';
import { AccountsRepository } from './identity.repository.js';
import {
  type AccountStatus,
  banTeacherProfile,
  lockAccount,
  moveAccountStatus,
  type ProfileBan,
  type ProfileDecision,
  readStanding,
  revokeTeacherApproval,
  type Standing,
} from './standing.repository.js';
import { type SessionRevokedReason, UserSessionsRepository } from './user-sessions.repository.js';

/** What the standing reads and writes, each on the call's transaction (`standing.repository.ts`). */
export interface StandingStore {
  /** Locks the account's row until the transaction ends (T126). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
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
type VerificationMove = StandingMove<
  'verificationStatus',
  NonNullable<Standing['teacher']>['verificationStatus']
>;

export interface StandingDependencies {
  readonly store: StandingStore;
  readonly consequences: AccountConsequences;
  /** Removes the teacher's subjects (catalog's `teacher_subjects`), on the action's transaction. */
  readonly revokeSubjects: (tx: Transaction, teacherUserId: string) => Promise<void>;
  /** Whether the person has an `open` identity request (verification's), on the action's transaction. */
  readonly hasOpenIdentityRequest: (tx: Transaction, userId: string) => Promise<boolean>;
  readonly now?: () => Date;
}

export class StandingService {
  readonly #store: StandingStore;
  readonly #consequences: AccountConsequences;
  readonly #revokeSubjects: StandingDependencies['revokeSubjects'];
  readonly #hasOpenIdentityRequest: StandingDependencies['hasOpenIdentityRequest'];
  readonly #now: () => Date;

  constructor(dependencies: StandingDependencies) {
    this.#store = dependencies.store;
    this.#consequences = dependencies.consequences;
    this.#revokeSubjects = dependencies.revokeSubjects;
    this.#hasOpenIdentityRequest = dependencies.hasOpenIdentityRequest;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /**
   * `teachers.suspend`: an approved teacher, active or under an identity request (B13b review,
   * follow-up 2, owner's decision 2026-10-22); the request stays open, and its acceptance leaves
   * the suspension as it is.
   */
  async suspend(tx: Transaction, _adminId: string, teacherUserId: string): Promise<AccountMove> {
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
    await this.#end(tx, teacherUserId, 'suspended');
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
    await this.#end(tx, teacherUserId, 'approval_revoked');
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
    const written = await this.#store.banProfile(
      tx,
      userId,
      applicant === undefined
        ? { kind: 'teacher' }
        : { kind: 'applicant', adminId, at: this.#now(), note: applicant.applicantNote },
    );
    const banned =
      written &&
      (await this.#store.moveAccount(
        tx,
        userId,
        ['active', 'suspended', 'verification_required'],
        'banned',
      ));
    if (!banned) throw conflict(await this.#teacher(tx, userId));
    await this.#end(tx, userId, 'banned');
    return {
      ...accountMove(standing.accountStatus, 'banned'),
      applicationStatus: standing.teacher.applicationStatus,
    };
  }

  /**
   * `teachers.reinstate`: a suspended teacher back to `active`, or to `verification_required` while
   * an identity request is open (T113, owner's decision 2026-10-28); no consequence is undone here.
   */
  async reinstate(tx: Transaction, _adminId: string, teacherUserId: string): Promise<AccountMove> {
    // Under the account's lock, an identity request opened meanwhile is committed before this reads
    // it, so the account never lands `active` with a request open (T126).
    await this.#store.lockAccount(tx, teacherUserId);
    const standing = await this.#teacher(tx, teacherUserId);
    if (standing.accountStatus !== 'suspended') throw conflict(standing);
    const to: AccountStatus = (await this.#hasOpenIdentityRequest(tx, teacherUserId))
      ? 'verification_required'
      : 'active';
    if (!(await this.#store.moveAccount(tx, teacherUserId, ['suspended'], to))) {
      throw conflict(await this.#teacher(tx, teacherUserId));
    }
    return accountMove('suspended', to);
  }

  /**
   * `students.suspend` (T005 of specs/004-sessions, `002:T144`; FR-421, FR-486; R-313): a student,
   * active or under an identity request, suspended; booking's subscriber keeps the confirmed
   * enrollments `confirmed`, cancels their upcoming sessions, freezes their open remedies and opens
   * one `student_suspended` case each, on this transaction. A dispute's `party_suspended` against a
   * student calls this on the resolution's transaction (T034).
   */
  async suspendStudent(tx: Transaction, _adminId: string, userId: string): Promise<AccountMove> {
    await this.#store.lockAccount(tx, userId);
    const accountStatus = await this.#student(tx, userId);
    const suspendable: readonly AccountStatus[] = ['active', 'verification_required'];
    if (!suspendable.includes(accountStatus)) throw studentConflict(accountStatus);
    if (!(await this.#store.moveAccount(tx, userId, suspendable, 'suspended'))) {
      throw studentConflict(await this.#student(tx, userId));
    }
    await this.#end(tx, userId, 'suspended');
    return accountMove(accountStatus, 'suspended');
  }

  /**
   * `students.ban` (T005, R-313, plan.md decision 1 (a)): a student not banned, banned for good;
   * booking's subscriber cancels the confirmed enrollments `admin` at once, with one
   * `student_banned` case each. A dispute's `party_banned` against a student calls this (T034).
   */
  async banStudent(tx: Transaction, _adminId: string, userId: string): Promise<AccountMove> {
    await this.#store.lockAccount(tx, userId);
    const accountStatus = await this.#student(tx, userId);
    const bannable: readonly AccountStatus[] = ['active', 'suspended', 'verification_required'];
    if (!bannable.includes(accountStatus)) throw studentConflict(accountStatus);
    if (!(await this.#store.moveAccount(tx, userId, bannable, 'banned'))) {
      throw studentConflict(await this.#student(tx, userId));
    }
    await this.#end(tx, userId, 'banned');
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
   * nothing is sent. The list is the administrator kind's, bound to this transaction.
   */
  async #end(
    tx: Transaction,
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
    await this.#consequences.onAccountTerminated(tx, userId, cause);
    publisherOn(tx)?.afterCommit([userId], { type: 'account' });
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
