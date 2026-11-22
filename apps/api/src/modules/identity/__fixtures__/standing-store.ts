// T064: the standing's store held in memory, for `standing.service.spec.ts`. It keeps the database's
// rules (a write moves only the state it names), so the service's own rules are what the spec
// proves; the real queries, whose decisions name a real administrator, are probed in
// `tests/db-integrity/application-review.spec.ts`.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type { ApplicationHistoryEntry } from '../application-history.repository.js';
import type { StandingStore } from '../standing.service.js';
import type {
  AccountStatus,
  ProfileBan,
  ProfileDecision,
  ProfileStatuses,
  Standing,
} from '../standing.repository.js';
import type { SessionRevokedReason } from '../user-sessions.repository.js';

type Teacher = NonNullable<Standing['teacher']>;

interface Person {
  accountStatus: AccountStatus;
  /** T072: `users.banned_at`, the database's instant of the ban in force (`DB_NOW`). */
  bannedAt: Date | null;
  /** The account's one role (ADR 0016 D3); a teacher's profile comes with the application. */
  role: 'student' | 'teacher';
  teacher:
    | (Teacher & {
        applicationNote: string | null;
        decidedAt: Date | null;
        decidedBy: string | null;
        /** T072: T069's `*_before_ban` columns. */
        beforeBan: ProfileStatuses | null;
      })
    | null;
  sessions: { revokedReason: SessionRevokedReason | null; revokedAt: Date | null }[];
}

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

/** T072: the database's clock as the memory store answers it (`banned_at`). */
export const DB_NOW = new Date('2026-10-22T10:00:05Z');

export class MemoryStandingStore implements StandingStore {
  readonly #people = new Map<string, Person>();
  /**
   * Each lock and each read of the standing, in order: `lock:<id>` (T126), `lock-application:<id>`
   * (T164), `read:<id>`, and a student's read, `read-student:<id>` (T005 of specs/004-sessions).
   */
  readonly journal: string[] = [];
  /** R1a (002:T174): each row the standing wrote to the application's history, in order. */
  readonly history: ApplicationHistoryEntry[] = [];

