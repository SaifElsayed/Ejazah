// T064: the standing's store held in memory, for `standing.service.spec.ts`. It keeps the database's
// rules (a write moves only the state it names), so the service's own rules are what the spec
// proves; the real queries, whose decisions name a real administrator, are probed in
// `tests/db-integrity/application-review.spec.ts`.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type { StandingStore } from '../standing.service.js';
import type {
  AccountStatus,
  ProfileBan,
  ProfileDecision,
  Standing,
} from '../standing.repository.js';
import type { SessionRevokedReason } from '../user-sessions.repository.js';

type Teacher = NonNullable<Standing['teacher']>;

interface Person {
  accountStatus: AccountStatus;
  teacher:
    | (Teacher & {
        applicationNote: string | null;
        decidedAt: Date | null;
        decidedBy: string | null;
      })
    | null;
  sessions: { revokedReason: SessionRevokedReason | null; revokedAt: Date | null }[];
}

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

export class MemoryStandingStore implements StandingStore {
  readonly #people = new Map<string, Person>();
  /** Each lock and each read of the standing, in order: `lock:<id>`, `read:<id>` (T126). */
  readonly journal: string[] = [];

  /** A person with one live session, a teacher when `teacher` is given; the id. */
  plant(
    values: {
      accountStatus?: AccountStatus;
      teacher?: Pick<Teacher, 'verificationStatus' | 'applicationStatus'>;
    } = {},
  ): string {
    const userId = randomUUID();
    this.#people.set(userId, {
      accountStatus: values.accountStatus ?? 'active',
      teacher:
        values.teacher === undefined
          ? null
          : { ...values.teacher, applicationNote: null, decidedAt: null, decidedBy: null },
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
    if (ban.kind === 'teacher') {
      if (teacher.verificationStatus !== 'approved' && teacher.verificationStatus !== 'revoked') {
        return false;
      }
      Object.assign(teacher, { verificationStatus: 'banned' });
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
    });
    return true;
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
