// T018 (FR-311, FR-312, FR-314, R-218): the catalog module's `packages` rows as the teacher's own
// packages read and write them, and whether a subject is one of the teacher's `teacher_subjects`.
// Queries only, each on the caller's transaction; the service takes its locks first (T005's rule
// 1). Every read and write of a package names its teacher beside its id, so another teacher's
// package id reads nothing and writes nothing (PR #109's review, M3). The one exception is T032's
// `bookablePackageOf`, the booking sheet's read by the id a student names, reached through the
// entry; read-only, no lock.
//
// The price columns are `bigint`; they enter and leave this file as `Piasters` through
// `packages/money` (R-MONEY-1), and the length as the contract's `30 | 45 | 60`, which the database
// holds too (ERD §15 rule 36).
//
// 006:T004 (R-503, FR-704; data-model.md «packages»): a package has one of two shapes, which the
// database checks (ERD section 15 rule 73): a count, a length and a total, `is_programme` false (a
// recitation package, or an ijazah-track one made while `programme_enabled` was off); or a
// programme package, `ijazah_track`, its three session prices set and the old three NULL. Every read
// here branches on `is_programme`, never on the track alone, and a row of neither shape is refused,
// never answered.
import {
  type PackageTrack,
  SESSION_LENGTHS_MINUTES,
  type SessionLengthMinutes,
  sessionLengthMinutes,
  type SubjectSummary,
} from '@ijazah/contracts';
import { piasters, type Piasters, toPlainNumber } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'package'>;

/**
 * 006:T004 (R-503, FR-704; contracts `programmePrices`): a programme package's session price for
 * each length, whole piasters above zero (ERD section 15 rule 74).
 */
export interface ProgrammePriceRow {
  readonly m30_piasters: Piasters;
  readonly m45_piasters: Piasters;
  readonly m60_piasters: Piasters;
}

/**
 * The terms of a package with a count, a length and a total: a recitation package, or an
 * ijazah-track one made while `programme_enabled` was off (006:T004, K-3: unchanged).
 */
export interface FixedTerms {
  readonly track: PackageTrack;
  /**
   * 006:T002 (R-503, DEC-110): false on every package but a programme one, an ijazah-track package
   * made before the programme included, which the switch keeps from being reactivated.
   */
  readonly isProgramme: false;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: SessionLengthMinutes;
  readonly price_piasters: Piasters;
}

/**
 * 006:T004 (R-503): a programme package's terms, an `ijazah_track` one made while the switch is on:
 * its three session prices; its count, length and total come at the offer (R-506).
 */
export interface ProgrammeTerms {
  readonly track: 'ijazah_track';
  readonly isProgramme: true;
  readonly prices: ProgrammePriceRow;
}

/** One of the teacher's packages with its subject's two names, by shape (006:T004). */
export type PackageRow = {
  readonly id: string;
  readonly subject: SubjectSummary;
  readonly isActive: boolean;
} & (FixedTerms | ProgrammeTerms);

/** A package to write: the teacher's, on a subject the service checked is theirs. */
export type NewPackageRow = {
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly isActive: boolean;
} & (FixedTerms | ProgrammeTerms);

/**
 * The fields an edit changes; the subject never changes (contracts `packagesUpdateInput`). 006:T004:
 * `prices` on a programme package; `isProgramme` with them turns a package into a programme one,
 * today's three columns NULL (the service decides when, R-503).
 */
export interface PackageChange {
  readonly track?: PackageTrack;
  readonly sessionCount?: number;
  readonly sessionDurationMinutes?: SessionLengthMinutes;
  readonly price_piasters?: Piasters;
  readonly prices?: ProgrammePriceRow;
  readonly isProgramme?: true;
  readonly isActive?: boolean;
}

interface PriceColumns {
  readonly price30Piasters: bigint | null;
  readonly price45Piasters: bigint | null;
  readonly price60Piasters: bigint | null;
}

interface TermsColumns extends PriceColumns {
  readonly track: PackageTrack;
  readonly isProgramme: boolean;
  readonly sessionCount: number | null;
  readonly sessionDurationMinutes: number | null;
  readonly pricePiasters: bigint | null;
}

