// T018 (FR-311, FR-312, FR-314, R-218): the catalog module's `packages` rows as the teacher's own
// packages read and write them, and whether a subject is one of the teacher's `teacher_subjects`.
// Queries only, each on the caller's transaction; the service takes its locks first (T005's rule
// 1). Every read and write of a package names its teacher beside its id, so another teacher's
// package id reads nothing and writes nothing (PR #109's review, M3).
//
// The price column is `bigint`; it enters and leaves this file as `Piasters` through
// `packages/money` (R-MONEY-1), and the length as the contract's `30 | 45 | 60`, which the database
// holds too (ERD §15 rule 36).
import {
  type PackageTrack,
  type SessionLengthMinutes,
  sessionLengthMinutes,
  type SubjectSummary,
} from '@ijazah/contracts';
import { piasters, type Piasters, toPlainNumber } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'package'>;

/** One of the teacher's packages with its subject's two names. */
export interface PackageRow {
  readonly id: string;
  readonly subject: SubjectSummary;
  readonly track: PackageTrack;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: SessionLengthMinutes;
  readonly price_piasters: Piasters;
  readonly isActive: boolean;
}

/** A package to write: the teacher's, on a subject the service checked is theirs. */
export interface NewPackageRow {
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly track: PackageTrack;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: SessionLengthMinutes;
  readonly price_piasters: Piasters;
  readonly isActive: boolean;
}

/** The fields an edit changes; the subject never changes (contracts `packagesUpdateInput`). */
export interface PackageChange {
  readonly track?: PackageTrack;
  readonly sessionCount?: number;
  readonly sessionDurationMinutes?: SessionLengthMinutes;
  readonly price_piasters?: Piasters;
  readonly isActive?: boolean;
}

function rowOf(row: {
  readonly id: string;
  readonly subject: SubjectSummary;
  readonly track: PackageTrack;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: number;
  readonly pricePiasters: bigint;
  readonly isActive: boolean;
}): PackageRow {
  return {
    id: row.id,
    subject: row.subject,
    track: row.track,
    sessionCount: row.sessionCount,
    sessionDurationMinutes: sessionLengthMinutes.parse(row.sessionDurationMinutes),
    price_piasters: piasters(Number(row.pricePiasters)),
    isActive: row.isActive,
  };
}

/** Whether the subject is one of the teacher's `teacher_subjects` (FR-311, FR-PROFILE-11). */
export async function holdsSubject(
  tx: Pick<Transaction, 'teacherSubject'>,
  teacherUserId: string,
  subjectId: string,
): Promise<boolean> {
  const held = await tx.teacherSubject.findUnique({
    where: { teacherUserId_subjectId: { teacherUserId, subjectId } },
    select: { id: true },
  });
  return held !== null;
}

/** The teacher's packages, of `packageId` only when named, oldest first (the id is a UUID v7). */
async function readPackages(
  tx: Client,
  teacherUserId: string,
  packageId?: string,
): Promise<PackageRow[]> {
  const rows = await tx.package.findMany({
    where: { teacherUserId, ...(packageId === undefined ? {} : { id: packageId }) },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      // Subjects are never deleted: the table has no `deleted_at`.
      subject: { select: { id: true, nameAr: true, nameEn: true } },
      track: true,
      sessionCount: true,
      sessionDurationMinutes: true,
      pricePiasters: true,
      isActive: true,
    },
  });
  return rows.map(rowOf);
}

/** The teacher's packages, oldest first. */
export function packagesOf(tx: Client, teacherUserId: string): Promise<PackageRow[]> {
  return readPackages(tx, teacherUserId);
}

/** The teacher's package of that id; null for an unknown id and for another teacher's. */
export async function packageOf(
  tx: Client,
  teacherUserId: string,
  packageId: string,
): Promise<PackageRow | null> {
  const [row] = await readPackages(tx, teacherUserId, packageId);
  return row ?? null;
}

/** Writes the package and answers it as read back. */
export async function insertPackage(tx: Client, row: NewPackageRow): Promise<PackageRow> {
  const { price_piasters, ...rest } = row;
  const { id } = await tx.package.create({
    data: { ...rest, pricePiasters: BigInt(toPlainNumber(price_piasters)) },
    select: { id: true },
  });
  const [written] = await readPackages(tx, row.teacherUserId, id);
  if (written === undefined) throw new Error('packages: the package written is not there to read');
  return written;
}

/** Changes the teacher's package; whether it did (false for another teacher's id). */
export async function changePackage(
  tx: Client,
  teacherUserId: string,
  packageId: string,
  change: PackageChange,
): Promise<boolean> {
  const { price_piasters, ...rest } = change;
  const { count } = await tx.package.updateMany({
    where: { id: packageId, teacherUserId },
    data: {
      ...rest,
      ...(price_piasters === undefined
        ? {}
        : { pricePiasters: BigInt(toPlainNumber(price_piasters)) }),
    },
  });
  return count === 1;
}
