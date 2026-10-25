// T062: the application review's store held in memory, for `application-review.service.spec.ts`.
// It keeps the database's rules (a decision moves only the state it names, approval only with the
// call recorded), so the service's own rules are what the spec proves; the real queries are probed
// in `tests/db-integrity/application-review.spec.ts`.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type {
  ApplicantDetail,
  ApplicantStatus,
  ApplicantsFilter,
  ApplicationReviewStore,
  ApplicationDecision,
  CallRecord,
  CredentialOfApplicant,
  OpenIdentityRequest,
} from '../application-review.service.js';

export const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
export const SUBMITTED = new Date('2026-10-18T09:00:00Z');
export const HAFS = { id: '0199d0a0-0000-7000-8000-000000000051', nameAr: 'حفص', nameEn: 'Hafs' };
export const WARSH = { id: '0199d0a0-0000-7000-8000-000000000052', nameAr: 'ورش', nameEn: 'Warsh' };

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

type Status = CredentialOfApplicant['status'];

interface Held extends ApplicantDetail {
  approvedBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export class MemoryReviewStore implements ApplicationReviewStore {
  readonly #applicants = new Map<string, Held>();
  readonly #credentials: CredentialOfApplicant[] = [];
  readonly #requests = new Map<string, OpenIdentityRequest>();
  readonly granted: { userId: string; subjectIds: readonly string[] }[] = [];

  /** An application in `status`, sent with a credential per subject in `credentials`; its user id. */
  plant(
    values: {
      status?: ApplicantStatus;
      displayName?: string;
      email?: string;
      dateOfBirth?: Date;
      submittedAt?: Date;
      callRecorded?: boolean;
      accountStatus?: ApplicantDetail['accountStatus'];
      credentials?: readonly { subject: typeof HAFS; status: Status }[];
    } = {},
  ): string {
    const userId = randomUUID();
    const submittedAt = values.submittedAt ?? SUBMITTED;
    this.#applicants.set(userId, {
      userId,
      displayName: values.displayName ?? 'عمر فاروق',
      email: values.email ?? `${userId}@example.invalid`,
      gender: 'male',
      dateOfBirth: values.dateOfBirth ?? new Date('1990-04-12T00:00:00Z'),
      submittedAt,
      status: values.status ?? 'in_review',
      callCompletedOn: values.callRecorded === true ? new Date('2026-10-20T00:00:00Z') : null,
      qualificationSummary: 'إجازة في حفص',
      timezone: 'Africa/Cairo',
      accountStatus: values.accountStatus ?? 'active',
      identityDocumentId: randomUUID(),
      identityDocumentType: 'national_id',
      callOutcome: values.callRecorded === true ? 'suitable' : null,
      callNotes: values.callRecorded === true ? 'تحقّقت من الهوية' : null,
      note: null,
      approvedBy: null,
      decidedBy: null,
      decidedAt: null,
    });
    for (const credential of values.credentials ?? [{ subject: HAFS, status: 'approved' }]) {
      this.#credentials.push({
        credentialId: randomUUID(),
        teacherUserId: userId,
        subject: credential.subject,
        status: credential.status,
        documentId: randomUUID(),
        submittedWithApplication: true,
        createdAt: submittedAt,
      });
    }
    return userId;
  }

  /** A credential of the applicant that is not the current application's: added, or an older one. */
  plantOther(userId: string, status: Status, submittedWithApplication: boolean): void {
    this.#credentials.push({
      credentialId: randomUUID(),
      teacherUserId: userId,
      subject: WARSH,
      status,
      documentId: randomUUID(),
      submittedWithApplication,
      createdAt: new Date('2026-09-01T09:00:00Z'),
    });
  }

  openRequest(userId: string, request: Omit<OpenIdentityRequest, 'requestId'>): string {
    const requestId = randomUUID();
    this.#requests.set(userId, { requestId, ...request });
    return requestId;
  }

  held(userId: string): Held {
    const applicant = this.#applicants.get(userId);
    if (applicant === undefined) throw new Error(`no applicant ${userId}`);
    return applicant;
  }

  #matching(filter: ApplicantsFilter): Held[] {
    const statuses: Record<ApplicantsFilter['tab'], readonly ApplicantStatus[]> = {
      in_review: ['in_review'],
      waiting: ['needs_document'],
      decided: ['rejected', 'banned', 'approved'],
    };
    const search = filter.search?.toLowerCase();
    return [...this.#applicants.values()]
      .filter(
        (row) =>
          statuses[filter.tab].includes(row.status) &&
          (search === undefined ||
            row.displayName.toLowerCase().includes(search) ||
            row.email.toLowerCase().includes(search)),
      )
      .sort((a, b) => a.submittedAt.toISOString().localeCompare(b.submittedAt.toISOString()));
  }

  async page(_tx: Transaction, filter: ApplicantsFilter, skip: number, take: number) {
    return this.#matching(filter).slice(skip, skip + take);
  }

  async count(_tx: Transaction, filter: ApplicantsFilter): Promise<number> {
    return this.#matching(filter).length;
  }

  async read(_tx: Transaction, userId: string): Promise<ApplicantDetail | null> {
    return this.#applicants.get(userId) ?? null;
  }

  async credentialsOf(
    _tx: Transaction,
    userIds: readonly string[],
  ): Promise<CredentialOfApplicant[]> {
    return this.#credentials.filter((credential) => userIds.includes(credential.teacherUserId));
  }

  async documentUploadedAt(_tx: Transaction, _documentId: string): Promise<Date | null> {
    return SUBMITTED;
  }

  async openRequestOf(_tx: Transaction, userId: string): Promise<OpenIdentityRequest | null> {
    return this.#requests.get(userId) ?? null;
  }

  async recordCall(_tx: Transaction, userId: string, call: CallRecord): Promise<boolean> {
    const applicant = this.#applicants.get(userId);
    if (applicant === undefined) return false;
    if (applicant.status !== 'in_review' && applicant.status !== 'needs_document') return false;
    Object.assign(applicant, {
      callCompletedOn: call.completedOn,
      callOutcome: call.outcome,
      callNotes: call.notes,
    });
    return true;
  }

  async decide(_tx: Transaction, userId: string, decision: ApplicationDecision): Promise<boolean> {
    const applicant = this.#applicants.get(userId);
    if (applicant === undefined) return false;
    const from: Record<ApplicationDecision['kind'], readonly ApplicantStatus[]> = {
      approve: ['in_review'],
      reject: ['in_review', 'needs_document'],
      request_info: ['in_review'],
    };
    if (!from[decision.kind].includes(applicant.status)) return false;
    if (decision.kind === 'approve' && applicant.callCompletedOn === null) return false;
    const to: Record<ApplicationDecision['kind'], ApplicantStatus> = {
      approve: 'approved',
      reject: 'rejected',
      request_info: 'needs_document',
    };
    Object.assign(applicant, {
      status: to[decision.kind],
      note: decision.note,
      decidedBy: decision.adminId,
      decidedAt: decision.at,
      ...(decision.kind === 'approve' ? { approvedBy: decision.adminId } : {}),
    });
    return true;
  }

  async grantSubjects(
    _tx: Transaction,
    userId: string,
    subjectIds: readonly string[],
  ): Promise<void> {
    this.granted.push({ userId, subjectIds: [...subjectIds] });
  }
}