/** A row the database's shape check (ERD section 15 rule 73) would have refused. */
function shapeBroken(): never {
  throw new Error('packages: a row breaks the programme shape check (ERD section 15 rule 73)');
}

function amountOf(column: bigint | null): Piasters {
  return column === null ? shapeBroken() : piasters(Number(column));
}

/** The prices of a programme package's row (006:T004). */
function pricesOf(columns: PriceColumns): ProgrammePriceRow {
  return {
    m30_piasters: amountOf(columns.price30Piasters),
    m45_piasters: amountOf(columns.price45Piasters),
    m60_piasters: amountOf(columns.price60Piasters),
  };
}

/** The package's terms by shape; a row of neither shape is refused, never answered (006:T004). */
function termsOf(columns: TermsColumns): FixedTerms | ProgrammeTerms {
  if (columns.isProgramme) {
    if (columns.track !== 'ijazah_track') return shapeBroken();
    return { track: columns.track, isProgramme: true, prices: pricesOf(columns) };
  }
  if (columns.sessionCount === null) return shapeBroken();
  return {
    track: columns.track,
    isProgramme: false,
    sessionCount: columns.sessionCount,
    sessionDurationMinutes: sessionLengthMinutes.parse(columns.sessionDurationMinutes),
    price_piasters: amountOf(columns.pricePiasters),
  };
}

/** The columns a programme package's three prices are written to (006:T004). */
function priceColumnsOf(prices: ProgrammePriceRow): {
  readonly price30Piasters: bigint;
  readonly price45Piasters: bigint;
  readonly price60Piasters: bigint;
} {
  return {
    price30Piasters: BigInt(toPlainNumber(prices.m30_piasters)),
    price45Piasters: BigInt(toPlainNumber(prices.m45_piasters)),
    price60Piasters: BigInt(toPlainNumber(prices.m60_piasters)),
  };
}

/** Today's three columns of a programme package: NULL (rule 73). */
const NO_FIXED_TERMS = { sessionCount: null, sessionDurationMinutes: null, pricePiasters: null };

