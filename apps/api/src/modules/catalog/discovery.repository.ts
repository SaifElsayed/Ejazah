// T025 (FR-332 to FR-335, research R-204 as amended 2026-11-01, analysis C2): this module's rows as
// discovery reads them. Queries only, each on the caller's transaction, and no lock: discovery
// decides nothing and writes nothing (T005's rule 1). No query here names a teacher's rating,
// review count or name, which are identity's columns: identity orders and cuts the page, and the
// only order written here is on this module's own columns.
//
// The candidate reads are bounded by the teachers with an active package, one indexed read at the
// launch cohort's size, as the visible set is (R-201); they answer ids and catalog values only, so
// nothing here returns a teacher's data, and every id is filtered by identity's predicate before
// anything of it is answered (R-GENDER-5). The profile's packages (T027) are read only for a teacher
// the predicate has already answered.
//
// 006:T004 (R-503, R-516; Q-5 (a)): every package read here says whether it is a programme package
// and reads its terms by shape (`packageTermsOf`); whether a programme package is shown is the
// service's to decide (the switch and the assessment's price), so nothing here reads a setting.
import type { PackageTrack, SubjectSummary } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { type FixedTerms, packageTermsOf, type ProgrammeTerms } from './packages.repository.js';

/**
 * One teacher's active packages on one subject and track, once however many there are; 006:T004:
 * apart by whether they are programme packages.
 */
export interface Offering {
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly track: PackageTrack;
  readonly isProgramme: boolean;
}

/** An approved credential's riwaya, as transcribed (ADR 0021 D1). */
export interface RiwayaRow {
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly riwaya: string;
}

/** One of a card's subjects: a `teacher_subjects` row of an active subject. */
export interface CardSubject {
  readonly teacherUserId: string;
  readonly subject: SubjectSummary;
}

/**
 * One of a card's active packages, what its track badge and its price per session need; 006:T004:
 * by shape, a programme package's three prices.
 */
export type CardPackage = { readonly teacherUserId: string } & (FixedTerms | ProgrammeTerms);

/** Each teacher, subject and track of an active package, of `subjectId` only when named. */
export async function activeOfferings(
  tx: Pick<Transaction, 'package'>,
  subjectId?: string,
): Promise<Offering[]> {
  const groups = await tx.package.groupBy({
    by: ['teacherUserId', 'subjectId', 'track', 'isProgramme'],
    where: { isActive: true, ...(subjectId === undefined ? {} : { subjectId }) },
  });
  return groups.map(({ teacherUserId, subjectId: subject, track, isProgramme }) => ({
    teacherUserId,
    subjectId: subject,
    track,
    isProgramme,
  }));
}

/** The riwaya of every approved credential that has one, of `subjectId` only when named. */
export async function approvedRiwayas(
  tx: Pick<Transaction, 'teacherCredential'>,
  subjectId?: string,
): Promise<RiwayaRow[]> {
  const rows = await tx.teacherCredential.findMany({
    where: {
      status: 'approved',
      riwaya: { not: null },
      ...(subjectId === undefined ? {} : { subjectId }),
    },
    select: { teacherUserId: true, subjectId: true, riwaya: true },
  });
  return rows.flatMap(({ teacherUserId, subjectId: subject, riwaya }): RiwayaRow[] =>
    riwaya === null || riwaya.trim() === '' ? [] : [{ teacherUserId, subjectId: subject, riwaya }],
  );
}

/** The active subjects of each of `teacherIds`, in the order the subjects were created. */
export async function cardSubjects(
  tx: Pick<Transaction, 'teacherSubject'>,
  teacherIds: readonly string[],
): Promise<CardSubject[]> {
  if (teacherIds.length === 0) return [];
  const rows = await tx.teacherSubject.findMany({
    where: { teacherUserId: { in: [...teacherIds] }, subject: { isActive: true } },
    orderBy: [{ subject: { createdAt: 'asc' } }, { subjectId: 'asc' }],
    select: {
      teacherUserId: true,
      subject: { select: { id: true, nameAr: true, nameEn: true } },
    },
  });
  return rows.map(({ teacherUserId, subject }) => ({ teacherUserId, subject }));
}

/** The active packages of each of `teacherIds`: track and terms, by shape (006:T004). */
export async function cardPackages(
  tx: Pick<Transaction, 'package'>,
  teacherIds: readonly string[],
): Promise<CardPackage[]> {
  if (teacherIds.length === 0) return [];
  const rows = await tx.package.findMany({
    where: { teacherUserId: { in: [...teacherIds] }, isActive: true },
    select: {
      teacherUserId: true,
      track: true,
      isProgramme: true,
      sessionCount: true,
      sessionDurationMinutes: true,
      pricePiasters: true,
      price30Piasters: true,
      price45Piasters: true,
      price60Piasters: true,
    },
  });
  return rows.map(({ teacherUserId, ...columns }) => ({
    teacherUserId,
    ...packageTermsOf(columns),
  }));
}

/**
 * One of a profile's active packages (T027, FR-336): what the profile shows of it; 006:T004: by
 * shape, a programme package's three prices.
 */
export type ProfilePackage = { readonly id: string; readonly subject: SubjectSummary } & (
  FixedTerms | ProgrammeTerms
);

/** The teacher's active packages, oldest first (the id is a UUID v7), as the teacher's own list. */
export async function profilePackages(
  tx: Pick<Transaction, 'package'>,
  teacherId: string,
): Promise<ProfilePackage[]> {
  const rows = await tx.package.findMany({
    where: { teacherUserId: teacherId, isActive: true },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      // Subjects are never deleted: the table has no `deleted_at`.
      subject: { select: { id: true, nameAr: true, nameEn: true } },
      track: true,
      isProgramme: true,
      sessionCount: true,
      sessionDurationMinutes: true,
      pricePiasters: true,
      price30Piasters: true,
      price45Piasters: true,
      price60Piasters: true,
    },
  });
  return rows.map(({ id, subject, ...columns }) => ({ id, subject, ...packageTermsOf(columns) }));
}
