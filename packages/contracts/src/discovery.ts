// T024: the `discovery` namespace of the user surface (specs/003-booking/contracts/app-surface.md
// "`discovery` — booking's router over catalog's service"; FR-330 to FR-338, R-204, R-205).
//
// `browse` is the subject tabs, the cards and the search (a `query` on the same procedure, R-204);
// `filters` the riwayas a subject's filter offers; `teacher` the profile. Every input names what is
// asked for and never who asks: the requester's gender is the session's (R-GENDER-4, R-GENDER-6).
// The cursor is opaque: the server writes the last card's rating, review count, name and id into it
// and alone reads it back (R-204); the client hands it back unread. Money crosses as `_piasters`
// integers computed by `packages/money` (R-MONEY-1, FR-337); the nearest slot is a UTC instant with
// its zone (R-TIME-6). No output carries a riwaya, a tariq or a chain (FR-335, FR-336).
import { z } from 'zod';

import { subjectSummary } from './catalog.js';
import { gender, timeZone } from './onboarding.js';
import {
  MAX_SESSION_COUNT,
  packagePricePiasters,
  packageTrack,
  programmePrices,
  sessionLengthMinutes,
} from './packages.js';

/** The longest name search, in characters, as the admin console's search (`adminSearch`). */
export const DISCOVERY_QUERY_MAX_LENGTH = 100;

/** The longest riwaya the filter takes: the bound a credential's riwaya is transcribed under. */
export const RIWAYA_FILTER_MAX_LENGTH = 200;

/** The longest cursor: the four keys with an 80-character name, encoded, fit with room. */
export const DISCOVERY_CURSOR_MAX_LENGTH = 1024;

/**
 * Where the last page was cut, as the server wrote it (R-204). Branded so that only a `nextCursor`
 * the server answered types as one; its encoding and its check are the server's.
 */
export const discoveryCursor = z
  .string()
  .min(1)
  .max(DISCOVERY_CURSOR_MAX_LENGTH)
  .brand<'DiscoveryCursor'>();

/** A teacher's aggregate rating, 1 to 5; absent while the teacher has no review. */
const rating = z.number().min(1).max(5);

const reviewCount = z.int().nonnegative();

/** `packages/money`'s `perSession`; rounding may give zero, as on the teacher's own list. */
const perSessionPiasters = z.int().nonnegative();

export const discoveryBrowseInput = z.object({
  /** The subject tab; absent for the tab of all subjects. */
  subjectId: z.uuid().optional(),
  /** A prefix of the name or a subject's name, folded by the server (FR-333, R-203). */
  query: z.string().trim().min(1).max(DISCOVERY_QUERY_MAX_LENGTH).optional(),
  track: packageTrack.optional(),
  /** At least this many whole stars; absent for all (FR-334). */
  minRating: z.int().min(1).max(5).optional(),
  /** One of `discovery.filters`' values, as typed (FR-334). */
  riwaya: z.string().trim().min(1).max(RIWAYA_FILTER_MAX_LENGTH).optional(),
  cursor: discoveryCursor.optional(),
});

/**
 * A subject tab and its count, counted after the predicate (FR-332, R-GENDER-3). The tab of all
 * subjects has no subject, so no subject's names: its label is the phone's.
 */
export const discoveryTab = z.union([
  z.object({ subjectId: z.null(), count: z.int().nonnegative() }),
  z.object({
    subjectId: z.uuid(),
    nameAr: z.string().min(1),
    nameEn: z.string().min(1),
    count: z.int().nonnegative(),
  }),
]);

/** One result card (FR-335). */
export const discoveryCard = z.object({
  teacherId: z.uuid(),
  displayName: z.string(),
  /** The matched prefix of `displayName`, in its characters, for the phone to mark (FR-333). */
  match: z.object({ length: z.int().positive() }).optional(),
  /**
   * Deprecated, never sent: a card carries no photo (FR-335), the photo is on the teacher's page
   * only (FR-336), by the owner's decision of 2026-11-02. It stays published until the contract gate removes
   * a deprecated field (R-API-9, T075).
   */
  photoUrl: z.string().optional(),
  subjects: z.array(subjectSummary),
  /** The tracks of the teacher's active packages. */
  tracks: z.array(packageTrack),
  bioExcerpt: z.string(),
  rating: rating.optional(),
  reviewCount,
  /** The first session the student would get on the teacher's nearest offerable slot (R-205). */
  nearestSlot: z.object({ startsAt: z.iso.datetime(), timezone: timeZone }).optional(),
  /** The lowest price per session of the teacher's active packages. */
  lowestPerSession_piasters: perSessionPiasters,
});

