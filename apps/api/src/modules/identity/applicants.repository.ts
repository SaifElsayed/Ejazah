// T068: the applications queue as the administrator reads it (FR-160), over this module's
// `teacher_profiles` and `users`: the three tabs (in review, waiting on the applicant, decided),
// oldest submission first, searched by the applicant's name or email as typed, in any case, `%` and
// `_` as themselves (`like-literal.ts`); a soft-deleted person is left out of every read (R-DB-3).
// It returns rows built here, never a teacher's profile type, and serves no student-facing path
// (R-GENDER-5). Each query runs on the administrator kind's transaction it is handed.
import { likeLiteral } from '../../platform/db/like-literal.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'teacherProfile'>;

export type ApplicantsTab = 'in_review' | 'waiting' | 'decided';

export type ApplicantStatus = 'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';

export interface ApplicantsFilter {
  readonly tab: ApplicantsTab;
  readonly search?: string | undefined;
}

/** An application as the queue lists it. */
export interface ApplicantRow {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly gender: 'male' | 'female';
  /** A `date` column, read as its midnight UTC. */
  readonly dateOfBirth: Date | null;
  readonly submittedAt: Date;
  readonly status: ApplicantStatus;
  readonly callCompletedOn: Date | null;
}

/** An application as its detail reads it. */
export interface ApplicantDetail extends ApplicantRow {
  readonly qualificationSummary: string;
  readonly timezone: string;
  readonly identityDocumentId: string | null;
  readonly identityDocumentType: 'national_id' | 'passport' | null;
  readonly callOutcome: 'suitable' | 'unsuitable' | null;
  readonly callNotes: string | null;
  readonly note: string | null;
}

const TAB_STATUSES: Readonly<Record<ApplicantsTab, readonly ApplicantStatus[]>> = {
  in_review: ['in_review'],
  waiting: ['needs_document'],
  decided: ['rejected', 'banned', 'approved'],
};

/** One page of the tab, oldest submission first. */
export async function applicantsPage(
  tx: Client,
  filter: ApplicantsFilter,
  skip: number,
  take: number,
): Promise<ApplicantRow[]> {
  const rows = await tx.teacherProfile.findMany({
    where: {
      applicationStatus: { in: [...TAB_STATUSES[filter.tab]] },
      applicationSubmittedAt: { not: null },
      user: { deletedAt: null, ...searchOf(filter.search) },
    },
    orderBy: [{ applicationSubmittedAt: 'asc' }, { id: 'asc' }],
    skip,
    take,
    select: {
      userId: true,
      applicationSubmittedAt: true,
      applicationStatus: true,
      verificationCallCompletedOn: true,
      user: { select: { displayName: true, email: true, gender: true, dateOfBirth: true } },
    },
  });
  return rows.map(rowOf);
}

/** How many applications the tab and the search admit. */
export function applicantsCount(tx: Client, filter: ApplicantsFilter): Promise<number> {
  return tx.teacherProfile.count({
    where: {
      applicationStatus: { in: [...TAB_STATUSES[filter.tab]] },
      applicationSubmittedAt: { not: null },
      user: { deletedAt: null, ...searchOf(filter.search) },
    },
  });
}

/** One submitted application with what its detail shows; null when there is none. */
export async function readApplicant(tx: Client, userId: string): Promise<ApplicantDetail | null> {
  const row = await tx.teacherProfile.findFirst({
    where: { userId, applicationSubmittedAt: { not: null }, user: { deletedAt: null } },
    select: {
      userId: true,
      applicationSubmittedAt: true,
      applicationStatus: true,
      verificationCallCompletedOn: true,
      verificationCallOutcome: true,
      verificationCallNotes: true,
      applicationNote: true,
      qualificationSummary: true,
      identityDocumentId: true,
      identityDocumentType: true,
      user: {
        select: {
          displayName: true,
          email: true,
          gender: true,
          dateOfBirth: true,
          timezone: true,
        },
      },
    },
  });
  if (row === null) return null;
  return {
    ...rowOf(row),
    qualificationSummary: row.qualificationSummary,
    timezone: row.user.timezone,
    identityDocumentId: row.identityDocumentId,
    identityDocumentType: row.identityDocumentType,
    callOutcome: row.verificationCallOutcome,
    callNotes: row.verificationCallNotes,
    note: row.applicationNote,
  };
}

function searchOf(search: string | undefined) {
  if (search === undefined) return {};
  const contains = { contains: likeLiteral(search), mode: 'insensitive' as const };
  return { OR: [{ displayName: contains }, { email: contains }] };
}

function rowOf(row: {
  readonly userId: string;
  readonly applicationSubmittedAt: Date | null;
  readonly applicationStatus: ApplicantStatus | null;
  readonly verificationCallCompletedOn: Date | null;
  readonly user: {
    readonly displayName: string | null;
    readonly email: string | null;
    readonly gender: 'male' | 'female';
    readonly dateOfBirth: Date | null;
  };
}): ApplicantRow {
  return {
    userId: row.userId,
    // Null only on a deleted row (rule 32), which every read here leaves out.
    displayName: row.user.displayName ?? '',
    email: row.user.email ?? '',
    gender: row.user.gender,
    dateOfBirth: row.user.dateOfBirth,
    // Every read here requires a submission, and a submitted application has a status.
    submittedAt: row.applicationSubmittedAt as Date,
    status: row.applicationStatus as ApplicantStatus,
    callCompletedOn: row.verificationCallCompletedOn,
  };
}
