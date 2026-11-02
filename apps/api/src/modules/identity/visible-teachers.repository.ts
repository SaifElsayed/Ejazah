// T010: the visibility predicate, implemented once (SRS §3.7.1 as amended 2026-10-31, `002:T143`;
// research R-201, R-204; R-GENDER-5). A teacher is visible to a requester on a student-facing path
// when the five conjuncts hold: the requester's gender, an approved application, a live account, a
// verified payout account, and an account neither suspended nor banned; booking asks an active
// account as well, so a verification-required teacher stays visible and cannot be booked
// (FR-VERIFY-10). The conjuncts read only this module's `users` and `teacher_profiles`, so the
// predicate lives here, and every module learns which teachers a student may see through this
// module's `index.ts` and nothing else; catalog then filters its own tables by the ids it gets.
//
// Every method that answers teachers takes the requester's gender as `RequesterGender`, which only
// the request context mints (`require-requester-gender`). `isBookablePair` serves the confirm job,
// which has no request: it reads the student's own gender and standing in the caller's transaction
// and answers a boolean, so no `RequesterGender` is minted outside the request context (Phase 0
// `contracts/lint-rules.md`, "Callers with no requester gender"). Both build their filter from one
// clause function, unexported, which takes the plain gender (PR #109's review, round 4, follow-ups
// 1 and 2).
//
// The discovery page is ordered by `average_rating DESC NULLS LAST`, `review_count DESC`,
// `display_name ASC`, then the teacher's id `ASC`, and cut by a keyset over the same four values
// whose NULL branch is written out: a teacher with no review has a NULL rating, which comes after
// every rated one (R-204, the owner's decisions of 2026-11-01). The name prefix is matched by the
// kernel's folded query, on the candidates only, so the match never widens the page; a search also
// keeps the candidates catalog matched by a subject's name (T070), the predicate applied to them all.
import type { Prisma } from '@prisma/client';

import { idsWithFoldedNamePrefix } from '../../platform/db/folded-name.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Gender, RequesterGender } from '../../platform/guards/requester-gender.js';

type Client = Pick<Transaction, 'user'>;

/** `discover`: search, browse and a profile; `book`: a hold, a slot, a confirmation (T143). */
export type VisibilityPurpose = 'discover' | 'book';

/** A visible teacher's public fields (R-201): nothing of the account, the documents or the payout. */
export interface VisibleTeacher {
  readonly id: string;
  readonly displayName: string;
  readonly gender: Gender;
  readonly photoKey: string | null;
  readonly bio: string;
  readonly qualificationSummary: string;
  /** `numeric(3,2)` as text; null for a teacher with no review. */
  readonly averageRating: string | null;
  readonly reviewCount: number;
}

/** Where a page was cut: the last row's four order keys (R-204). */
export type TeacherPageCursor = Pick<
  VisibleTeacher,
  'averageRating' | 'reviewCount' | 'displayName' | 'id'
>;

/** One page of discovery over the ids catalog's own tables allow (R-204, analysis C2). */
export interface TeacherPageQuery {
  readonly candidateIds: readonly string[];
  /** What the student typed; matched as a prefix of the folded name, never as a pattern. */
  readonly namePrefix?: string;
  /**
   * With `namePrefix`: the candidates the query matched by what catalog holds, a subject's name
   * (T070, FR-333), kept whether or not the name has the prefix. An id outside `candidateIds` is
   * ignored, and every id still passes the predicate. Without `namePrefix` it is ignored.
   */
  readonly alsoMatched?: readonly string[];
  /** The rating filter: at least this; a teacher with no review is left out. */
  readonly minRating?: number;
  readonly after?: TeacherPageCursor;
  readonly limit: number;
}

/**
 * SRS §3.7.1's five conjuncts over `users` and its `teacher_profiles` row, and for `book` the
 * active account (T143). The only place the predicate is written.
 */
function teacherClause(gender: Gender, purpose: VisibilityPurpose): Prisma.UserWhereInput {
  return {
    gender,
    deletedAt: null,
    accountStatus: purpose === 'book' ? 'active' : { notIn: ['suspended', 'banned'] },
    teacherProfile: { is: { verificationStatus: 'approved', payoutVerifiedAt: { not: null } } },
  };
}

/** The rows after `cursor` in the page's order, the NULL rating's branch written out (R-204). */
function afterCursor(cursor: TeacherPageCursor): Prisma.UserWhereInput {
  const { averageRating, reviewCount, displayName, id } = cursor;
  const sameName = { displayName, id: { gt: id } };
  if (averageRating === null) {
    return {
      teacherProfile: { is: { averageRating: null } },
      OR: [
        { teacherProfile: { is: { reviewCount: { lt: reviewCount } } } },
        { teacherProfile: { is: { reviewCount } }, displayName: { gt: displayName } },
        { teacherProfile: { is: { reviewCount } }, ...sameName },
      ],
    };
  }
  return {
    OR: [
      { teacherProfile: { is: { averageRating: { lt: averageRating } } } },
      { teacherProfile: { is: { averageRating, reviewCount: { lt: reviewCount } } } },
      { teacherProfile: { is: { averageRating, reviewCount } }, displayName: { gt: displayName } },
      { teacherProfile: { is: { averageRating, reviewCount } }, ...sameName },
      { teacherProfile: { is: { averageRating: null } } },
    ],
  };
}

