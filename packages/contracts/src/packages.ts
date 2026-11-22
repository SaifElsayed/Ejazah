// T016: the `teacher.packages` namespace of the user surface (specs/003-booking/contracts/
// app-surface.md "`teacher.packages` — catalog"; FR-311 to FR-315).
//
// A package is a subject among the teacher's approved ones, a track, a session count of one to 52
// (the owner's decision of 2026-11-02), a session length of 30, 45 or 60 minutes and a total price in whole piasters of more than
// zero (FR-PROFILE-2 as amended 2026-10-31; ERD §15 rule 36, which the database enforces too).
// Money crosses the wire as `_piasters` integers; formatting is the client's (R-MONEY-1, R-212).
// `create` is keyed, so it carries the kernel's idempotency key. The list answers whether the
// teacher's packages are `published` (the payout state, FR-315); each package answers whether it is
// `frozen`, its track and length fixed by an enrollment (FR-312).
import { z } from 'zod';

import { subjectSummary } from './catalog.js';
import { idempotencyKey } from './idempotency-key.js';

/** The lengths a session and a slot may have, in minutes (FR-PROFILE-2, FR-PROFILE-4 as amended). */
export const SESSION_LENGTHS_MINUTES = [30, 45, 60] as const;

export const sessionLengthMinutes = z.literal(SESSION_LENGTHS_MINUTES);

/** ERD `package_track` (ADR 0018 D1). */
export const packageTrack = z.enum(['recitation', 'ijazah_track']);

/** A package's total price, whole piasters, more than zero (FR-311). */
export const packagePricePiasters = z.int().positive();

/**
 * The most sessions a package may have (the owner's decision of 2026-11-02): the confirmation
 * generates every session of the enrollment in one transaction (FR-BOOK-4), so the count is bounded.
 */
export const MAX_SESSION_COUNT = 52;

const sessionCount = z.int().min(1).max(MAX_SESSION_COUNT);

/**
 * One of the teacher's packages with a count, a length and a total: a recitation package, or an
 * ijazah-track one created while `programme_enabled` was off. 006:T003 (K-3): unchanged and
 * non-null; `isProgramme` is absent or false on it.
 */
export const teacherFixedPackage = z.object({
  id: z.uuid(),
  subject: subjectSummary,
  track: packageTrack,
  /** 006:T003 (Q-4 (a)): the union's discriminant; an answer may leave it out on this member. */
  isProgramme: z.literal(false).exactOptional(),
  sessionCount,
  sessionDurationMinutes: sessionLengthMinutes,
  price_piasters: packagePricePiasters,
  /** `packages/money`'s `perSession` of the price over the count (R-212); rounding may give zero. */
  perSession_piasters: z.int().nonnegative(),
  isActive: z.boolean(),
  activeEnrollmentCount: z.int().nonnegative(),
  frozen: z.boolean(),
});

/**
 * 006:T003 (ADR 0024, R-503, FR-704): a programme package's session price for each length, whole
 * piasters above zero (ERD section 15 rules 73 and 74). Its count, length and total come at the
 * offer (R-506).
 */
export const programmePrices = z.object({
  m30_piasters: packagePricePiasters,
  m45_piasters: packagePricePiasters,
  m60_piasters: packagePricePiasters,
});

/**
 * 006:T003 (R-503, K-3): a programme package, an `ijazah_track` one created while
 * `programme_enabled` is on: its three prices, and no count, length or total.
 */
export const teacherProgrammePackage = z.object({
  id: z.uuid(),
  subject: subjectSummary,
  track: z.literal('ijazah_track'),
  isProgramme: z.literal(true),
  prices: programmePrices,
  isActive: z.boolean(),
  activeEnrollmentCount: z.int().nonnegative(),
  frozen: z.boolean(),
});

/**
 * One of the teacher's packages: `list`'s item, and `create`'s and `update`'s answer. 006:T003
 * (R-503, K-3, Q-4 (a)): a union on `isProgramme`, today's package unchanged beside the programme's.
 */
export const teacherPackage = z.discriminatedUnion('isProgramme', [
  teacherFixedPackage,
  teacherProgrammePackage,
]);

/** `teacher.packages.list`'s answer. */
export const packagesListOutput = z.object({
  published: z.boolean(),
  packages: z.array(teacherPackage),
});

