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
// then locks the application's row too (T164), always after the account's.
// Each of the three ends every session of the person (`user_sessions.revoked_reason`) and calls the
// one consequences entry (`consequences.ts`), all on the administrator kind's transaction, so the
// change, the revocations, the consequences and the audit entry commit together.
//
// The identity request (FR-166): an open request moves an active account to
// `verification_required`, and its acceptance moves it back; any other standing is left as it is.
//
// A refusal is CONFLICT naming the standing the person is in (`details: [{ path, code }]`), or
// NOT_FOUND for a person who is not a teacher (or not there).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { lockApplication } from './application.repository.js';
import type { AccountConsequences } from './consequences.js';
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
  return {
    lockAccount,
    lockApplication,
    read: readStanding,
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

  /** An identity request opened: an active account waits on it; whether it moved. */
  requireIdentity(tx: Transaction, userId: string): Promise<boolean> {
    return this.#store.moveAccount(tx, userId, ['active'], 'verification_required');
  }

  /** The identity document accepted: an account waiting on it is active again. */
  async identityAccepted(tx: Transaction, userId: string): Promise<void> {
    await this.#store.moveAccount(tx, userId, ['verification_required'], 'active');
  }

  /** Every session ended, then the one consequences entry. */
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
  }

  async #teacher(
    tx: Transaction,
    userId: string,
  ): Promise<Standing & { readonly teacher: NonNullable<Standing['teacher']> }> {
    const standing = await this.#store.read(tx, userId);
    if (standing?.teacher == null) throw new DomainError('NOT_FOUND');
    return { ...standing, teacher: standing.teacher };
  }
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
