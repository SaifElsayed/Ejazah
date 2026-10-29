// T068 (FR-160 to FR-162, FR-132, FR-166, ADR 0017 D5): the administrator's review of a teacher's
// application. The application is a state of identity's `teacher_profiles`, read and moved through
// identity's entry; its credentials are catalog's, read through catalog's entry; the identity
// document and an identity request are this module's own (R-121, R-API-6).
//
// The queue's three tabs (in review, waiting on the applicant, decided), oldest submission first,
// searched by the name or the email as typed; each row carries the current application's subjects
// (the credentials sent with it, which share the submission's instant), the minor flag computed on
// read (FR-132) and the call's day. The call is recorded by its day (owner's decision 2026-10-22):
// the panel names its zone, and a day after today there is refused. `approve` is refused with every
// reason that holds (FR-161: the call not recorded, a credential of the application undecided, none
// approved) and grants the approved credentials' subjects; `reject` ends an open application and
// closes its undecided credentials with the rejection's note (T122), `requestInfo` sets one in
// review waiting on the applicant, and `ban` is the standing's one function with the note the
// applicant sees (owner's decision 2026-10-22). An `unsuitable` call
// blocks nothing: the reviewer decides. Each decision writes the note the applicant sees and its
// moment. Every method runs on the administrator kind's transaction (`tx`).
import type {
  applicationsApproveInput,
  applicationsBanInput,
  applicationsGetOutput,
  applicationsListInput,
  applicationsListOutput,
  applicationsRecordCallInput,
  applicationsRejectInput,
  applicationsRequestInfoInput,
  openIdentityRequest,
} from '@ijazah/contracts/admin';
import { calendarDateOf, dateColumnOf, isMinorOn, localDateIn, TimeError } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';

export type {
  ApplicantDetail,
  ApplicantRow,
  ApplicantsFilter,
  ApplicantStatus,
  CallRecord,
} from '../identity/index.js';
import type {
  ApplicantDetail,
  ApplicantRow,
  ApplicantsFilter,
  CallRecord,
} from '../identity/index.js';

/** A rejected application's undecided credentials closed (T122), catalog's entry's shape. */
export type { CredentialClosure } from '../catalog/index.js';
import type { CredentialClosure } from '../catalog/index.js';