/**
 * The public fields of the users `where` admits, in `orderBy`'s order, at most `take`. `where`
 * always carries the clause, so a teacher is never read without it.
 */
async function readVisible(
  tx: Client,
  where: Prisma.UserWhereInput,
  orderBy: Prisma.UserOrderByWithRelationInput[],
  take: number,
): Promise<VisibleTeacher[]> {
  const rows = await tx.user.findMany({
    where,
    orderBy,
    take,
    select: {
      id: true,
      displayName: true,
      gender: true,
      photoKey: true,
      teacherProfile: {
        select: { bio: true, qualificationSummary: true, averageRating: true, reviewCount: true },
      },
    },
  });
  return rows.flatMap(({ teacherProfile: profile, ...row }): VisibleTeacher[] =>
    profile === null
      ? []
      : [
          {
            id: row.id,
            // A live account keeps its name (ERD §15 rule 32), and the clause reads live ones only.
            displayName: row.displayName ?? '',
            gender: row.gender,
            photoKey: row.photoKey,
            bio: profile.bio,
            qualificationSummary: profile.qualificationSummary,
            averageRating: profile.averageRating === null ? null : profile.averageRating.toString(),
            reviewCount: profile.reviewCount,
          },
        ],
  );
}

/**
 * Whether the teacher is published: the predicate's answer for this teacher as a student of the
 * requester's gender would get it for discovery (FR-315). A teacher asks it of themselves with the
 * session's gender; `teacher.profile.get` and `teacher.packages.list` both answer `published` from
 * it, so the two cannot drift (T017, T018; the owner's decision of 2026-11-02).
 */
export async function isPublishedTeacher(
  tx: Client,
  requester: RequesterGender,
  teacherUserId: string,
): Promise<boolean> {
  const visible = await visibleTeachers(tx, requester, {
    purpose: 'discover',
    teacherIds: [teacherUserId],
  });
  return visible.length === 1;
}

/** The teachers among `teacherIds` visible to the requester for `purpose`, in id order. */
export async function visibleTeachers(
  tx: Client,
  requester: RequesterGender,
  query: { readonly purpose: VisibilityPurpose; readonly teacherIds: readonly string[] },
): Promise<VisibleTeacher[]> {
  if (query.teacherIds.length === 0) return [];
  return readVisible(
    tx,
    { id: { in: [...query.teacherIds] }, ...teacherClause(requester, query.purpose) },
    [{ id: 'asc' }],
    query.teacherIds.length,
  );
}

/**
 * The candidates a search keeps (FR-333): those whose folded name has the prefix, and those the
 * query matched otherwise among the candidates (T070); every candidate when nothing was typed.
 */
async function matchingCandidates(
  tx: Pick<Transaction, '$queryRaw'>,
  query: TeacherPageQuery,
): Promise<readonly string[]> {
  if (query.namePrefix === undefined) return query.candidateIds;
  const byName = await idsWithFoldedNamePrefix(tx, query.candidateIds, query.namePrefix);
  const candidates = new Set(query.candidateIds);
  const otherwise = (query.alsoMatched ?? []).filter((id) => candidates.has(id));
  return [...new Set([...byName, ...otherwise])];
}

/**
 * One page of the teachers among `candidateIds` visible to the requester for discovery, in R-204's
 * order, after `after` when it is given; at most `limit` rows.
 */
export async function visibleTeacherPage(
  tx: Pick<Transaction, 'user' | '$queryRaw'>,
  requester: RequesterGender,
  query: TeacherPageQuery,
): Promise<VisibleTeacher[]> {
  const ids = await matchingCandidates(tx, query);
  if (ids.length === 0) return [];
  const filters: Prisma.UserWhereInput[] = [teacherClause(requester, 'discover')];
  if (query.minRating !== undefined) {
    filters.push({ teacherProfile: { is: { averageRating: { gte: query.minRating } } } });
  }
  if (query.after !== undefined) filters.push(afterCursor(query.after));
  return readVisible(
    tx,
    { id: { in: [...ids] }, AND: filters },
    [
      { teacherProfile: { averageRating: { sort: 'desc', nulls: 'last' } } },
      { teacherProfile: { reviewCount: 'desc' } },
      { displayName: 'asc' },
      { id: 'asc' },
    ],
    query.limit,
  );
}

/**
 * Whether the student may book the teacher now, for the confirm job (R-215): the student live and
 * active, the teacher visible to the student's own gender by the `book` clause. No row is answered.
 */
export async function isBookablePair(
  tx: Client,
  studentUserId: string,
  teacherUserId: string,
): Promise<boolean> {
  const student = await tx.user.findFirst({
    where: { id: studentUserId, deletedAt: null, accountStatus: 'active' },
    select: { gender: true },
  });
  if (student === null) return false;
  const teachers = await tx.user.count({
    where: { id: teacherUserId, ...teacherClause(student.gender, 'book') },
  });
  return teachers === 1;
}