const packageCreateTerms = z.object({
  subjectId: z.uuid(),
  track: packageTrack,
  /** Set on today's package; absent on a programme package (006:T003). */
  sessionCount: sessionCount.optional(),
  sessionDurationMinutes: sessionLengthMinutes.optional(),
  price_piasters: packagePricePiasters.optional(),
  /** 006:T003 (R-503): a programme package's three prices, on `ijazah_track` only. */
  prices: programmePrices.optional(),
  isActive: z.boolean(),
  idempotencyKey,
});

/**
 * 006:T003 (R-503, FR-704): a package has its count, length and price, or, on `ijazah_track`, a
 * programme package's three prices and none of the three. Which one the switch allows is the
 * service's (`programme_enabled`, T004); a mixed shape is refused here.
 */
function hasOneShape(terms: z.infer<typeof packageCreateTerms>): boolean {
  const fixed = [terms.sessionCount, terms.sessionDurationMinutes, terms.price_piasters];
  if (terms.prices === undefined) return fixed.every((value) => value !== undefined);
  return terms.track === 'ijazah_track' && fixed.every((value) => value === undefined);
}

export const packagesCreateInput = packageCreateTerms.refine(hasOneShape, {
  message: 'A package has its count, length and price, or a programme package its three prices.',
});

/**
 * 006:T003 (FR-701, SRS DEC-110, the owner's Q-3 (a)(a); lane b's T002): `teacher.packages.update`
 * refuses reactivating an old-style ijazah-track package while `programme_enabled` is on, a
 * `CONFLICT` with this code on `isActive`; turning the switch off reactivates none.
 */
export const packageReactivationRefusal = z.enum(['programme_switch_on']);

/** The subject never changes; the service refuses track and length on a frozen package. */
export const packagesUpdateInput = z.object({
  packageId: z.uuid(),
  sessionCount: sessionCount.optional(),
  track: packageTrack.optional(),
  sessionDurationMinutes: sessionLengthMinutes.optional(),
  price_piasters: packagePricePiasters.optional(),
  /** 006:T003 (R-503): a programme package's three prices; the service refuses them on any other. */
  prices: programmePrices.optional(),
  isActive: z.boolean().optional(),
});

export type SessionLengthMinutes = z.infer<typeof sessionLengthMinutes>;
export type PackageTrack = z.infer<typeof packageTrack>;
export type TeacherPackage = z.infer<typeof teacherPackage>;
export type TeacherFixedPackage = z.infer<typeof teacherFixedPackage>;
export type TeacherProgrammePackage = z.infer<typeof teacherProgrammePackage>;
export type ProgrammePrices = z.infer<typeof programmePrices>;
export type PackageReactivationRefusal = z.infer<typeof packageReactivationRefusal>;
export type PackagesListOutput = z.infer<typeof packagesListOutput>;
export type PackagesCreateInput = z.infer<typeof packagesCreateInput>;
export type PackagesUpdateInput = z.infer<typeof packagesUpdateInput>;

// 003:T113 (SRS DEC-88, FR-PROFILE-2 as amended): the package editor's average-price hint.

/**
 * `teacher.packages.averagePrice`'s input: the track and the session length the editor has chosen.
 * Strict: an input that also names a gender or a teacher is refused, never quietly read (Q-T113-adv).
 */
export const packagesAveragePriceInput = z
  .object({
    track: packageTrack,
    sessionDurationMinutes: sessionLengthMinutes,
  })
  .strict();

/**
 * Its answer: the average price per session of the other teachers' published packages on that
 * track and length, absent when fewer than three such teachers have one. It names no teacher.
 */
export const packagesAveragePriceOutput = z.object({
  averagePerSession_piasters: z.int().nonnegative().optional(),
});

/**
 * The setting `price_average_min_teachers` (SRS §3.14, DEC-88; Q-T113-k): the fewest other teachers
 * the average is shown over, a whole number from 2 to 100 (seed 3): at least 2, so no single teacher's
 * price is shown (the reviewer's bound, DEC-88).
 */
export const priceAverageMinTeachers = z.int().min(2).max(100);

export type PackagesAveragePriceInput = z.infer<typeof packagesAveragePriceInput>;
export type PackagesAveragePriceOutput = z.infer<typeof packagesAveragePriceOutput>;
