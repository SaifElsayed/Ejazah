// T056: the application's columns of `teacher_profiles` (data-model §3: the application is a state
// of the profile, not a table), as the verification module reaches them through this module's entry
// (R-121). Queries only, each on the transaction it is handed; `identity.service.ts` holds the rules.
// T065 adds the admin home's applications card, counted on the administrator kind's transaction.
//
// A write is conditional on the state it moves from, decided by the database: the first application
// creates the profile (the unique `user_id` refuses a second one written meanwhile), a reapplication
// moves `rejected` of a teacher not banned (T142), a resubmission `needs_document`, and the approved screen is marked once. So two
// requests racing from one state cannot both move it.
import { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

const UNIQUE_VIOLATION = 'P2002';

type Client = Pick<Transaction, 'teacherProfile'>;

export type ApplicationStatus = 'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';

/** The application as the applicant's screens read it. */
export interface ApplicationRecord {
  /** Null before the first submission. */
  readonly status: ApplicationStatus | null;
  readonly submittedAt: Date | null;
  readonly note: string | null;
  /** The reviewer's latest action on the application (request info, reject, approve, ban). */
  readonly decidedAt: Date | null;
  /** Whether the verification call is recorded (FR-VERIFY-5). */
  readonly callRecorded: boolean;
  readonly approvedShownAt: Date | null;
}

/** An application opened: the first one, or a new one after a rejection (FR-155). */
export interface OpenedApplication {
  readonly from: null | 'rejected';
  readonly qualificationSummary: string;
  readonly identityDocumentId: string;
  readonly identityDocumentType: 'national_id' | 'passport';
  readonly submittedAt: Date;
}

export class ApplicationRepository {
  readonly #tx: Client;

  constructor(tx: Client) {
    this.#tx = tx;
  }

  async read(userId: string): Promise<ApplicationRecord | null> {
    const row = await this.#tx.teacherProfile.findUnique({
      where: { userId },
      select: {
        applicationStatus: true,
        applicationSubmittedAt: true,
        applicationNote: true,
        applicationDecidedAt: true,
        verificationCallCompletedOn: true,
        approvedShownAt: true,
      },
    });
    if (row === null) return null;
    return {
      status: row.applicationStatus,
      submittedAt: row.applicationSubmittedAt,
      note: row.applicationNote,
      decidedAt: row.applicationDecidedAt,
      callRecorded: row.verificationCallCompletedOn !== null,
      approvedShownAt: row.approvedShownAt,
    };
  }

  /**
   * Opens the application `in_review` from the state it names; the earlier decision, note, call
   * record and approved screen belong to the earlier application and are cleared (each decision's
   * note stays in the application's history, R1a 002:T174; the call's day and outcome in its audit
   * entry), so a reapproval shows `ApplicationApproved` again. The call's notes of a teacher once
   * approved (`approved_at` set) are left as written (R1b 002:T186, SRS DEC-97): the database
   * decides which, by the two writes' `approved_at` conditions, as `eraseAccount` does. Whether it
   * wrote.
   */
  async open(userId: string, application: OpenedApplication): Promise<boolean> {
    const data = {
      qualificationSummary: application.qualificationSummary,
      verificationStatus: 'pending' as const,
      applicationStatus: 'in_review' as const,
      applicationSubmittedAt: application.submittedAt,
      applicationNote: null,
      applicationDecidedAt: null,
      applicationDecidedByAdminId: null,
      verificationCallCompletedOn: null,
      verificationCallOutcome: null,
      approvedShownAt: null,
      identityDocumentId: application.identityDocumentId,
      identityDocumentType: application.identityDocumentType,
    };
    // A banned teacher never reapplies (T142): `teachers.ban` after a revocation leaves the
    // application `rejected` and writes only `verification_status`.
    const from = {
      userId,
      applicationStatus: application.from,
      verificationStatus: { not: 'banned' as const },
    };
    const { count: neverApproved } = await this.#tx.teacherProfile.updateMany({
      where: { ...from, approvedAt: null },
      data: { ...data, verificationCallNotes: null },
    });
    const count =
      neverApproved === 1
        ? 1
        : (
            await this.#tx.teacherProfile.updateMany({
              where: { ...from, approvedAt: { not: null } },
              data,
            })
          ).count;
    if (count === 1 || application.from !== null) return count === 1;
    // No profile yet: the first application writes it; one written meanwhile refuses this one.
    if ((await this.#tx.teacherProfile.count({ where: { userId } })) > 0) return false;
    try {
      await this.#tx.teacherProfile.create({
        data: { userId, bio: '', ...data },
        select: { id: true },
      });
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  }

  /** Returns the application from `needs_document` to the queue, with a new identity document if one is named. */
  async resubmit(userId: string, identityDocumentId: string | undefined): Promise<boolean> {
    const { count } = await this.#tx.teacherProfile.updateMany({
      where: { userId, applicationStatus: 'needs_document' },
      data: {
        applicationStatus: 'in_review',
        ...(identityDocumentId === undefined ? {} : { identityDocumentId }),
      },
    });
    return count === 1;
  }

  /** Marks the once-only approved screen shown, while the application is approved and it was not. */
  async markApprovedShown(userId: string, at: Date): Promise<boolean> {
    const { count } = await this.#tx.teacherProfile.updateMany({
      where: { userId, applicationStatus: 'approved', approvedShownAt: null },
      data: { approvedShownAt: at },
    });
    return count === 1;
  }
}

