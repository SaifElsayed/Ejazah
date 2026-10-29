// T056: the application's columns of `teacher_profiles` (data-model §3: the application is a state
// of the profile, not a table), as the verification module reaches them through this module's entry
// (R-121). Queries only, each on the transaction it is handed; `identity.service.ts` holds the rules.
// T065 adds the admin home's applications card, counted on the administrator kind's transaction.
//
// A write is conditional on the state it moves from, decided by the database: the first application
// creates the profile (the unique `user_id` refuses a second one written meanwhile), a reapplication
// moves `rejected`, a resubmission `needs_document`, and the approved screen is marked once. So two
// requests racing from one state cannot both move it.
import { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';

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
   * record and approved screen belong to the earlier application and are cleared (the audit log
   * keeps them), so a reapproval shows `ApplicationApproved` again. Whether it wrote.
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
      verificationCallNotes: null,
      approvedShownAt: null,
      identityDocumentId: application.identityDocumentId,
      identityDocumentType: application.identityDocumentType,
    };
    const { count } = await this.#tx.teacherProfile.updateMany({
      where: { userId, applicationStatus: application.from },
      data,
    });
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

/** The verification call as the reviewer records it (FR-161): its day, its outcome, the notes. */
export interface CallRecord {
  /** A `date` column's value (`dateColumnOf`). */
  readonly completedOn: Date;
  readonly outcome: 'suitable' | 'unsuitable';
  readonly notes: string;
}

/**
 * Records the call on an open application (`in_review` or `needs_document`); a later record replaces
 * it. Whether it wrote (T068).
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
