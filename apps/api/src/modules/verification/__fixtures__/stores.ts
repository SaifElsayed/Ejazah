// T053, T054: the application's and the credentials' stores in memory, for the service specs. They
// keep the rules the real stores keep (a conditional write answers whether it wrote; an application
// opens from no application or from `rejected` only; a document belongs to its uploader), so a
// service spec reads the rows a call left. That the real stores keep the same rules over the tables
// is `tests/db-integrity/teacher-application.spec.ts`'s to prove.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type {
  ApplicationChange,
  ApplicationRecord,
  CredentialRecord,
  NewCredential,
  VerificationStores,
} from '../stores.js';

const TX = {} as Transaction;

/** The seeded subjects the specs choose from; the last one is inactive. */
export const SUBJECTS = [
  {
    id: '0199d0a0-0000-7000-8000-0000000000a1',
    nameAr: 'حفظ القرآن',
    nameEn: 'Quran memorization',
  },
  { id: '0199d0a0-0000-7000-8000-0000000000a2', nameAr: 'التجويد', nameEn: 'Tajweed' },
  { id: '0199d0a0-0000-7000-8000-0000000000a3', nameAr: 'القراءات', nameEn: 'Qiraat' },
] as const;
export const INACTIVE_SUBJECT = '0199d0a0-0000-7000-8000-0000000000a9';

interface StoredProfile extends ApplicationRecord {
  qualificationSummary: string;
  identityDocumentId: string | null;
  identityDocumentType: 'national_id' | 'passport' | null;
}

interface StoredCredential extends Omit<CredentialRecord, 'subject'> {
  teacherUserId: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class MemoryStores implements VerificationStores {
  readonly profiles = new Map<string, Mutable<StoredProfile>>();
  readonly credentials: Mutable<StoredCredential>[] = [];
  readonly documents = new Map<string, { userId: string; sizeBytes: number | null }>();
  /** Every write a call made, by kind, so a refusal can be shown to have written nothing. */
  readonly writes: string[] = [];
  /**
   * Each lock (`lock-account:<id>` the account's, T142; `lock:<id>` the application's, T161), each
   * read of the application and each of its credentials, in order.
   */
  readonly journal: string[] = [];

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(TX);
  }

  /** A document `userId` uploaded; its size unless said otherwise. */
  upload(userId: string, sizeBytes: number | null = 2048): string {
    const id = randomUUID();
    this.documents.set(id, { userId, sizeBytes });
    return id;
  }

  /** An administrator's decision on the application (B13's procedures, stood in for here). */
  decide(
    userId: string,
    status: 'needs_document' | 'rejected' | 'approved' | 'banned',
    at: Date,
    note?: string,
  ): void {
    const profile = this.#profile(userId);
    Object.assign(profile, { status, decidedAt: at, note: note ?? null });
  }

  recordCall(userId: string): void {
    this.#profile(userId).callRecorded = true;
  }

  /** An administrator's review of a credential, with the transcription on approval. */
  review(
    credentialId: string,
    review:
      | { status: 'needs_document' | 'rejected'; reason: string; at: Date }
      | {
          status: 'approved';
          at: Date;
          holderName: string;
          riwaya: string;
          tariq: string | null;
          chain: { position: number; names: string[] }[];
        },
  ): void {
    const credential = this.credentials.find(({ id }) => id === credentialId);
    if (credential === undefined) throw new Error(`no credential ${credentialId}`);
    credential.status = review.status;
    credential.reviewedAt = review.at;
    if (review.status === 'approved') {
      Object.assign(credential, {
        holderName: review.holderName,
        riwaya: review.riwaya,
        tariq: review.tariq,
        chain: review.chain,
        reviewReason: null,
      });
    } else {
      credential.reviewReason = review.reason;
    }
  }

  credentialsFor(userId: string): StoredCredential[] {
    return this.credentials.filter(({ teacherUserId }) => teacherUserId === userId);
  }