/** The admin lists' page size (the admin and catalog modules read the same key). */
export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** A decision on the application, from the state it moves (identity's `decideApplication`). */
export interface ApplicationDecision {
  readonly kind: 'approve' | 'reject' | 'request_info';
  readonly adminId: string;
  readonly at: Date;
  readonly note: string | null;
}

/** A credential of an applicant, as the queue reads it. */
export interface CredentialOfApplicant {
  readonly credentialId: string;
  readonly teacherUserId: string;
  readonly subject: { readonly id: string; readonly nameAr: string; readonly nameEn: string };
  readonly status: 'pending' | 'needs_document' | 'approved' | 'rejected';
  readonly documentId: string;
  readonly submittedWithApplication: boolean;
  readonly createdAt: Date;
}

export type OpenIdentityRequest = z.input<typeof openIdentityRequest>;

/** What the review reads and writes, each on the call's transaction (`stores.ts`). */
export interface ApplicationReviewStore {
  page(
    tx: Transaction,
    filter: ApplicantsFilter,
    skip: number,
    take: number,
  ): Promise<ApplicantRow[]>;
  count(tx: Transaction, filter: ApplicantsFilter): Promise<number>;
  read(tx: Transaction, userId: string): Promise<ApplicantDetail | null>;
  credentialsOf(tx: Transaction, userIds: readonly string[]): Promise<CredentialOfApplicant[]>;
  documentUploadedAt(tx: Transaction, documentId: string): Promise<Date | null>;
  openRequestOf(tx: Transaction, userId: string): Promise<OpenIdentityRequest | null>;
  recordCall(tx: Transaction, userId: string, call: CallRecord): Promise<boolean>;
  decide(tx: Transaction, userId: string, decision: ApplicationDecision): Promise<boolean>;
  grantSubjects(tx: Transaction, userId: string, subjectIds: readonly string[]): Promise<void>;
  /** Rejects those still `pending` or `needs_document` (catalog's entry, T122); how many it moved. */
  closeCredentials(tx: Transaction, closure: CredentialClosure): Promise<number>;
}

/** The standing's ban, identity's (`standing.service.ts`). */
export interface ApplicantBan {
  ban(
    tx: Transaction,
    adminId: string,
    userId: string,
    applicant?: { readonly applicantNote: string },
  ): Promise<unknown>;
}

export interface ApplicationReviewDependencies {
  readonly store: ApplicationReviewStore;
  readonly standing: ApplicantBan;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}

type ListRow = z.input<typeof applicationsListOutput>['rows'][number];

/** The call's day and outcome, as the audit entry holds them; null for none recorded. */
type CallState = { readonly completedOn: string | null; readonly outcome: string | null };

/** A recorded call before and after, for the audit entry (T116). */
export interface CallMove {
  readonly before: CallState;
  readonly after: CallState;
}

export class ApplicationReviewService {
  readonly #store: ApplicationReviewStore;
  readonly #standing: ApplicantBan;
  readonly #settings: SettingsReader;
  readonly #now: () => Date;

  constructor(dependencies: ApplicationReviewDependencies) {
    this.#store = dependencies.store;
    this.#standing = dependencies.standing;
    this.#settings = dependencies.settings;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `applications.list`: one page of a tab, how many the tab and the search admit, and the page size. */
  async list(
    tx: Transaction,
    query: z.output<typeof applicationsListInput>,
  ): Promise<z.input<typeof applicationsListOutput>> {
    const size = await this.#settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const filter: ApplicantsFilter = { tab: query.tab, search: query.search };
    // One after the other: a transaction is one connection, which runs one query at a time.
    const rows = await this.#store.page(tx, filter, (query.page - 1) * size, size);
    const total = await this.#store.count(tx, filter);
    const credentials = await this.#store.credentialsOf(
      tx,
      rows.map((row) => row.userId),
    );
    return {
      rows: rows.map((row) => this.#rowOf(row, ofApplication(row, credentials))),
      total,
      pageSize: size,
    };
  }

  /** `applications.get`: the detail; the decision history is `audit.list` on the target. */
  async get(tx: Transaction, userId: string): Promise<z.input<typeof applicationsGetOutput>> {
    const applicant = await this.#readOrRefuse(tx, userId);
    const credentials = ofApplication(applicant, await this.#store.credentialsOf(tx, [userId]));
    const documentId = applicant.identityDocumentId;
    const uploadedAt =
      documentId === null ? null : await this.#store.documentUploadedAt(tx, documentId);
    const request = await this.#store.openRequestOf(tx, userId);
    return {
      ...this.#rowOf(applicant, credentials),
      qualificationSummary: applicant.qualificationSummary,
      timezoneCity: applicant.timezone,
      accountStatus: applicant.accountStatus,
      // A submitted application always names its identity document (T056).
      identityDocument: {
        documentId: documentId ?? '',
        type: applicant.identityDocumentType ?? 'national_id',
        uploadedAt: (uploadedAt ?? applicant.submittedAt).toISOString(),
      },
      credentials: credentials.map(({ credentialId, subject, status, documentId: pdf }) => ({
        credentialId,
        subject,
        status,
        documentId: pdf,
      })),
      call: {
        ...(applicant.callCompletedOn === null
          ? {}
          : { completedOn: calendarDateOf(applicant.callCompletedOn) }),
        ...(applicant.callOutcome === null ? {} : { outcome: applicant.callOutcome }),
        ...(applicant.callNotes === null ? {} : { notes: applicant.callNotes }),
      },
      ...(applicant.note === null ? {} : { note: applicant.note }),
      ...(request === null ? {} : { identityRequest: request }),
    };
  }

  /**
   * `applications.recordCall`: the call's day, outcome and notes on an open application; answers the
   * day and the outcome before and after it, notes left out as the entry leaves them (T116).
   */
  async recordCall(
    tx: Transaction,
    _adminId: string,
    input: z.output<typeof applicationsRecordCallInput>,
  ): Promise<CallMove> {
    let today: string;
    try {
      today = localDateIn(this.#now(), input.timeZone);
    } catch (error: unknown) {
      if (error instanceof TimeError) throw invalid('timeZone', 'unknown');
      throw error;
    }
    // ISO calendar dates order as strings do.
    if (input.completedOn > today) throw invalid('completedOn', 'future');
    const { callCompletedOn, callOutcome } = await this.#readOrRefuse(tx, input.teacherUserId);
    const before = {
      completedOn: callCompletedOn === null ? null : calendarDateOf(callCompletedOn),
      outcome: callOutcome,
    };
    const written = await this.#store.recordCall(tx, input.teacherUserId, {
      completedOn: dateColumnOf(input.completedOn),
      outcome: input.outcome,
      notes: input.notes,
    });
    if (!written) await this.#refuseMoved(tx, input.teacherUserId);
    return { before, after: { completedOn: input.completedOn, outcome: input.outcome } };
  }

  /** `applications.approve`: refused with every blocking reason; the approved subjects granted. */
  async approve(
    tx: Transaction,
    adminId: string,
    input: z.output<typeof applicationsApproveInput>,
  ): Promise<{ readonly subjectIds: string[] }> {
    const applicant = await this.#readOrRefuse(tx, input.teacherUserId);
    if (applicant.status !== 'in_review') throw conflict(applicant.status);
    const credentials = ofApplication(
      applicant,
      await this.#store.credentialsOf(tx, [applicant.userId]),
    );
    const approved = credentials.filter((credential) => credential.status === 'approved');
    const reasons = [
      ...(applicant.callCompletedOn === null ? ['call_not_recorded'] : []),
      ...(credentials.some(({ status }) => status === 'pending' || status === 'needs_document')
        ? ['credential_undecided']
        : []),
      ...(approved.length === 0 ? ['none_approved'] : []),
    ];
    if (reasons.length > 0) {
      throw new DomainError('APPROVAL_BLOCKED', undefined, {
        details: reasons.map((code) => ({ path: 'approval', code })),
      });
    }
    const decision = {
      kind: 'approve' as const,
      adminId,
      at: this.#now(),
      note: input.note ?? null,
    };
    if (!(await this.#store.decide(tx, applicant.userId, decision))) {
      await this.#refuseMoved(tx, applicant.userId);
    }
    const subjectIds = approved.map((credential) => credential.subject.id);
    await this.#store.grantSubjects(tx, applicant.userId, subjectIds);
    return { subjectIds };
  }

  /**
   * `applications.reject`: an open application, with the note the applicant sees. Once the decision
   * lands, the application's credentials still undecided are rejected with the same note, admin and
   * moment (T122), so none stays «قيد المراجعة» after the application is closed.
   */
  async reject(
    tx: Transaction,
    adminId: string,
    input: z.output<typeof applicationsRejectInput>,
  ): Promise<void> {
    const at = this.#now();
    await this.#decide(tx, adminId, input.teacherUserId, 'reject', input.note, at);
    const applicant = await this.#readOrRefuse(tx, input.teacherUserId);
    const undecided = ofApplication(
      applicant,
      await this.#store.credentialsOf(tx, [applicant.userId]),
    ).filter(({ status }) => status === 'pending' || status === 'needs_document');
    if (undecided.length === 0) return;
    await this.#store.closeCredentials(tx, {
      credentialIds: undecided.map(({ credentialId }) => credentialId),
      reason: input.note,
      adminId,
      at,
    });
  }

  /** `applications.requestInfo`: an application in review waits on the applicant (`needs_document`). */
  requestInfo(
    tx: Transaction,
    adminId: string,
    input: z.output<typeof applicationsRequestInfoInput>,
  ): Promise<void> {
    return this.#decide(tx, adminId, input.teacherUserId, 'request_info', input.note);
  }

  /** `applications.ban`: the standing's one ban, the note written to the application. */
  async ban(
    tx: Transaction,
    adminId: string,
    input: z.output<typeof applicationsBanInput>,
  ): Promise<void> {
    await this.#standing.ban(tx, adminId, input.teacherUserId, { applicantNote: input.note });
  }

  async #decide(
    tx: Transaction,
    adminId: string,
    userId: string,
    kind: 'reject' | 'request_info',
    note: string,
    at: Date = this.#now(),
  ): Promise<void> {
    const written = await this.#store.decide(tx, userId, { kind, adminId, at, note });
    if (!written) await this.#refuseMoved(tx, userId);
  }

  #rowOf(row: ApplicantRow, credentials: readonly CredentialOfApplicant[]): ListRow {
    return {
      teacherUserId: row.userId,
      displayName: row.displayName,
      email: row.email,
      gender: row.gender,
      // A live person's date of birth is set (rule 32); the day today is the UTC one.
      isMinor:
        row.dateOfBirth !== null &&
        isMinorOn(calendarDateOf(row.dateOfBirth), calendarDateOf(this.#now())),
      subjects: credentials.map(({ subject }) => ({ ...subject })),
      ...(row.callCompletedOn === null
        ? {}
        : { callRecordedOn: calendarDateOf(row.callCompletedOn) }),
      submittedAt: row.submittedAt.toISOString(),
      status: row.status,
    };
  }

  async #readOrRefuse(tx: Transaction, userId: string): Promise<ApplicantDetail> {
    const applicant = await this.#store.read(tx, userId);
    if (applicant === null) throw new DomainError('NOT_FOUND');
    return applicant;
  }

  /** A conditional write that did not land: NOT_FOUND, or CONFLICT naming the status now. */
  async #refuseMoved(tx: Transaction, userId: string): Promise<never> {
    throw conflict((await this.#readOrRefuse(tx, userId)).status);
  }
}

/** The current application's credentials: those sent with it, which share its submission's instant. */
function ofApplication(
  applicant: Pick<ApplicantRow, 'userId' | 'submittedAt'>,
  credentials: readonly CredentialOfApplicant[],
): CredentialOfApplicant[] {
  const submitted = applicant.submittedAt.toISOString();
  return credentials.filter(
    (credential) =>
      credential.teacherUserId === applicant.userId &&
      credential.submittedWithApplication &&
      credential.createdAt.toISOString() === submitted,
  );
}

function conflict(status: string): DomainError {
  return new DomainError('CONFLICT', undefined, {
    details: [{ path: 'teacherUserId', code: status }],
  });
}

function invalid(path: string, code: string): DomainError {
  return new DomainError('VALIDATION_FAILED', undefined, { details: [{ path, code }] });
}
