// T069: the credential review's queries over this module's `teacher_credentials` and `isnad_entries`
// (FR-163, FR-164), each on the administrator kind's transaction it is handed. The teacher's name
// comes through the credential's relation to `users`, a soft-deleted teacher's credentials left out
// of every read (R-DB-3), and a banned account's out of the queue's list and count (T122,
// `UNBANNED_TEACHER`); the reviewer's name through its relation to `admin_users`. The queue's
// search is the teacher's name as typed, in any case, `%` and `_` as themselves (`like-literal.ts`).
//
// Every write is conditional on the state it moves from, so two reviewers racing on one credential
// cannot both move it, and an approval that would make a second approved credential for the
// teacher's subject is refused by the database's partial unique (rule 23) as well as by the
// service's read. It returns no teacher, only credential rows, so it takes no requester's gender
// (R-GENDER-5) and is left out of the gender suite by name (`scripts/suite-gate.paths.ts`).
import { Prisma } from '@prisma/client';

import { likeLiteral } from '../../platform/db/like-literal.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import { UNBANNED_TEACHER } from './credentials.repository.js';
import type {
  Approval,
  Correction,
  Decision,
  ReviewFilter,
  ReviewListRow,
  ReviewRecord,
} from './credential-review.service.js';

const UNIQUE_VIOLATION = 'P2002';

type Client = Pick<Transaction, 'teacherCredential' | 'isnadEntry'>;

/** One page of the tab: waiting ones oldest submitted first, decided ones latest review first. */
export async function reviewPage(
  tx: Client,
  filter: ReviewFilter,
  skip: number,
  take: number,
): Promise<ReviewListRow[]> {
  const decided = filter.status === 'approved' || filter.status === 'rejected';
  const rows = await tx.teacherCredential.findMany({
    where: {
      status: filter.status,
      teacher: { deletedAt: null, ...UNBANNED_TEACHER, ...teacherNamed(filter.search) },
    },
    orderBy: decided
      ? [{ reviewedAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'asc' }, { id: 'asc' }],
    skip,
    take,
    select: {
      id: true,
      teacher: { select: { id: true, displayName: true } },
      subject: { select: { id: true, nameAr: true, nameEn: true } },
      submittedWithApplication: true,
      createdAt: true,
      status: true,
      reviewedAt: true,
    },
  });
  return rows.map(listRowOf);
}

/** How many credentials the tab and the search admit. */
export function reviewCount(tx: Client, filter: ReviewFilter): Promise<number> {
  return tx.teacherCredential.count({
    where: {
      status: filter.status,
      teacher: { deletedAt: null, ...UNBANNED_TEACHER, ...teacherNamed(filter.search) },
    },
  });
}

/** The credential as the review panel reads it, its chain origin first; null when not there. */
export async function readForReview(
  tx: Client,
  credentialId: string,
): Promise<ReviewRecord | null> {
  const row = await tx.teacherCredential.findFirst({
    where: { id: credentialId, teacher: { deletedAt: null } },
    select: {
      id: true,
      teacher: { select: { id: true, displayName: true } },
      subject: { select: { id: true, nameAr: true, nameEn: true } },
      submittedWithApplication: true,
      createdAt: true,
      status: true,
      documentId: true,
      holderName: true,
      riwaya: true,
      tariq: true,
      reviewReason: true,
      reviewedAt: true,
      reviewedByAdmin: { select: { displayName: true } },
      isnadEntries: { orderBy: { position: 'asc' }, select: { position: true, names: true } },
    },
  });
  if (row === null) return null;
  const { isnadEntries, reviewedByAdmin, documentId, holderName, riwaya, tariq } = row;
  return {
    ...listRowOf(row),
    documentId,
    holderName,
    riwaya,
    tariq,
    chain: isnadEntries,
    reviewReason: row.reviewReason,
    reviewedByName: reviewedByAdmin?.displayName ?? null,
  };
}

/** Whether the teacher holds an approved credential for the subject (rule 23). */
export async function hasApprovedCredential(
  tx: Client,
  teacherUserId: string,
  subjectId: string,
): Promise<boolean> {
  const count = await tx.teacherCredential.count({
    where: { teacherUserId, subjectId, status: 'approved' },
  });
  return count > 0;
}

/**
 * Approves the credential while it is pending, then writes its chain origin first. `moved` when it
 * was no longer pending; `taken` when the partial unique refused a second approved credential for
 * the subject, which aborts the transaction the caller then rolls back.
 */
export async function approveCredential(
  tx: Client,
  approval: Approval,
): Promise<'approved' | 'moved' | 'taken'> {
  try {
    const { count } = await tx.teacherCredential.updateMany({
      where: { id: approval.credentialId, status: 'pending' },
      data: {
        status: 'approved',
        holderName: approval.holderName,
        riwaya: approval.riwaya,
        tariq: approval.tariq,
        reviewReason: null,
        reviewedByAdminId: approval.adminId,
        reviewedAt: approval.at,
      },
    });
    if (count === 0) return 'moved';
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      return 'taken';
    }
    throw error;
  }
  await writeChain(tx, approval.credentialId, approval.chain, approval.adminId);
  return 'approved';
}

/**
 * T174: locks the credential's row FOR UPDATE until the transaction ends, so a correction reads the
 * transcription it replaces under the lock (rule 1). Nothing for an id that is not there.
 */
export function lockCredential(tx: Transaction, credentialId: string): Promise<void> {
  return lockRows(tx, 'teacher_credentials', [credentialId]);
}

