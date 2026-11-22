// T018 (FR-311, FR-312, FR-314, R-218): the catalog module's `packages` rows as the teacher's own
// packages read and write them, and whether a subject is one of the teacher's `teacher_subjects`.
// Queries only, each on the caller's transaction; the service takes its locks first (T005's rule
// 1). Every read and write of a package names its teacher beside its id, so another teacher's
// package id reads nothing and writes nothing (PR #109's review, M3). The one exception is T032's
// `bookablePackageOf`, the booking sheet's read by the id a student names, reached through the
// entry; read-only, no lock.
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
import { lockRows } from '../../platform/db/row-lock.js';

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
  /**
   * 006:T002 (R-503, DEC-110): a programme package; false on every other one, an ijazah-track
   * package made before the programme included, which the switch keeps from being reactivated.
   */
  readonly isProgramme: boolean;
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
  readonly isProgramme: boolean;
}): PackageRow {
  return {
    id: row.id,
    subject: row.subject,
    track: row.track,
    sessionCount: row.sessionCount,
    sessionDurationMinutes: sessionLengthMinutes.parse(row.sessionDurationMinutes),
    price_piasters: piasters(Number(row.pricePiasters)),
    isActive: row.isActive,
    isProgramme: row.isProgramme,
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
      isProgramme: true,
    },
  });
  return rows.map(rowOf);
}

/** The teacher's packages, oldest first. */
export function packagesOf(tx: Client, teacherUserId: string): Promise<PackageRow[]> {
  return readPackages(tx, teacherUserId);
}

/**
 * The teacher of the package of that id, active or not; null for an unknown id (T037: a hold names
 * its package, and `checkout.current` reads it with its teacher).
 */
export async function packageOwnerOf(tx: Client, packageId: string): Promise<string | null> {
  const row = await tx.package.findUnique({
    where: { id: packageId },
    select: { teacherUserId: true },
  });
  return row?.teacherUserId ?? null;
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

/** 003:T113: which packages the average-price hint reads. */
export interface PeerPackagesQuery {
  /** The teacher asking, whose own packages are left out. */
  readonly viewer: string;
  readonly track: PackageTrack;
  readonly sessionDurationMinutes: SessionLengthMinutes;
}

/** 003:T113: one package of the pool, its teacher and its price over its count. */
export interface PeerPackageRow {
  readonly teacherUserId: string;
  readonly price_piasters: Piasters;
  readonly sessionCount: number;
}

/**
 * 003:T113 (SRS DEC-88): the other teachers' active packages on the track and length; the service
 * keeps those whose teacher the visibility predicate shows. Read-only, no lock.
 */
export async function peerPackagesOf(
  tx: Client,
  query: PeerPackagesQuery,
): Promise<PeerPackageRow[]> {
  const rows = await tx.package.findMany({
    where: {
      isActive: true,
      track: query.track,
      sessionDurationMinutes: query.sessionDurationMinutes,
      teacherUserId: { not: query.viewer },
    },
    select: { teacherUserId: true, pricePiasters: true, sessionCount: true },
  });
  return rows.map(({ teacherUserId, pricePiasters, sessionCount }) => ({
    teacherUserId,
    price_piasters: piasters(Number(pricePiasters)),
    sessionCount,
  }));
}

/** An active package's teacher and terms, as the booking sheet reads them (T032). */
export interface BookablePackage {
  readonly id: string;
  readonly teacherUserId: string;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: SessionLengthMinutes;
}

/**
 * The active package `packageId` with its teacher, or null for an unknown or inactive one (T032,
 * FR-350). The one read of a package by its id alone: a student names a package, never its
 * teacher, so booking asks identity's predicate of the teacher this answers before it reads, or
 * answers, anything else (R-GENDER-2, R-201).
 */
export async function bookablePackageOf(
  tx: Client,
  packageId: string,
): Promise<BookablePackage | null> {
  const row = await tx.package.findFirst({
    where: { id: packageId, isActive: true },
    select: { id: true, teacherUserId: true, sessionCount: true, sessionDurationMinutes: true },
  });
  return row === null
    ? null
    : { ...row, sessionDurationMinutes: sessionLengthMinutes.parse(row.sessionDurationMinutes) };
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

// 006:T002 (SRS DEC-110; the note under T002, Q-3 (a)(a)): the programme's switch turned on, on the
// setting change's transaction. An old-style ijazah-track package is one made before the programme,
// `is_programme = false` (ERD section 15 rule 73).
const PRE_PROGRAMME_IJAZAH = { track: 'ijazah_track', isProgramme: false } as const;

/**
 * The teachers of every old-style ijazah-track package, active or not, ascending: the accounts the
 * turn-on locks. Bounded by the teachers who hold one when the switch is turned on, once.
 */
export async function preProgrammeIjazahOwners(tx: Client): Promise<string[]> {
  const rows = await tx.package.findMany({
    where: PRE_PROGRAMME_IJAZAH,
    distinct: ['teacherUserId'],
    orderBy: { teacherUserId: 'asc' },
    select: { teacherUserId: true },
  });
  return rows.map(({ teacherUserId }) => teacherUserId);
}

/** Locks the accounts' `users` rows FOR UPDATE, in id order, in one statement (T005's rule 2). */
export function lockPackageOwners(tx: Transaction, userIds: readonly string[]): Promise<void> {
  return lockRows(tx, 'users', userIds);
}

/** Deactivates every active old-style ijazah-track package in one update; how many it did. */
export async function deactivatePreProgrammeIjazah(tx: Client): Promise<number> {
  const { count } = await tx.package.updateMany({
    where: { ...PRE_PROGRAMME_IJAZAH, isActive: true },
    data: { isActive: false },
  });
  return count;
}
