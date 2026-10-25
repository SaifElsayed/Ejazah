// T069 (FR-163, FR-164, ADR 0017 D1/D2/D5): the administrator's review of a teacher's credential,
// one ijazah PDF for one subject, beside the transcription form. Approval writes the holder's name,
// the riwaya, the tariq and the chain origin first, and refuses a second approved credential for the
// teacher's subject (rule 23 holds it in the database too); it makes the subject an approved
// teacher's at once (FR-153), while an applicant's subjects come with the application's approval
// (T068). Rejection ends a credential waiting for review or for a document; the request for another
// document sets a pending one waiting; each carries the reason the teacher sees. A correction is an
// approved credential's alone, changes only the fields it names, and answers the transcription
// before and after for its audit entry (FR-164). The teacher never edits the chain.
//
// Every write is conditional on the state it moves from, decided by the database (the store), so two
// reviewers racing on one credential cannot both move it; the one that lost reads the state again to
// answer NOT_FOUND or CONFLICT. Each method runs on the administrator kind's transaction (`tx`), so
// the change and its audit entry commit together.
import type {
  adminCredentialCorrection,
  adminCredentialsApproveInput,
  adminCredentialsCorrectInput,
  adminCredentialsGetOutput,
  adminCredentialsListInput,
  adminCredentialsListOutput,
  adminCredentialsRejectInput,
  adminCredentialTranscription,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';

/** The admin lists' page size (the admin module reads the same key for its own lists). */
export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

export type ReviewStatus = 'pending' | 'needs_document' | 'approved' | 'rejected';

type Subject = { readonly id: string; readonly nameAr: string; readonly nameEn: string };
type Generation = { readonly position: number; readonly names: readonly string[] };

/** One tab of the queue and the search typed into it (the teacher's name). */
export interface ReviewFilter {
  readonly status: ReviewStatus;
  readonly search?: string | undefined;
}

/** A credential as the queue lists it. */
export interface ReviewListRow {
  readonly id: string;
  readonly teacher: { readonly userId: string; readonly displayName: string };
  readonly subject: Subject;
  readonly submittedWithApplication: boolean;
  readonly createdAt: Date;
  readonly status: ReviewStatus;
  /** When it was decided; the decided tabs show it (B14c). */
  readonly reviewedAt: Date | null;
}

/** A credential as the review panel reads it. */
export interface ReviewRecord extends ReviewListRow {
  readonly documentId: string;
  readonly holderName: string | null;
  readonly riwaya: string | null;
  readonly tariq: string | null;
  readonly chain: readonly Generation[];
  readonly reviewReason: string | null;
  readonly reviewedByName: string | null;
}

/** An approval to write: the transcription and the chain, each generation's names origin first. */
export interface Approval {
  readonly credentialId: string;
  readonly holderName: string;
  readonly riwaya: string;
  readonly tariq: string | null;
  readonly chain: readonly (readonly string[])[];
  readonly adminId: string;
  readonly at: Date;
}

/** A rejection or a request for another document, from the states it may move. */
export interface Decision {
  readonly credentialId: string;
  readonly from: readonly ReviewStatus[];
  readonly to: 'rejected' | 'needs_document';
  readonly reason: string;
  readonly adminId: string;
  readonly at: Date;
}

/** A correction of an approved credential: the whole transcription after it, the chain when changed. */
export interface Correction {
  readonly credentialId: string;
  readonly holderName: string;
  readonly riwaya: string;
  readonly tariq: string | null;
  readonly chain?: readonly (readonly string[])[];
  /** Who wrote the corrected chain's generations (`isnad_entries.created_by_admin_id`). */
  readonly adminId: string;
}

/** What the review reads and writes, each on the call's transaction (`credential-review.repository.ts`). */
export interface CredentialReviewStore {
  page(tx: Transaction, filter: ReviewFilter, skip: number, take: number): Promise<ReviewListRow[]>;
  count(tx: Transaction, filter: ReviewFilter): Promise<number>;
  read(tx: Transaction, credentialId: string): Promise<ReviewRecord | null>;
  /** Whether the teacher holds an approved credential for the subject. */
  hasApproved(tx: Transaction, teacherUserId: string, subjectId: string): Promise<boolean>;
  /** Approves a pending credential; `moved` when it was not pending, `taken` when rule 23 refused. */
  approve(tx: Transaction, approval: Approval): Promise<'approved' | 'moved' | 'taken'>;
  /** Writes the decision while the credential is in one of `from`; whether it wrote. */
  decide(tx: Transaction, decision: Decision): Promise<boolean>;
  /** Writes the correction while the credential is approved; whether it wrote. */
  correct(tx: Transaction, correction: Correction): Promise<boolean>;
  /** Whether the teacher is approved (identity's `teacher_profiles`). */
  isApprovedTeacher(tx: Transaction, userId: string): Promise<boolean>;
  grantSubjects(
    tx: Transaction,
    teacherUserId: string,
    subjectIds: readonly string[],
  ): Promise<void>;
}

export interface CredentialReviewDependencies {
  readonly store: CredentialReviewStore;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}

type ListQuery = z.output<typeof adminCredentialsListInput>;
type ApproveInput = z.output<typeof adminCredentialsApproveInput>;
type DecisionInput = z.output<typeof adminCredentialsRejectInput>;
type CorrectInput = z.output<typeof adminCredentialsCorrectInput>;
type Transcription = z.input<typeof adminCredentialTranscription>;

export class CredentialReviewService {
  readonly #store: CredentialReviewStore;
  readonly #settings: SettingsReader;
  readonly #now: () => Date;

  constructor(dependencies: CredentialReviewDependencies) {
    this.#store = dependencies.store;
    this.#settings = dependencies.settings;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `credentials.list`: one page of a tab, and how many the tab and the search admit. */
  async list(
    tx: Transaction,
    query: ListQuery,
  ): Promise<z.input<typeof adminCredentialsListOutput>> {
    const size = await this.#settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const filter: ReviewFilter = { status: query.tab, search: query.search };
    // One after the other: a transaction is one connection, which runs one query at a time.
    const rows = await this.#store.page(tx, filter, (query.page - 1) * size, size);
    const total = await this.#store.count(tx, filter);
    return { rows: rows.map(listRowOf), total, pageSize: size };
  }

  /** `credentials.get`: the review panel's credential, its transcription once approved. */
  async get(
    tx: Transaction,
    credentialId: string,
  ): Promise<z.input<typeof adminCredentialsGetOutput>> {
    const record = await this.#store.read(tx, credentialId);
    if (record === null) throw new DomainError('NOT_FOUND');
    return {
      ...listRowOf(record),
      documentId: record.documentId,
      ...(record.holderName === null ? {} : { holderName: record.holderName }),
      ...(record.riwaya === null ? {} : { riwaya: record.riwaya }),
      ...(record.tariq === null ? {} : { tariq: record.tariq }),
      ...(record.chain.length === 0 ? {} : { chain: record.chain.map(generationOf) }),
      ...(record.reviewReason === null ? {} : { reviewReason: record.reviewReason }),
      ...(record.reviewedByName === null ? {} : { reviewedByName: record.reviewedByName }),
    };
  }

  /** `credentials.approve`: the transcription written; what was written, for the audit entry. */
  async approve(tx: Transaction, adminId: string, input: ApproveInput): Promise<Transcription> {
    const record = await this.#readOrRefuse(tx, input.credentialId);
    if (record.status !== 'pending') throw conflict(record.status);
    if (await this.#store.hasApproved(tx, record.teacher.userId, record.subject.id)) {
      throw conflict('subject_approved');
    }
    const chain = input.chain.map(({ names }) => names);
    const outcome = await this.#store.approve(tx, {
      credentialId: record.id,
      holderName: input.holderName,
      riwaya: input.riwaya,
      tariq: input.tariq ?? null,
      chain,
      adminId,
      at: this.#now(),
    });
    // Another reviewer moved the credential, or approved another for the subject, meanwhile.
    if (outcome === 'moved') return this.#refuseMoved(tx, record.id);
    if (outcome === 'taken') throw conflict('subject_approved');
    if (await this.#store.isApprovedTeacher(tx, record.teacher.userId)) {
      await this.#store.grantSubjects(tx, record.teacher.userId, [record.subject.id]);
    }
    return {
      holderName: input.holderName,
      riwaya: input.riwaya,
      tariq: input.tariq ?? null,
      chain: positioned(chain),
    };
  }

  /** `credentials.reject`: from review, or from waiting on a document that never came. */
  reject(tx: Transaction, adminId: string, input: DecisionInput): Promise<void> {
    return this.#decide(tx, adminId, input, ['pending', 'needs_document'], 'rejected');
  }

  /** `credentials.requestDocument`: a pending credential waits for another PDF. */
  requestDocument(tx: Transaction, adminId: string, input: DecisionInput): Promise<void> {
    return this.#decide(tx, adminId, input, ['pending'], 'needs_document');
  }

  /** `credentials.correct`: an approved credential's transcription, before and after (FR-164). */
  async correct(
    tx: Transaction,
    adminId: string,
    input: CorrectInput,
  ): Promise<z.input<typeof adminCredentialCorrection>> {
    const record = await this.#readOrRefuse(tx, input.credentialId);
    if (record.status !== 'approved') throw conflict(record.status);
    const before = transcriptionOf(record);
    const chain = input.chain?.map(({ names }) => names);
    const after: Transcription = {
      holderName: input.holderName ?? before.holderName,
      riwaya: input.riwaya ?? before.riwaya,
      tariq: input.tariq ?? before.tariq,
      chain: chain === undefined ? before.chain : positioned(chain),
    };
    const written = await this.#store.correct(tx, {
      credentialId: record.id,
      holderName: after.holderName,
      riwaya: after.riwaya,
      tariq: after.tariq ?? null,
      ...(chain === undefined ? {} : { chain }),
      adminId,
    });
    if (!written) return this.#refuseMoved(tx, record.id);
    return { before, after };
  }

  async #decide(
    tx: Transaction,
    adminId: string,
    input: DecisionInput,
    from: readonly ReviewStatus[],
    to: Decision['to'],
  ): Promise<void> {
    const written = await this.#store.decide(tx, {
      credentialId: input.credentialId,
      from,
      to,
      reason: input.reason,
      adminId,
      at: this.#now(),
    });
    if (!written) await this.#refuseMoved(tx, input.credentialId);
  }

  /** A conditional write that did not land: NOT_FOUND, or CONFLICT naming the state it is in now. */
  async #refuseMoved(tx: Transaction, credentialId: string): Promise<never> {
    throw conflict((await this.#readOrRefuse(tx, credentialId)).status);
  }

  async #readOrRefuse(tx: Transaction, credentialId: string): Promise<ReviewRecord> {
    const record = await this.#store.read(tx, credentialId);
    if (record === null) throw new DomainError('NOT_FOUND');
    return record;
  }
}