/** Writes a rejection or a request for another document while the credential is in `from`. */
export async function decideCredential(tx: Client, decision: Decision): Promise<boolean> {
  const { count } = await tx.teacherCredential.updateMany({
    where: { id: decision.credentialId, status: { in: [...decision.from] } },
    data: {
      status: decision.to,
      reviewReason: decision.reason,
      reviewedByAdminId: decision.adminId,
      reviewedAt: decision.at,
    },
  });
  return count === 1;
}

/** Writes the correction while the credential is approved; the chain replaced when it names one. */
export async function correctCredential(tx: Client, correction: Correction): Promise<boolean> {
  const { count } = await tx.teacherCredential.updateMany({
    where: { id: correction.credentialId, status: 'approved' },
    data: { holderName: correction.holderName, riwaya: correction.riwaya, tariq: correction.tariq },
  });
  if (count === 0) return false;
  if (correction.chain !== undefined) {
    await tx.isnadEntry.deleteMany({ where: { credentialId: correction.credentialId } });
    await writeChain(tx, correction.credentialId, correction.chain, correction.adminId);
  }
  return true;
}

/** The chain's generations, origin first, numbered from 1 (rule 28: one per position). */
async function writeChain(
  tx: Client,
  credentialId: string,
  chain: readonly (readonly string[])[],
  adminId: string,
): Promise<void> {
  await tx.isnadEntry.createMany({
    data: chain.map((names, index) => ({
      credentialId,
      position: index + 1,
      names: [...names],
      createdByAdminId: adminId,
    })),
  });
}

function teacherNamed(search: string | undefined) {
  return search === undefined
    ? {}
    : { displayName: { contains: likeLiteral(search), mode: 'insensitive' as const } };
}

function listRowOf(row: {
  readonly id: string;
  readonly teacher: { readonly id: string; readonly displayName: string | null };
  readonly subject: ReviewListRow['subject'];
  readonly submittedWithApplication: boolean;
  readonly createdAt: Date;
  readonly status: ReviewListRow['status'];
  readonly reviewedAt: Date | null;
}): ReviewListRow {
  return {
    id: row.id,
    // Null only on a deleted row (rule 32), which every read here leaves out.
    teacher: { userId: row.teacher.id, displayName: row.teacher.displayName ?? '' },
    subject: row.subject,
    submittedWithApplication: row.submittedWithApplication,
    createdAt: row.createdAt,
    status: row.status,
    reviewedAt: row.reviewedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// T006 of specs/005-certification (FR-627; research R-403; the note under T006, Q1 (a), Q-A1 (a)):
// the approved credential an ijazah request freezes, read through catalog's entry by the
// certification module. One approved credential per teacher and subject (rule 23). The chain is
// its generations origin first; the teacher is appended by certification.

/** An approved credential as a request freezes it. */
export interface CredentialChain {
  readonly credentialId: string;
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly holderName: string;
  readonly riwaya: string;
  readonly tariq: string | null;
  /** The generations' names, origin first. */
  readonly generations: readonly (readonly string[])[];
}

/** The credential by its id while approved, with its chain; null otherwise. No lock. */
export async function approvedCredentialChainById(
  tx: Client,
  credentialId: string,
): Promise<CredentialChain | null> {
  const row = await tx.teacherCredential.findFirst({
    where: { id: credentialId, status: 'approved' },
    select: {
      id: true,
      teacherUserId: true,
      subjectId: true,
      holderName: true,
      riwaya: true,
      tariq: true,
      isnadEntries: { orderBy: { position: 'asc' }, select: { names: true } },
    },
  });
  // An approved credential holds its transcription (`approveCredential` writes it with the status),
  // unless its teacher, never approved, was deleted (T174, `blankTranscriptionsOfTeacher`).
  if (row === null || row.holderName === null || row.riwaya === null) return null;
  return {
    credentialId: row.id,
    teacherUserId: row.teacherUserId,
    subjectId: row.subjectId,
    holderName: row.holderName,
    riwaya: row.riwaya,
    tariq: row.tariq,
    generations: row.isnadEntries.map(({ names }) => names),
  };
}

/** The approved credential's id for the teacher's subject (rule 23), or null. No lock. */
async function approvedCredentialIdOf(
  tx: Client,
  teacherUserId: string,
  subjectId: string,
): Promise<string | null> {
  const row = await tx.teacherCredential.findFirst({
    where: { teacherUserId, subjectId, status: 'approved' },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** The teacher's approved credential for the subject, with its chain; null without one. No lock. */
export async function approvedCredentialChainOf(
  tx: Client,
  teacherUserId: string,
  subjectId: string,
): Promise<CredentialChain | null> {
  const id = await approvedCredentialIdOf(tx, teacherUserId, subjectId);
  return id === null ? null : approvedCredentialChainById(tx, id);
}

/**
 * The teacher's approved credential for the subject, locked `FOR UPDATE` and then read under the
 * lock (T005's rule 1): a send freezes what a correction committed before it, and a correction made
 * after it waits until the request exists and then re-freezes it. Null without one.
 */
export async function lockedCredentialChainOf(
  tx: Transaction,
  teacherUserId: string,
  subjectId: string,
): Promise<CredentialChain | null> {
  const id = await approvedCredentialIdOf(tx, teacherUserId, subjectId);
  if (id === null) return null;
  await lockRows(tx, 'teacher_credentials', [id]);
  return approvedCredentialChainById(tx, id);
}
