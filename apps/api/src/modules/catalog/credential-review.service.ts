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
// T155: the request for another document on a credential sent with an application also sets that
// application, while it is in review, waiting on the applicant (`needs_document`), with the
// credential's reason as its note and the decision's moment, on the same transaction, so the
// applicant reaches the field to send the PDF; identity's `decideApplication` moves it, from
// `in_review` only, so one already waiting keeps its note and an approved teacher's added subject
// moves no application. The move is the entry's before and after.
//
// T174 (SRS DEC-97, FR-AUTH-14; the note under T174): every decision and correction writes one row of
// the credential's history on its transaction, after the conditional write that holds the
// credential's row: the note or the reason, and on an approval and a correction the name and the
// chain before and after. A request for another document that moves the application writes the
// credential's row only. The audit entry is drawn from the answer with no name, no chain and no
// text (`auditTranscriptionsOf`). A correction locks the credential before it reads what it
// replaces, so two corrections at once chain their history.
//
// Q-A2-1 (the owner's approval of 2026-11-22): every decision locks the teacher's account first and
// then reads the credential again (rule 1), so a never-approved teacher's deletion, which holds the
// account while catalog's consequence blanks the credentials, commits first and the decision then
// answers NOT_FOUND (a soft-deleted teacher's credential, R-DB-3) and writes nothing onto the blanked
// row. A credential's teacher never changes, so the read before the lock reads only whose it is.
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

import type { AuditJson, AuditSnapshot } from '../../platform/audit/audit-writer.js';
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

/** The application set waiting on the applicant by a request for another document (T155). */
export interface ApplicationDocumentRequest {
  readonly adminId: string;
  readonly at: Date;
  /** The credential's reason, which the applicant reads as the application's note. */
  readonly note: string;
}