function rowOf({
  id,
  subject,
  isActive,
  ...columns
}: TermsColumns & {
  readonly id: string;
  readonly subject: SubjectSummary;
  readonly isActive: boolean;
}): PackageRow {
  return { id, subject, isActive, ...termsOf(columns) };
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
      isActive: true,
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

/**
 * 003:T113: one package of the pool and its teacher: a package with a count, its price over its
 * count; 006:T004 (DEC-88 as amended, FR-704a): a programme package, its price for the asked length,
 * a price per session already (no count).
 */
export type PeerPackageRow =
  | {
      readonly teacherUserId: string;
      readonly isProgramme: false;
      readonly price_piasters: Piasters;
      readonly sessionCount: number;
    }
  | {
      readonly teacherUserId: string;
      readonly isProgramme: true;
      readonly sessionPrice_piasters: Piasters;
    };

/** The contract's three lengths, 30, 45 and 60 minutes (FR-PROFILE-2 as amended). */
const [SHORTEST, MIDDLE] = SESSION_LENGTHS_MINUTES;

/** 006:T004: a programme package's price for a length (R-503). */
export function priceForLength(prices: ProgrammePriceRow, minutes: SessionLengthMinutes): Piasters {
  if (minutes === SHORTEST) return prices.m30_piasters;
  return minutes === MIDDLE ? prices.m45_piasters : prices.m60_piasters;
}

/**
 * 003:T113 (SRS DEC-88): the other teachers' active packages on the track and length; the service
 * keeps those whose teacher the visibility predicate shows. 006:T004: a package with a count of that
 * length, and every programme package (on `ijazah_track` only, rule 73), by its price of that
 * length. Read-only, no lock.
 */
export async function peerPackagesOf(
  tx: Client,
  query: PeerPackagesQuery,
): Promise<PeerPackageRow[]> {
  const rows = await tx.package.findMany({
    where: {
      isActive: true,
      track: query.track,
      teacherUserId: { not: query.viewer },
      OR: [
        { isProgramme: false, sessionDurationMinutes: query.sessionDurationMinutes },
        { isProgramme: true },
      ],
    },
    select: {
      teacherUserId: true,
      isProgramme: true,
      sessionCount: true,
      pricePiasters: true,
      price30Piasters: true,
      price45Piasters: true,
      price60Piasters: true,
    },
  });
  return rows.map((row): PeerPackageRow => {
    if (row.isProgramme) {
      return {
        teacherUserId: row.teacherUserId,
        isProgramme: true,
        sessionPrice_piasters: priceForLength(pricesOf(row), query.sessionDurationMinutes),
      };
    }
    if (row.sessionCount === null) return shapeBroken();
    return {
      teacherUserId: row.teacherUserId,
      isProgramme: false,
      price_piasters: amountOf(row.pricePiasters),
      sessionCount: row.sessionCount,
    };
  });
}

/** An active package with a count and a length, as the booking sheet reads it (T032). */
export interface FixedBookablePackage {
  readonly id: string;
  readonly teacherUserId: string;
  readonly isProgramme: false;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: SessionLengthMinutes;
}

/**
 * 006:T004 (R-503): an active programme package as the booking sheet reads it: its three prices; its
 * assessment's length is §3.14's `assessment_duration_minutes` (T005).
 */
export interface ProgrammeBookablePackage {
  readonly id: string;
  readonly teacherUserId: string;
  readonly isProgramme: true;
  readonly prices: ProgrammePriceRow;
}

/** An active package's teacher and terms (T032); 006:T004: by shape, on `isProgramme`. */
export type BookablePackage = FixedBookablePackage | ProgrammeBookablePackage;

/**
 * The active package `packageId` with its teacher, or null for an unknown or inactive one (T032,
 * FR-350). The one read of a package by its id alone: a student names a package, never its
 * teacher, so booking asks identity's predicate of the teacher this answers before it reads, or
 * answers, anything else (R-GENDER-2, R-201). 006:T004: a programme package is answered whatever
 * the switch and the assessment's price say; whether it may be booked now is the caller's to ask
 * (`programmeAvailabilityOf`, Q-5 (a)).
 */
export async function bookablePackageOf(
  tx: Client,
  packageId: string,
): Promise<BookablePackage | null> {
  const row = await tx.package.findFirst({
    where: { id: packageId, isActive: true },
    select: {
      id: true,
      teacherUserId: true,
      isProgramme: true,
      sessionCount: true,
      sessionDurationMinutes: true,
      price30Piasters: true,
      price45Piasters: true,
      price60Piasters: true,
    },
  });
  if (row === null) return null;
  const { id, teacherUserId } = row;
  if (row.isProgramme) return { id, teacherUserId, isProgramme: true, prices: pricesOf(row) };
  if (row.sessionCount === null) return shapeBroken();
  return {
    id,
    teacherUserId,
    isProgramme: false,
    sessionCount: row.sessionCount,
    sessionDurationMinutes: sessionLengthMinutes.parse(row.sessionDurationMinutes),
  };
}

/** The columns a new package's terms are written to, by shape (006:T004). */
function termColumnsOf(terms: FixedTerms | ProgrammeTerms) {
  if (terms.isProgramme) {
    return {
      track: terms.track,
      isProgramme: true,
      ...NO_FIXED_TERMS,
      ...priceColumnsOf(terms.prices),
    };
  }
  return {
    track: terms.track,
    isProgramme: false,
    sessionCount: terms.sessionCount,
    sessionDurationMinutes: terms.sessionDurationMinutes,
    pricePiasters: BigInt(toPlainNumber(terms.price_piasters)),
  };
}

/** Writes the package and answers it as read back. */
export async function insertPackage(tx: Client, row: NewPackageRow): Promise<PackageRow> {
  const { teacherUserId, subjectId, isActive } = row;
  const { id } = await tx.package.create({
    data: { teacherUserId, subjectId, isActive, ...termColumnsOf(row) },
    select: { id: true },
  });
  const [written] = await readPackages(tx, teacherUserId, id);
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
  const { price_piasters, prices, isProgramme, ...rest } = change;
  const { count } = await tx.package.updateMany({
    where: { id: packageId, teacherUserId },
    data: {
      ...rest,
      ...(price_piasters === undefined
        ? {}
        : { pricePiasters: BigInt(toPlainNumber(price_piasters)) }),
      ...(isProgramme === undefined ? {} : { isProgramme, ...NO_FIXED_TERMS }),
      ...(prices === undefined ? {} : priceColumnsOf(prices)),
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