  /**
   * A person with one live session; a teacher when `teacher` is given or `role` says so (a teacher
   * with no profile yet), a student otherwise; the id.
   */
  plant(
    values: {
      accountStatus?: AccountStatus;
      teacher?: Pick<Teacher, 'verificationStatus' | 'applicationStatus'>;
      role?: Person['role'];
      /** T072: a banned profile's statuses before its ban. */
      beforeBan?: ProfileStatuses;
    } = {},
  ): string {
    const userId = randomUUID();
    this.#people.set(userId, {
      accountStatus: values.accountStatus ?? 'active',
      bannedAt: values.accountStatus === 'banned' ? DB_NOW : null,
      role: values.role ?? (values.teacher === undefined ? 'student' : 'teacher'),
      teacher:
        values.teacher === undefined
          ? null
          : {
              ...values.teacher,
              applicationNote: null,
              decidedAt: null,
              decidedBy: null,
              beforeBan: values.beforeBan ?? null,
            },
      sessions: [{ revokedReason: null, revokedAt: null }],
    });
    return userId;
  }

  person(userId: string): Person {
    const person = this.#people.get(userId);
    if (person === undefined) throw new Error(`no person ${userId}`);
    return person;
  }

  async lockAccount(_tx: Transaction, userId: string): Promise<void> {
    this.journal.push(`lock:${userId}`);
  }

  /** T071 of specs/004-sessions: the reinstatement's accounts, in one call (`lock-accounts:<ids>`). */
  async lockAccounts(_tx: Transaction, userIds: readonly string[]): Promise<void> {
    this.journal.push(`lock-accounts:${userIds.join(',')}`);
  }

  async lockApplication(_tx: Transaction, userId: string): Promise<void> {
    this.journal.push(`lock-application:${userId}`);
  }

  async read(_tx: Transaction, userId: string): Promise<Standing | null> {
    this.journal.push(`read:${userId}`);
    const person = this.#people.get(userId);
    if (person === undefined) return null;
    return {
      accountStatus: person.accountStatus,
      teacher:
        person.teacher === null
          ? null
          : {
              verificationStatus: person.teacher.verificationStatus,
              applicationStatus: person.teacher.applicationStatus,
            },
    };
  }

  async readStudent(_tx: Transaction, userId: string): Promise<AccountStatus | null> {
    this.journal.push(`read-student:${userId}`);
    const person = this.#people.get(userId);
    return person?.role === 'student' ? person.accountStatus : null;
  }

  async moveAccount(
    _tx: Transaction,
    userId: string,
    from: readonly AccountStatus[],
    to: AccountStatus,
  ): Promise<boolean> {
    const person = this.#people.get(userId);
    if (person === undefined || !from.includes(person.accountStatus)) return false;
    person.accountStatus = to;
    return true;
  }

  async revokeApproval(
    _tx: Transaction,
    userId: string,
    decision: ProfileDecision,
  ): Promise<boolean> {
    const teacher = this.#people.get(userId)?.teacher;
    if (teacher?.verificationStatus !== 'approved') return false;
    Object.assign(teacher, {
      verificationStatus: 'revoked',
      applicationStatus: 'rejected',
      applicationNote: decision.note,
      decidedAt: decision.at,
      decidedBy: decision.adminId,
    });
    return true;
  }

  async banProfile(_tx: Transaction, userId: string, ban: ProfileBan): Promise<boolean> {
    const teacher = this.#people.get(userId)?.teacher;
    if (teacher == null) return false;
    // T072: the statuses before the ban kept with it (the condition on them is the database's,
    // probed in `tests/db-integrity/ban-lift.spec.ts`).
    if (ban.kind === 'teacher') {
      if (teacher.verificationStatus !== 'approved' && teacher.verificationStatus !== 'revoked') {
        return false;
      }
      Object.assign(teacher, { verificationStatus: 'banned', beforeBan: ban.before });
      return true;
    }
    const banned: readonly (string | null)[] = ['in_review', 'needs_document', 'rejected'];
    if (!banned.includes(teacher.applicationStatus)) return false;
    Object.assign(teacher, {
      verificationStatus: 'banned',
      applicationStatus: 'banned',
      applicationNote: ban.note,
      decidedAt: ban.at,
      decidedBy: ban.adminId,
      beforeBan: ban.before,
    });
    return true;
  }

  async banAccount(
    _tx: Transaction,
    userId: string,
    from: readonly AccountStatus[],
  ): Promise<boolean> {
    const person = this.#people.get(userId);
    if (person === undefined || !from.includes(person.accountStatus)) return false;
    Object.assign(person, { accountStatus: 'banned', bannedAt: DB_NOW });
    return true;
  }

  async liftAccountBan(
    _tx: Transaction,
    userId: string,
    to: Exclude<AccountStatus, 'banned'>,
  ): Promise<boolean> {
    const person = this.#people.get(userId);
    if (person?.accountStatus !== 'banned') return false;
    Object.assign(person, { accountStatus: to, bannedAt: null });
    return true;
  }

  async readBeforeBan(_tx: Transaction, userId: string): Promise<ProfileStatuses | null> {
    return this.#people.get(userId)?.teacher?.beforeBan ?? null;
  }

  async liftProfileBan(
    _tx: Transaction,
    userId: string,
    before: ProfileStatuses,
  ): Promise<boolean> {
    const teacher = this.#people.get(userId)?.teacher;
    if (teacher?.verificationStatus !== 'banned') return false;
    if (teacher.beforeBan?.verificationStatus !== before.verificationStatus) return false;
    Object.assign(teacher, { ...before, beforeBan: null });
    return true;
  }

  async restoreApproval(_tx: Transaction, userId: string): Promise<boolean> {
    const teacher = this.#people.get(userId)?.teacher;
    if (teacher?.verificationStatus !== 'revoked') return false;
    Object.assign(teacher, { verificationStatus: 'approved', applicationStatus: 'approved' });
    return true;
  }

  async recordHistory(_tx: Transaction, entry: ApplicationHistoryEntry): Promise<void> {
    this.history.push(entry);
  }

  async revokeSessions(
    _tx: Transaction,
    userId: string,
    reason: SessionRevokedReason,
    at: Date,
  ): Promise<number> {
    const live = this.person(userId).sessions.filter((session) => session.revokedAt === null);
    for (const session of live) Object.assign(session, { revokedReason: reason, revokedAt: at });
    return live.length;
  }
}
