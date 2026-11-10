// T030 of specs/004-sessions/tasks.md (FR-467; ADR 0018 D4): the refund hand-off's queries on
// sessions' own tables and the kernel's locks, each on the caller's transaction. The rules (which
// reason hands which state over, `kind`, the case) are `remedy-case.service.ts`'.
//
// The write is conditional on the state the service read under its locks (the remedy still in a
// state its reason hands over), so a row another path moved meanwhile is left as it is.
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockKey, lockRows } from '../../platform/db/row-lock.js';
import type { RemedyStatus } from './completion.repository.js';

type Client = Pick<Transaction, 'sessionRemedy'>;

/** A remedy to hand over, with what its locks need: its session, enrollment and two accounts. */
export interface RemedyToHandOff {
  readonly id: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: RemedyStatus;
  readonly kind: Prisma.SessionRemedyCreateManyInput['kind'];
}

/** The remedy and its session's parties, no lock; null when absent or its session soft-deleted. */
export async function remedyToHandOff(
  tx: Client,
  remedyId: string,
): Promise<RemedyToHandOff | null> {
  const row = await tx.sessionRemedy.findFirst({
    where: { id: remedyId, session: { deletedAt: null } },
    select: {
      id: true,
      sessionId: true,
      status: true,
      kind: true,
      session: { select: { enrollmentId: true, studentUserId: true, teacherUserId: true } },
    },
  });
  if (row === null) return null;
  const { session, ...remedy } = row;
  return { ...remedy, ...session };
}

/** What a hand-over writes beside `refund_case`: the case, the instant, and `kind` when it changes. */
export interface HandOverWrite {
  readonly caseId: string;
  readonly decidedAt: Date;
  /** Written only when the reason makes the remedy a refund; otherwise `kind` is left as it is. */
  readonly kind?: 'refund';
}

/**
 * Hands the remedy to the case if it is still in one of `from`: `refund_case`, the case, the
 * instant, `kind` where given, and the pending counter-proposal's five columns cleared (rule 42);
 * whether it moved the row.
 */
export async function handOver(
  tx: Client,
  remedyId: string,
  from: readonly RemedyStatus[],
  { caseId, decidedAt, kind }: HandOverWrite,
): Promise<boolean> {
  const { count } = await tx.sessionRemedy.updateMany({
    where: { id: remedyId, status: { in: [...from] } },
    data: {
      status: 'refund_case',
      caseId,
      decidedAt,
      ...(kind === undefined ? {} : { kind }),
      counterSlotId: null,
      counterDate: null,
      counterStartTimeLocal: null,
      counterTimezone: null,
      counterProposedAt: null,
    },
  });
  return count === 1;
}

/** Both accounts, `FOR UPDATE`, in one call in id order (T005 rule 2). */
export async function lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void> {
  await lockRows(tx, 'users', userIds);
}

/** The teacher's `lockKey('teacher-slots')`, after the accounts and before the enrollment. */
export async function lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void> {
  await lockKey(tx, 'teacher-slots', teacherUserId);
}

/**
 * The enrollment's row, which the session references by a foreign key, through `lockRows` only
 * (the row-lock header's cross-table rule), reading no column of it.
 */
export async function lockEnrollments(tx: Transaction, ids: readonly string[]): Promise<void> {
  await lockRows(tx, 'enrollments', ids);
}

export async function lockSessions(tx: Transaction, ids: readonly string[]): Promise<void> {
  await lockRows(tx, 'sessions', ids);
}

export async function lockRemedies(tx: Transaction, ids: readonly string[]): Promise<void> {
  await lockRows(tx, 'session_remedies', ids);
}