/** `discovery.browse`'s answer: the tabs on the first page only, and a cursor while more remain. */
export const discoveryBrowseOutput = z.object({
  tabs: z.array(discoveryTab).optional(),
  cards: z.array(discoveryCard),
  nextCursor: discoveryCursor.optional(),
});

/** The subject whose riwaya filter is asked for (FR-334). */
export const discoveryFiltersInput = z.object({ subjectId: z.uuid() });

/** The riwayas of approved credentials of visible teachers in the subject; empty hides the filter. */
export const discoveryFiltersOutput = z.object({ riwayas: z.array(z.string()) });

export const discoveryTeacherInput = z.object({ teacherId: z.uuid() });

/**
 * One of the teacher's active packages with a count, a length and a total, on the profile; the
 * remedy line is the phone's, by track. 006:T003 (K-3): unchanged and non-null; `isProgramme` is
 * absent or false on it.
 */
export const discoveryFixedPackage = z.object({
  packageId: z.uuid(),
  subject: subjectSummary,
  track: packageTrack,
  /** 006:T003 (Q-4 (a)): the union's discriminant; an answer may leave it out on this member. */
  isProgramme: z.literal(false).exactOptional(),
  sessionCount: z.int().min(1).max(MAX_SESSION_COUNT),
  sessionDurationMinutes: sessionLengthMinutes,
  price_piasters: packagePricePiasters,
  perSession_piasters: perSessionPiasters,
});

/**
 * 006:T003 (ADR 0024, FR-701, FR-704; R-503): an active programme package on the profile, shown
 * only while `programme_enabled` is on and the assessment's price is above zero (Q-5 (a)): its three
 * session prices, their lowest and highest, and the assessment's price (the §3.14 setting
 * `assessment_price_piasters`; app-surface.md's `assessmentFee`), read at the request.
 */
export const discoveryProgrammePackage = z.object({
  packageId: z.uuid(),
  subject: subjectSummary,
  track: z.literal('ijazah_track'),
  isProgramme: z.literal(true),
  prices: programmePrices,
  priceRange: z.object({
    lowest_piasters: packagePricePiasters,
    highest_piasters: packagePricePiasters,
  }),
  assessmentPrice_piasters: packagePricePiasters,
});

/**
 * One of the teacher's active packages on the profile. 006:T003 (R-503, K-3, Q-4 (a)): a union on
 * `isProgramme`, today's package unchanged beside the programme's.
 */
export const discoveryTeacherPackage = z.discriminatedUnion('isProgramme', [
  discoveryFixedPackage,
  discoveryProgrammePackage,
]);

/** `discovery.teacher`'s answer (FR-336): no riwaya, tariq or chain, which are Phase 4's. */
export const discoveryTeacherOutput = z.object({
  teacherId: z.uuid(),
  displayName: z.string(),
  gender,
  /** A signed, expiring link to the profile photo, when one is set. */
  photoUrl: z.string().optional(),
  bio: z.string(),
  qualificationSummary: z.string(),
  /** The subjects with an approved credential. */
  subjects: z.array(subjectSummary),
  rating: rating.optional(),
  reviewCount,
  packages: z.array(discoveryTeacherPackage),
});

export type DiscoveryCursor = z.infer<typeof discoveryCursor>;
export type DiscoveryBrowseInput = z.infer<typeof discoveryBrowseInput>;
export type DiscoveryTab = z.infer<typeof discoveryTab>;
export type DiscoveryCard = z.infer<typeof discoveryCard>;
export type DiscoveryBrowseOutput = z.infer<typeof discoveryBrowseOutput>;
export type DiscoveryFiltersInput = z.infer<typeof discoveryFiltersInput>;
export type DiscoveryFiltersOutput = z.infer<typeof discoveryFiltersOutput>;
export type DiscoveryTeacherInput = z.infer<typeof discoveryTeacherInput>;
export type DiscoveryTeacherPackage = z.infer<typeof discoveryTeacherPackage>;
export type DiscoveryFixedPackage = z.infer<typeof discoveryFixedPackage>;
export type DiscoveryProgrammePackage = z.infer<typeof discoveryProgrammePackage>;
export type DiscoveryTeacherOutput = z.infer<typeof discoveryTeacherOutput>;