/**
 * The admin home's applications card (T065, FR-176): how many applications are in review and when
 * the oldest of them was submitted, and how many wait on the applicant for a document. Counts only:
 * no person leaves this module.
 */
export async function readApplicationQueue(tx: Client): Promise<{
  readonly open: number;
  readonly oldestSubmittedAt: Date | null;
  readonly waitingOnApplicant: number;
}> {
  // A deleted account's application is not in the applications list, so the card does not count
  // it (T121).
  const live = { user: { deletedAt: null } } as const;
  const [open, waitingOnApplicant] = await Promise.all([
    tx.teacherProfile.aggregate({
      where: { applicationStatus: 'in_review', ...live },
      _count: { _all: true },
      _min: { applicationSubmittedAt: true },
    }),
    tx.teacherProfile.count({ where: { applicationStatus: 'needs_document', ...live } }),
  ]);
  return {
    open: open._count._all,
    oldestSubmittedAt: open._min.applicationSubmittedAt,
    waitingOnApplicant,
  };
}

/**
 * Whether the teacher is approved (`verification_status`), for the credential review (T069): an
 * approved teacher's newly approved credential makes its subject theirs at once (FR-153).
 */
export async function isApprovedTeacher(tx: Client, userId: string): Promise<boolean> {
  const profile = await tx.teacherProfile.findUnique({
    where: { userId },
    select: { verificationStatus: true },
  });
  return profile?.verificationStatus === 'approved';
}

/**
 * R1a, 002:T176 (SRS §3.14, DEC-100, DEC-67; Q-3 (a); the owner's «موافق على الاتنين» of 2026-11-22,
 * Q-C1-1 (a)): a page of the live applicants never approved whose identity document is due, in
 * profile id order after `after`, read with no lock for verification's `erase-identity-documents`,
 * which reads each again under its locks (T077's `keptProfilesDue` is the precedent). `rejected`
 * decided at or before `rejectedBefore`; `banned` at or before `bannedBefore`, which the caller sets
 * from the later of the retention and `ban_restore_window_days`.
 */
export async function identityDocumentsDecidedBefore(
  tx: Client,
  cutoffs: { readonly rejectedBefore: Date; readonly bannedBefore: Date },
  after: string | undefined,
  limit: number,
): Promise<{ readonly profileId: string; readonly userId: string; readonly documentId: string }[]> {
  const rows = await tx.teacherProfile.findMany({
    where: {
      approvedAt: null,
      identityDocumentId: { not: null },
      user: { deletedAt: null },
      OR: [
        { applicationStatus: 'rejected', applicationDecidedAt: { lte: cutoffs.rejectedBefore } },
        { applicationStatus: 'banned', applicationDecidedAt: { lte: cutoffs.bannedBefore } },
      ],
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, userId: true, identityDocumentId: true },
  });
  return rows.flatMap(({ id, userId, identityDocumentId }) =>
    identityDocumentId === null ? [] : [{ profileId: id, userId, documentId: identityDocumentId }],
  );
}

