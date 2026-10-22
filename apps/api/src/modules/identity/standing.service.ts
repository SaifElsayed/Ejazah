// T068 (FR-165, FR-162, FR-166, FR-142, ADR 0016 D2): a person's standing as the administrator
// changes it. A suspension writes `account_status` only (`suspended` is the account's word, no
// longer the profile's, data-model.md); a revocation writes `verification_status = revoked` and the
// application `rejected` with the reason as its note, removes the teacher's subjects (FR-153: a
// subject is the teacher's only while approved; a new approval grants them again) and keeps the
// account active; a ban is permanent and one function for the applicant (`applications.ban`, the
// note written to the application) and the teacher (`teachers.ban`), owner's decision 2026-10-22;
// only a suspended teacher is reinstated (FR-165), and no ban is lifted from the panel (FR-162).
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
import type { AccountConsequences } from './consequences.js';
import {
  type AccountStatus,
  banTeacherProfile,
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
    read: readStanding,
    moveAccount: moveAccountStatus,
    revokeApproval: revokeTeacherApproval,
    banProfile: banTeacherProfile,
    revokeSessions: (tx, userId, reason, at) => sessions.revokeAll(tx, userId, reason, { at }),
  };
}

const PATH = 'teacherUserId';

export interface StandingDependencies {
  readonly store: StandingStore;
  readonly consequences: AccountConsequences;
  /** Removes the teacher's subjects (catalog's `teacher_subjects`), on the action's transaction. */
  readonly revokeSubjects: (tx: Transaction, teacherUserId: string) => Promise<void>;
  readonly now?: () => Date;
}

export class StandingService {
  readonly #store: StandingStore;
  readonly #consequences: AccountConsequences;
  readonly #revokeSubjects: StandingDependencies['revokeSubjects'];
  readonly #now: () => Date;

  constructor(dependencies: StandingDependencies) {
    this.#store = dependencies.store;
    this.#consequences = dependencies.consequences;
    this.#revokeSubjects = dependencies.revokeSubjects;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `teachers.suspend`: an active approved teacher. */
  async suspend(tx: Transaction, _adminId: string, teacherUserId: string): Promise<void> {
    const standing = await this.#teacher(tx, teacherUserId);
    if (standing.teacher.verificationStatus !== 'approved' || standing.accountStatus !== 'active') {
      throw conflict(standing);
    }
    if (!(await this.#store.moveAccount(tx, teacherUserId, ['active'], 'suspended'))) {
      throw conflict(await this.#teacher(tx, teacherUserId));
    }
    await this.#end(tx, teacherUserId, 'suspended');
  }

  /** `teachers.revokeApproval`: an approved teacher, active or suspended. */
  async revokeApproval(
    tx: Transaction,
    adminId: string,
    teacherUserId: string,
    reason: string,
  ): Promise<void> {
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
  }

  /**
   * `teachers.ban` (an approved teacher, active or suspended) and `applications.ban` (an open
   * application, with the note the applicant sees): the account banned for good.
   */
  async ban(
    tx: Transaction,
    adminId: string,
    userId: string,
    applicant?: { readonly applicantNote: string },
  ): Promise<void> {
    const standing = await this.#teacher(tx, userId);
    const open =
      standing.teacher.applicationStatus === 'in_review' ||
      standing.teacher.applicationStatus === 'needs_document';
    const allowed =
      standing.accountStatus !== 'banned' &&
      (applicant === undefined ? standing.teacher.verificationStatus === 'approved' : open);
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
  }

  /** `teachers.reinstate`: a suspended teacher back to active; no consequence is undone here. */
  async reinstate(tx: Transaction, _adminId: string, teacherUserId: string): Promise<void> {
    const standing = await this.#teacher(tx, teacherUserId);
    if (standing.accountStatus !== 'suspended') throw conflict(standing);
    if (!(await this.#store.moveAccount(tx, teacherUserId, ['suspended'], 'active'))) {
      throw conflict(await this.#teacher(tx, teacherUserId));
    }
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