/** The application a request for another document moved, for its audit entry; empty for none (T155). */
export interface DocumentRequestMove {
  readonly before?: { readonly applicationStatus: 'in_review' };
  readonly after?: { readonly applicationStatus: 'needs_document' };
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

/** A decision or a correction the credential's history records (T174, ERD rule 68). */
export type HistoryAction = 'approve' | 'reject' | 'request_document' | 'correct';

/** The name and the chain a history row holds before or after an approval or a correction (T174). */
export interface HistoryTranscription {
  readonly holderName: string;
  readonly riwaya: string;
  readonly tariq: string | null;
  readonly chain: readonly Generation[];
}

/**
 * One row of the credential's history, written in the decision's transaction (T174): `before` on a
 * correction only, `after` on an approval and a correction (rule 68); the note is the reviewer's,
 * required except on an approval, or the correction's reason.
 */
export interface HistoryEntry {
  readonly credentialId: string;
  readonly action: HistoryAction;
  readonly note: string | null;
  readonly before?: HistoryTranscription;
  readonly after?: HistoryTranscription;
  readonly adminId: string;
  readonly at: Date;
}

/** A history row as `credentials.get` reads it: the administrator by name, oldest first (T174). */
export interface HistoryRow {
  readonly action: HistoryAction;
  readonly note: string | null;
  readonly before: HistoryTranscription | null;
  readonly after: HistoryTranscription | null;
  readonly adminName: string;
  readonly at: Date;
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
  /** Locks the teacher's account, identity's `users` row, until the transaction ends (T142). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** Locks the teacher's application, identity's `teacher_profiles` row, until the transaction ends (T161). */
  lockApplication(tx: Transaction, userId: string): Promise<void>;
  /** Whether the teacher is approved (identity's `teacher_profiles`). */
  isApprovedTeacher(tx: Transaction, userId: string): Promise<boolean>;
  /**
   * Sets the teacher's application waiting on the applicant while it is in review (identity's
   * `decideApplication`); whether it moved (T155).
   */
  requestApplicationDocument(
    tx: Transaction,
    userId: string,
    request: ApplicationDocumentRequest,
  ): Promise<boolean>;
  grantSubjects(
    tx: Transaction,
    teacherUserId: string,
    subjectIds: readonly string[],
  ): Promise<void>;
  /**
   * Locks the credential's own row FOR UPDATE until the transaction ends (T174): a correction reads
   * the transcription before it under the lock, so two corrections at once chain their history.
   */
  lockCredential(tx: Transaction, credentialId: string): Promise<void>;
  /** Inserts one row of the credential's history, after the decision's write (T174). */
  recordHistory(tx: Transaction, entry: HistoryEntry): Promise<void>;
  /** The credential's history, oldest first (T174). */
  historyOf(tx: Transaction, credentialId: string): Promise<HistoryRow[]>;
}

/**
 * T006 of specs/005-certification (P4 (a); research R-403; the note under T006, Q-A4 (a)): the open
 * ijazah requests that froze this credential, re-frozen from its corrected transcription and chain
 * on the correction's transaction. Certification imports catalog, so catalog declares the port and
 * `main.ts` binds it to certification's entry (`docs/ARCHITECTURE.md:197`).
 */
export interface OpenRequestsRefreeze {
  refreeze(tx: Transaction, credentialId: string): Promise<void>;
}

export interface CredentialReviewDependencies {
  readonly store: CredentialReviewStore;
  /** T006 of specs/005-certification: the correction's re-freeze of the open requests. */
  readonly openRequestsRefreeze: OpenRequestsRefreeze;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}

type ListQuery = z.output<typeof adminCredentialsListInput>;
type ApproveInput = z.output<typeof adminCredentialsApproveInput>;
type DecisionInput = z.output<typeof adminCredentialsRejectInput>;
type CorrectInput = z.output<typeof adminCredentialsCorrectInput>;
type Transcription = z.input<typeof adminCredentialTranscription>;

type HistoryItem = z.input<typeof adminCredentialsGetOutput>['history'][number];

/** The transcription a pending credential holds before its approval, none of it written yet. */
type PriorTranscription = {
  readonly [K in keyof Omit<Transcription, 'chain'>]-?: Transcription[K] | null;
} & { readonly chain: Transcription['chain'] };

/**
 * An approval's transcription before and after it (T116). The router's audit entry is drawn from it
 * by `auditTranscriptionsOf`, with no name and no chain (T174).
 */
export interface ApprovalMove {
  readonly before: PriorTranscription;
  readonly after: Transcription;
}

/**
 * A transcription as an audit entry holds it (T174, SRS DEC-97; admin-surface.md:76 as amended): no
 * name and no chain, which the credential's history holds; the riwaya, the tariq, how many
 * generations the chain has, and whether the action changed the holder's name (always `false` on
 * a `before`, the state the action started from).
 */
export type AuditTranscription = {
  readonly riwaya: string | null;
  readonly tariq: string | null;
  readonly chainLength: number;
  readonly holderNameChanged: boolean;
};

/**
 * The audit entry's before and after of an approval or a correction (T174), drawn by the router from
 * what the service answered. The before is read as the surface types an approval's (`AuditSnapshot`,
 * `surfaces/context.ts`): a pending credential's fields are null and its chain empty.
 */
export function auditTranscriptionsOf(move: {
  readonly before: AuditSnapshot;
  readonly after: Transcription;
}): { readonly before: AuditTranscription; readonly after: AuditTranscription } {
  const { holderName, riwaya, tariq, chain } = move.before;
  return {
    before: {
      riwaya: textOf(riwaya),
      tariq: textOf(tariq),
      chainLength: Array.isArray(chain) ? chain.length : 0,
      holderNameChanged: false,
    },
    after: {
      riwaya: move.after.riwaya,
      tariq: move.after.tariq ?? null,
      chainLength: move.after.chain.length,
      holderNameChanged: move.after.holderName !== textOf(holderName),
    },
  };
}

function textOf(value: AuditJson | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export class CredentialReviewService {
  readonly #store: CredentialReviewStore;
  readonly #refreeze: OpenRequestsRefreeze;
  readonly #settings: SettingsReader;
  readonly #now: () => Date;

  constructor(dependencies: CredentialReviewDependencies) {
    this.#store = dependencies.store;
    this.#refreeze = dependencies.openRequestsRefreeze;
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
      // T174: one row per decision and correction, oldest first, read after the credential.
      history: (await this.#store.historyOf(tx, record.id)).map(historyItemOf),
    };
  }

  /** `credentials.approve`: the transcription written; what was written, for the audit entry. */
  async approve(tx: Transaction, adminId: string, input: ApproveInput): Promise<ApprovalMove> {
    const { teacher } = await this.#readOrRefuse(tx, input.credentialId);
    // The teacher's application row locked before the credential moves (T142): a revocation, which
    // writes that row, commits first or waits, so whether the teacher is approved is read as it is
    // when the subject is granted. Taken before the credential's own write, as a rejection of the
    // application takes it before closing its credentials, so the two never wait on each other.
    // The account's lock comes first, the order a ban takes them (the owner's decision of
    // 2026-11-01): the grant's `teacher_subjects` row references the teacher's `users` row, so
    // holding only the application, the grant would wait on a ban that waits on the application.
    await this.#store.lockAccount(tx, teacher.userId);
    // Q-A2-1: read again under the account's lock; a teacher deleted meanwhile is NOT_FOUND.
    const record = await this.#readOrRefuse(tx, input.credentialId);
    await this.#store.lockApplication(tx, record.teacher.userId);
    if (record.status !== 'pending') throw conflict(record.status);
    if (await this.#store.hasApproved(tx, record.teacher.userId, record.subject.id)) {
      throw conflict('subject_approved');
    }
    const chain = input.chain.map(({ names }) => names);
    const at = this.#now();
    const outcome = await this.#store.approve(tx, {
      credentialId: record.id,
      holderName: input.holderName,
      riwaya: input.riwaya,
      tariq: input.tariq ?? null,
      chain,
      adminId,
      at,
    });
    // Another reviewer moved the credential, or approved another for the subject, meanwhile.
    if (outcome === 'moved') return this.#refuseMoved(tx, record.id);
    if (outcome === 'taken') throw conflict('subject_approved');
    const after: HistoryTranscription = {
      holderName: input.holderName,
      riwaya: input.riwaya,
      tariq: input.tariq ?? null,
      chain: positioned(chain),
    };
    // T174: the name, the chain and the note go into the credential's history, after the write
    // that holds the credential's row (the insert references it), never into the audit entry.
    await this.#store.recordHistory(tx, {
      credentialId: record.id,
      action: 'approve',
      note: input.note ?? null,
      after,
      adminId,
      at,
    });
    if (await this.#store.isApprovedTeacher(tx, record.teacher.userId)) {
      await this.#store.grantSubjects(tx, record.teacher.userId, [record.subject.id]);
    }
    return {
      // The pending credential's transcription, none of it written yet (T116).
      before: {
        holderName: record.holderName,
        riwaya: record.riwaya,
        tariq: record.tariq,
        chain: record.chain.map(generationOf),
      },
      after: copyOf(after),
    };
  }

  /** `credentials.reject`: from review, or from waiting on a document that never came. */
  async reject(tx: Transaction, adminId: string, input: DecisionInput): Promise<void> {
    const { teacher } = await this.#readOrRefuse(tx, input.credentialId);
    // Q-A2-1: the account's lock, then the credential read again (NOT_FOUND once deleted).
    await this.#store.lockAccount(tx, teacher.userId);
    await this.#readOrRefuse(tx, input.credentialId);
    await this.#decide(tx, adminId, input, ['pending', 'needs_document'], 'rejected');
  }

  /**
   * `credentials.requestDocument`: a pending credential waits for another PDF, and the application
   * it was sent with, while in review, waits on the applicant with its reason (T155).
   */
  async requestDocument(
    tx: Transaction,
    adminId: string,
    input: DecisionInput,
  ): Promise<DocumentRequestMove> {
    const { teacher } = await this.#readOrRefuse(tx, input.credentialId);
    // Q-A2-1: the account's lock first, then the credential read again (NOT_FOUND once deleted).
    await this.#store.lockAccount(tx, teacher.userId);
    const record = await this.#readOrRefuse(tx, input.credentialId);
    // The application's lock before the credential moves (T161), so a resubmission meanwhile
    // commits first, or waits and then reads the credential waiting. A credential's teacher never
    // changes, so reading it before the lock reads nothing the lock guards.
    await this.#store.lockApplication(tx, record.teacher.userId);
    const at = this.#now();
    await this.#decide(tx, adminId, input, ['pending'], 'needs_document', at);
    if (!record.submittedWithApplication) return {};
    const moved = await this.#store.requestApplicationDocument(tx, record.teacher.userId, {
      adminId,
      at,
      note: input.reason,
    });
    if (!moved) return {};
    return {
      before: { applicationStatus: 'in_review' },
      after: { applicationStatus: 'needs_document' },
    };
  }

  /** `credentials.correct`: an approved credential's transcription, before and after (FR-164). */
  async correct(
    tx: Transaction,
    adminId: string,
    input: CorrectInput,
  ): Promise<z.input<typeof adminCredentialCorrection>> {
    // T174: the credential's row locked, then read (rule 1), so the transcription before is the one
    // the correction replaces: a second correction meanwhile waits, then reads this one's after.
    // The kernel's order: the account (Q-A2-1), the credential, then its open ijazah requests (the
    // re-freeze below).
    const { teacher } = await this.#readOrRefuse(tx, input.credentialId);
    await this.#store.lockAccount(tx, teacher.userId);
    await this.#store.lockCredential(tx, input.credentialId);
    const record = await this.#readOrRefuse(tx, input.credentialId);
    if (record.status !== 'approved') throw conflict(record.status);
    const before = transcriptionOf(record);
    const chain = input.chain?.map(({ names }) => names);
    const after: HistoryTranscription = {
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
    // T174: the name and the chain before and after, with the reason, in the credential's history.
    await this.#store.recordHistory(tx, {
      credentialId: record.id,
      action: 'correct',
      note: input.reason,
      before,
      after,
      adminId,
      at: this.#now(),
    });
    // T006 of specs/005-certification (P4 (a)): after the conditional write landed, which holds the
    // credential's row lock, on the same transaction; the order credential → ijazah_requests of the
    // kernel row (specs/004-sessions/contracts/kernel.md, the ijazah request's row).
    await this.#refreeze.refreeze(tx, record.id);
    return { before: copyOf(before), after: copyOf(after) };
  }

  async #decide(
    tx: Transaction,
    adminId: string,
    input: DecisionInput,
    from: readonly ReviewStatus[],
    to: Decision['to'],
    at: Date = this.#now(),
  ): Promise<void> {
    const written = await this.#store.decide(tx, {
      credentialId: input.credentialId,
      from,
      to,
      reason: input.reason,
      adminId,
      at,
    });
    if (!written) await this.#refuseMoved(tx, input.credentialId);
    // T174: the reason, in the credential's history, after the write that holds the credential.
    await this.#store.recordHistory(tx, {
      credentialId: input.credentialId,
      action: HISTORY_ACTION[to],
      note: input.reason,
      adminId,
      at,
    });
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

/** The history's action of each decision's state (T174). */
const HISTORY_ACTION = {
  rejected: 'reject',
  needs_document: 'request_document',
} as const satisfies Record<Decision['to'], HistoryAction>;

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

/** A history row as `credentials.get` answers it; a correction's note is its `reason` (admin-surface.md:70). */
function historyItemOf(row: HistoryRow): HistoryItem {
  return {
    action: row.action,
    ...textOfRow(row),
    ...(row.before === null ? {} : { before: copyOf(row.before) }),
    ...(row.after === null ? {} : { after: copyOf(row.after) }),
    adminName: row.adminName,
    at: row.at.toISOString(),
  };
}

/** A row's note, answered as a correction's `reason`; nothing where it holds none. */
function textOfRow(row: HistoryRow): { note?: string; reason?: string } {
  if (row.note === null) return {};
  return row.action === 'correct' ? { reason: row.note } : { note: row.note };
}

function copyOf(transcription: HistoryTranscription): Transcription {
  return {
    holderName: transcription.holderName,
    riwaya: transcription.riwaya,
    tariq: transcription.tariq,
    chain: transcription.chain.map(generationOf),
  };
}

function transcriptionOf(record: ReviewRecord): HistoryTranscription {
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
