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
        verificationCallCompletedAt: true,
        approvedShownAt: true,
      },
    });
    if (row === null) return null;
    return {
      status: row.applicationStatus,
      submittedAt: row.applicationSubmittedAt,
      note: row.applicationNote,
      decidedAt: row.applicationDecidedAt,
      callRecorded: row.verificationCallCompletedAt !== null,
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
      verificationCallCompletedAt: null,
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
  const [open, waitingOnApplicant] = await Promise.all([
    tx.teacherProfile.aggregate({
      where: { applicationStatus: 'in_review' },
      _count: { _all: true },
      _min: { applicationSubmittedAt: true },
    }),
    tx.teacherProfile.count({ where: { applicationStatus: 'needs_document' } }),
  ]);
  return {
    open: open._count._all,
    oldestSubmittedAt: open._min.applicationSubmittedAt,
    waitingOnApplicant,
  };
}
