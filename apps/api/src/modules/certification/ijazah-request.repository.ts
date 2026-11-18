// T006 of specs/005-certification: the ijazah request's queries over this module's `ijazah_requests`,
// `ijazahs` and `ijazah_bars` (FR-603, FR-608, FR-627; research R-403, R-404; ERD §8, §15 rules 53,
// 54 and 58), each on the transaction it is handed (R-API-6). The rules are
// `ijazah-request.service.ts`'s; every write is conditional on the open states, so a request decided
// meanwhile is never moved back. The locks are `lockRows` on the rows this module's rows reference
// (`users`, `enrollments`) or its own (`ijazah_requests`), in the kernel row's order
// (specs/004-sessions/contracts/kernel.md, the ijazah request's row).
import type { Prisma } from '@prisma/client';
import { dateColumnOf } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type {
  NewIjazahRequest,
  OpenRequest,
  RequestRead,
  RequestRefreeze,
} from './ijazah-request.service.js';

type Client = Pick<Transaction, 'ijazahRequest' | 'ijazah' | 'ijazahBar'>;

/** An open request: waiting for the student's name, or pending the administrators' decision. */
const OPEN = ['awaiting_student_name', 'pending'] as const;

/** Locks the accounts, FOR UPDATE, in id order, one statement (the kernel row's head). */
export function lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void> {
  return lockRows(tx, 'users', userIds);
}

/** Locks the enrollment the request references, FOR UPDATE. */
export function lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void> {
  return lockRows(tx, 'enrollments', [enrollmentId]);
}

/** Locks the requests, FOR UPDATE, in id order, one statement. */
export function lockRequests(tx: Transaction, ids: readonly string[]): Promise<void> {
  return lockRows(tx, 'ijazah_requests', ids);
}

/** Whether the user is barred from ijazahs now: a bar not lifted (FR-610). */
export async function hasOpenBar(tx: Client, userId: string): Promise<boolean> {
  return (await tx.ijazahBar.count({ where: { userId, liftedAt: null } })) > 0;
}

/** Whether the enrollment has an open request (rule 53's partial unique, read first). */
export async function hasOpenRequest(tx: Client, enrollmentId: string): Promise<boolean> {
  return (await tx.ijazahRequest.count({ where: { enrollmentId, status: { in: [...OPEN] } } })) > 0;
}

/** Whether the enrollment has an ijazah not revoked (`already_issued`; FR-IJAZAH-9). */
export async function hasUnrevokedIjazah(tx: Client, enrollmentId: string): Promise<boolean> {
  const count = await tx.ijazah.count({
    where: { enrollmentId, revokedAt: null, deletedAt: null },
  });
  return count > 0;
}

/** Writes the request as frozen at send, its id drawn before the copy was stored. */
export async function insertRequest(tx: Client, row: NewIjazahRequest): Promise<void> {
  await tx.ijazahRequest.create({
    data: {
      id: row.id,
      enrollmentId: row.enrollmentId,
      teacherUserId: row.teacherUserId,
      studentUserId: row.studentUserId,
      subjectId: row.subjectId,
      completionDate: dateColumnOf(row.completionDate),
      language: row.language,
      status: row.status,
      chainSnapshot: chainJson(row.chainSnapshot),
      teacherNamePrinted: row.teacherNamePrinted,
      riwayaPrinted: row.riwayaPrinted,
      tariqPrinted: row.tariqPrinted,
      signatureStorageKey: row.signatureStorageKey,
    },
    select: { id: true },
  });
}

/**
 * Each enrollment's latest request among `enrollmentIds` (the id is a UUIDv7, so its order is the
 * order the requests were made), with its ijazah once approved. One read; an enrollment holds a
 * request per decision, so the rows are few. The ijazahs are read in a second statement, a
 * soft-deleted one left out (R-DB-3: a to-one relation takes no filter of its own).
 */
export async function latestRequestsAmong(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, RequestRead>> {
  const rows = await tx.ijazahRequest.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] } },
    orderBy: { id: 'desc' },
    select: { id: true, enrollmentId: true, status: true, reason: true },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.enrollmentId)) latest.set(row.enrollmentId, row);
  }
  const requestIds = [...latest.values()].map(({ id }) => id);
  const ijazahs = await tx.ijazah.findMany({
    where: { requestId: { in: requestIds }, deletedAt: null },
    // 005:T010 (Q-E2 (a)): whether it was revoked, never the reason.
    select: { id: true, requestId: true, revokedAt: true },
  });
  const ijazahOf = new Map(ijazahs.map((ijazah) => [ijazah.requestId, ijazah]));
  return new Map(
    [...latest].map(([enrollmentId, row]) => {
      const ijazah = ijazahOf.get(row.id);
      return [
        enrollmentId,
        { ...row, ijazahId: ijazah?.id ?? null, revoked: (ijazah?.revokedAt ?? null) !== null },
      ];
    }),
  );
}

/** The student's open requests, id order, with their copies' keys. */
export function openRequestsOfStudent(
  tx: Client,
  studentUserId: string,
): Promise<readonly OpenRequest[]> {
  return tx.ijazahRequest.findMany({
    where: { studentUserId, status: { in: [...OPEN] } },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, signatureStorageKey: true },
  });
}