/** CONFLICT naming the state the credential is in, or `subject_approved` for rule 23. */
function conflict(code: string): DomainError {
  return new DomainError('CONFLICT', undefined, { details: [{ path: 'credentialId', code }] });
}

function generationOf({ position, names }: Generation): { position: number; names: string[] } {
  return { position, names: [...names] };
}

/** The chain's generations numbered from the origin, the first being 1. */
function positioned(
  chain: readonly (readonly string[])[],
): { position: number; names: string[] }[] {
  return chain.map((names, index) => ({ position: index + 1, names: [...names] }));
}

function transcriptionOf(record: ReviewRecord): Transcription {
  return {
    holderName: record.holderName ?? '',
    riwaya: record.riwaya ?? '',
    tariq: record.tariq,
    chain: record.chain.map(generationOf),
  };
}

function listRowOf(row: ReviewListRow): z.input<typeof adminCredentialsListOutput>['rows'][number] {
  return {
    credentialId: row.id,
    teacher: { userId: row.teacher.userId, displayName: row.teacher.displayName },
    subject: { id: row.subject.id, nameAr: row.subject.nameAr, nameEn: row.subject.nameEn },
    origin: row.submittedWithApplication ? 'application' : 'added',
    submittedAt: row.createdAt.toISOString(),
    status: row.status,
    ...(row.reviewedAt === null ? {} : { reviewedAt: row.reviewedAt.toISOString() }),
  };
}