  #profile(userId: string): Mutable<StoredProfile> {
    const profile = this.profiles.get(userId);
    if (profile === undefined) throw new Error(`no profile for ${userId}`);
    return profile;
  }

  async lockAccount(_tx: Transaction, userId: string): Promise<void> {
    this.journal.push(`lock-account:${userId}`);
  }

  async lockApplication(_tx: Transaction, userId: string): Promise<void> {
    this.journal.push(`lock:${userId}`);
  }

  async readApplication(_tx: Transaction, userId: string): Promise<ApplicationRecord | null> {
    this.journal.push(`read:${userId}`);
    return this.profiles.get(userId) ?? null;
  }

  async setApplication(
    _tx: Transaction,
    userId: string,
    change: ApplicationChange,
  ): Promise<boolean> {
    const profile = this.profiles.get(userId);
    switch (change.kind) {
      case 'open': {
        if ((profile?.status ?? null) !== change.from) return false;
        this.profiles.set(userId, {
          status: 'in_review',
          submittedAt: change.submittedAt,
          note: null,
          decidedAt: null,
          callRecorded: false,
          approvedShownAt: null,
          qualificationSummary: change.qualificationSummary,
          identityDocumentId: change.identityDocumentId,
          identityDocumentType: change.identityDocumentType,
        });
        break;
      }
      case 'resubmit': {
        if (profile?.status !== 'needs_document') return false;
        profile.status = 'in_review';
        if (change.identityDocumentId !== undefined) {
          profile.identityDocumentId = change.identityDocumentId;
        }
        break;
      }
      case 'approvedShown': {
        if (profile?.status !== 'approved' || profile.approvedShownAt !== null) return false;
        profile.approvedShownAt = change.at;
        break;
      }
    }
    this.writes.push(`application.${change.kind}`);
    return true;
  }

  async activeSubjectsAmong(
    _tx: Transaction,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    return new Set(ids.filter((id) => SUBJECTS.some((subject) => subject.id === id)));
  }

  async credentialsOf(_tx: Transaction, userId: string): Promise<CredentialRecord[]> {
    this.journal.push(`credentials:${userId}`);
    return this.credentialsFor(userId).map(({ teacherUserId: _teacher, ...credential }) => {
      const subject = SUBJECTS.find(({ id }) => id === credential.subjectId);
      if (subject === undefined) throw new Error(`no subject ${credential.subjectId}`);
      return { ...credential, subject };
    });
  }

  async addCredential(_tx: Transaction, row: NewCredential): Promise<string> {
    const id = randomUUID();
    this.credentials.push({
      id,
      teacherUserId: row.teacherUserId,
      subjectId: row.subjectId,
      documentId: row.documentId,
      status: 'pending',
      submittedWithApplication: row.submittedWithApplication,
      createdAt: row.createdAt,
      reviewedAt: null,
      reviewReason: null,
      holderName: null,
      riwaya: null,
      tariq: null,
      chain: [],
    });
    this.writes.push('credential.add');
    return id;
  }

  async replaceCredentialDocument(
    _tx: Transaction,
    replacement: { credentialId: string; teacherUserId: string; documentId: string },
  ): Promise<boolean> {
    const credential = this.credentials.find(
      ({ id, teacherUserId, status }) =>
        id === replacement.credentialId &&
        teacherUserId === replacement.teacherUserId &&
        status === 'needs_document',
    );
    if (credential === undefined) return false;
    credential.documentId = replacement.documentId;
    credential.status = 'pending';
    this.writes.push('credential.replaceDocument');
    return true;
  }

  async documentsOwnedAmong(
    _tx: Transaction,
    userId: string,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    return new Set(ids.filter((id) => this.documents.get(id)?.userId === userId));
  }

  async documentSizes(
    _tx: Transaction,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    return new Map(
      ids.flatMap((id) => {
        const size = this.documents.get(id)?.sizeBytes;
        return size === undefined || size === null ? [] : [[id, size] as const];
      }),
    );
  }
}

/** The idempotency service as the application service calls it: each run recorded, then run. */
export function recordedIdempotency() {
  const runs: { scope: string; key: string; actorId: string; input: unknown }[] = [];
  return {
    runs,
    run: async <T>(
      request: { scope: string; key: string; actorId: string; input: unknown },
      effect: (tx: Transaction) => Promise<T>,
    ): Promise<T> => {
      runs.push(request);
      return effect(TX);
    },
  };
}