/**
 * Locks the application's `teacher_profiles` row until the transaction ends (T126), so a decision's
 * read of the state it moves from is the state it then moves. A person with no profile has nothing
 * to lock; the move then refuses on its own read.
 */
export async function lockApplication(tx: Transaction, userId: string): Promise<void> {
  // The profile's id never changes, so reading it before the lock reads nothing the lock guards.
  const profile = await tx.teacherProfile.findUnique({ where: { userId }, select: { id: true } });
  if (profile !== null) await lockRows(tx, 'teacher_profiles', [profile.id]);
}

/** The verification call as the reviewer records it (FR-161): its day, its outcome, the notes. */
export interface CallRecord {
  /** A `date` column's value (`dateColumnOf`). */
  readonly completedOn: Date;
  readonly outcome: 'suitable' | 'unsuitable';
  readonly notes: string;
}

/** The call's notes on the profile, and whether its teacher was ever approved (`approved_at` set). */
export interface CallNotes {
  readonly everApproved: boolean;
  readonly notes: string | null;
}

/**
 * R1b (002:T186; SRS DEC-97): the call's notes a new record would replace, and whether the teacher
 * was ever approved, read on the caller's transaction under the application's lock it holds
 * (`lockApplication`); null for a person with no profile.
 */
export async function readCallNotes(tx: Client, userId: string): Promise<CallNotes | null> {
  const profile = await tx.teacherProfile.findUnique({
    where: { userId },
    select: { approvedAt: true, verificationCallNotes: true },
  });
  if (profile === null) return null;
  return { everApproved: profile.approvedAt !== null, notes: profile.verificationCallNotes };
}

/**
 * Records the call on an open application (`in_review` or `needs_document`); a later record replaces
 * it (an ever-approved teacher's earlier notes are first kept in the application's history by the
 * caller, R1b 002:T186). Whether it wrote (T068).
 */
export async function recordApplicationCall(
  tx: Client,
  userId: string,
  call: CallRecord,
): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId, applicationStatus: { in: ['in_review', 'needs_document'] } },
    data: {
      verificationCallCompletedOn: call.completedOn,
      verificationCallOutcome: call.outcome,
      verificationCallNotes: call.notes,
    },
  });
  return count === 1;
}

/**
 * A reviewer's decision on the application (T068, FR-161, FR-162), each from the state it moves:
 * `approve` an application in review whose call is recorded (approved, with who and when);
 * `reject` an open one (`in_review` or `needs_document`); `request_info` one in review, which then
 * waits on the applicant. Each writes the note the applicant sees and the decision's moment
 * (`application_decided_at`, which the status screen dates the note by). Whether it wrote.
 */
export async function decideApplication(
  tx: Client,
  userId: string,
  decision: {
    readonly kind: 'approve' | 'reject' | 'request_info';
    readonly adminId: string;
    readonly at: Date;
    readonly note: string | null;
  },
): Promise<boolean> {
  const decided = {
    applicationNote: decision.note,
    applicationDecidedAt: decision.at,
    applicationDecidedByAdminId: decision.adminId,
  };
  const { count } =
    decision.kind === 'approve'
      ? await tx.teacherProfile.updateMany({
          where: {
            userId,
            applicationStatus: 'in_review',
            verificationCallCompletedOn: { not: null },
          },
          data: {
            ...decided,
            verificationStatus: 'approved',
            applicationStatus: 'approved',
            approvedByAdminId: decision.adminId,
            approvedAt: decision.at,
          },
        })
      : decision.kind === 'reject'
        ? await tx.teacherProfile.updateMany({
            where: { userId, applicationStatus: { in: ['in_review', 'needs_document'] } },
            data: { ...decided, verificationStatus: 'rejected', applicationStatus: 'rejected' },
          })
        : await tx.teacherProfile.updateMany({
            where: { userId, applicationStatus: 'in_review' },
            data: { ...decided, applicationStatus: 'needs_document' },
          });
  return count === 1;
}