/** The ids of the open requests of the teacher's subject, id order (the credential's, rule 23). */
export async function openRequestsOfCredential(
  tx: Client,
  teacherUserId: string,
  subjectId: string,
): Promise<readonly string[]> {
  const rows = await tx.ijazahRequest.findMany({
    where: { teacherUserId, subjectId, status: { in: [...OPEN] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** Moves the requests among `ids` still waiting for the student's name to `pending`. */
export async function releaseAwaiting(tx: Client, ids: readonly string[]): Promise<void> {
  await tx.ijazahRequest.updateMany({
    where: { id: { in: [...ids] }, status: 'awaiting_student_name' },
    data: { status: 'pending' },
  });
}

/** Re-freezes the requests among `ids` still open (P4 (a)): never a decided one. */
export async function refreezeOpen(
  tx: Client,
  ids: readonly string[],
  refreeze: RequestRefreeze,
): Promise<void> {
  await tx.ijazahRequest.updateMany({
    where: { id: { in: [...ids] }, status: { in: [...OPEN] } },
    data: {
      chainSnapshot: chainJson(refreeze.chainSnapshot),
      teacherNamePrinted: refreeze.teacherNamePrinted,
      riwayaPrinted: refreeze.riwayaPrinted,
      tariqPrinted: refreeze.tariqPrinted,
    },
  });
}

/** Closes the requests among `ids` still open, their copies' keys cleared (R-404, Q14 (a)). */
export async function closeOpen(tx: Client, ids: readonly string[]): Promise<void> {
  await tx.ijazahRequest.updateMany({
    where: { id: { in: [...ids] }, status: { in: [...OPEN] } },
    data: { status: 'closed', signatureStorageKey: null },
  });
}

// 005:T032 (FR-629; R-403; SC-604; the note under T032): the two ports reach an ijazah not yet
// signed off. Each write is conditional on the row being unsigned, unrevoked and not deleted, read
// under the ijazah's lock, which the service takes after the requests' (the kernel row's order); a
// signed-off or revoked ijazah is never written (SC-604). Each written row's generation is raised by
// one and its rendering cleared, so the job of the generation before writes nothing (R-402).

/** An ijazah re-frozen: its id and its new generation, the one the job is enqueued for. */
export interface RerenderedIjazah {
  readonly id: string;
  readonly generation: number;
}

/** The unsigned, unrevoked ijazahs of the teacher's subject (the approved credential's, rule 23). */
export async function unsignedIjazahsOfCredential(
  tx: Client,
  teacherUserId: string,
  subjectId: string,
): Promise<readonly string[]> {
  const rows = await tx.ijazah.findMany({
    where: { teacherUserId, subjectId, signedOffAt: null, revokedAt: null, deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** The student's unsigned, unrevoked ijazahs. */
export async function unsignedIjazahsOfStudent(
  tx: Client,
  studentUserId: string,
): Promise<readonly string[]> {
  const rows = await tx.ijazah.findMany({
    where: { studentUserId, signedOffAt: null, revokedAt: null, deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** Re-freezes the chain, the teacher's name, riwaya and tariq of those among `ids` still unsigned. */
export function refreezeIjazahs(
  tx: Client,
  ids: readonly string[],
  refreeze: RequestRefreeze,
): Promise<readonly RerenderedIjazah[]> {
  return rerenderedWith(tx, ids, {
    chainSnapshot: chainJson(refreeze.chainSnapshot),
    teacherNamePrinted: refreeze.teacherNamePrinted,
    riwayaPrinted: refreeze.riwayaPrinted,
    tariqPrinted: refreeze.tariqPrinted,
  });
}

/** Re-freezes the student's printed name of those among `ids` still unsigned. */
export function renameIjazahs(
  tx: Client,
  ids: readonly string[],
  studentNamePrinted: string,
): Promise<readonly RerenderedIjazah[]> {
  return rerenderedWith(tx, ids, { studentNamePrinted });
}

/** The rows among `ids` still unsigned and unrevoked, read under their locks, written and re-rendered. */
async function rerenderedWith(
  tx: Client,
  ids: readonly string[],
  data: Prisma.IjazahUpdateManyMutationInput,
): Promise<readonly RerenderedIjazah[]> {
  const unsigned = { signedOffAt: null, revokedAt: null, deletedAt: null } as const;
  const rows = await tx.ijazah.findMany({
    where: { id: { in: [...ids] }, ...unsigned },
    orderBy: { id: 'asc' },
    select: { id: true, renderGeneration: true },
  });
  if (rows.length === 0) return [];
  await tx.ijazah.updateMany({
    where: { id: { in: rows.map(({ id }) => id) }, ...unsigned },
    data: { ...data, renderGeneration: { increment: 1 }, renderedAt: null },
  });
  return rows.map(({ id, renderGeneration }) => ({ id, generation: renderGeneration + 1 }));
}

/** The chain as its `jsonb` column holds it: generations, each an array of names. */
function chainJson(chain: readonly (readonly string[])[]): Prisma.InputJsonValue {
  return chain.map((names) => [...names]);
}

/**
 * 005:T031 (FR-630; R-414; DEC-72; the note under T031, research.md:264-265): how many of the
 * teacher's requests are undecided: `awaiting_student_name` or `pending`, and `approved` ones whose
 * ijazah is neither signed off nor revoked (a soft-deleted ijazah left out, R-DB-3: a to-one relation
 * takes no filter of its own). Identity's `OpenIjazahRequests` port, bound by `main.ts`; asked on the
 * deletion's transaction after the teacher's `users` lock, which every path adding such a request
 * takes first (the send, the approval), so no lock of its own. One statement over
 * `ijazah_requests_teacher_user_id_idx`.
 */
export function openRequestCountOfTeacher(tx: Client, teacherUserId: string): Promise<number> {
  return tx.ijazahRequest.count({
    where: {
      teacherUserId,
      OR: [
        { status: { in: [...OPEN] } },
        {
          status: 'approved',
          ijazah: { is: { signedOffAt: null, revokedAt: null, deletedAt: null } },
        },
      ],
    },
  });
}
