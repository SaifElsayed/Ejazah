// T063: the credential review's store held in memory, for the service's spec. It keeps the rules the
// database keeps (a conditional write moves only the state it names; one approved credential per
// teacher and subject, rule 23), so the service's own rules are what the spec proves; the real
// queries are `tests/db-integrity/credential-review.spec.ts`'s. T155 adds the teachers' applications,
// which a request for another document moves only from `in_review`, as identity's
// `decideApplication` does.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type {
  ApplicationDocumentRequest,
  Approval,
  CredentialReviewStore,
  Correction,
  Decision,
  ReviewFilter,
  ReviewListRow,
  ReviewRecord,
  ReviewStatus,
} from './credential-review.service.js';

export const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';
export const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000000c2';
export const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
export const SUBJECT = {
  id: '0199d0a0-0000-7000-8000-000000000051',
  nameAr: 'حفص',
  nameEn: 'Hafs',
};
export const OTHER_SUBJECT = {
  id: '0199d0a0-0000-7000-8000-000000000052',
  nameAr: 'ورش',
  nameEn: 'Warsh',
};

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

/** A teacher's application as the request for another document reads and moves it (T155). */
export interface HeldApplication {
  status: 'in_review' | 'needs_document' | 'approved';
  note: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
}

interface Held {
  id: string;
  teacher: { userId: string; displayName: string };
  subject: { id: string; nameAr: string; nameEn: string };
  submittedWithApplication: boolean;
  createdAt: Date;
  status: ReviewStatus;
  documentId: string;
  holderName: string | null;
  riwaya: string | null;
  tariq: string | null;
  chain: { position: number; names: string[] }[];
  reviewReason: string | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
}

function nextId(): string {
  return randomUUID();
}

export class MemoryReviewStore implements CredentialReviewStore {
  readonly #held = new Map<string, Held>();
  readonly #approvedTeachers = new Set<string>();
  readonly granted: { teacherUserId: string; subjectIds: readonly string[] }[] = [];
  readonly administrators = new Map<string, string>([[ADMIN, 'هالة سعيد']]);
  /**
   * Each lock of a teacher's application and each move of a credential, in order (T161), each
   * read of whether the teacher is approved and each lock of the teacher's account (T142).
   */
  readonly journal: string[] = [];
  /** The teachers' applications, by teacher; a teacher with none planted has none to move (T155). */
  readonly applications = new Map<string, HeldApplication>();

  /** A credential waiting for review unless `status` says otherwise; its id. */
  plant(
    values: {
      teacherUserId?: string;
      displayName?: string;
      subject?: { id: string; nameAr: string; nameEn: string };
      status?: ReviewStatus;
      submittedWithApplication?: boolean;
      createdAt?: Date;
      reviewedAt?: Date | null;
    } = {},
  ): string {
    const id = nextId();
    this.#held.set(id, {
      id,
      teacher: {
        userId: values.teacherUserId ?? TEACHER,
        displayName: values.displayName ?? 'عمر فاروق',
      },
      subject: values.subject ?? SUBJECT,
      submittedWithApplication: values.submittedWithApplication ?? true,
      createdAt: values.createdAt ?? new Date('2026-10-18T09:00:00Z'),
      status: values.status ?? 'pending',
      documentId: nextId(),
      holderName: values.status === 'approved' ? 'عمر بن فاروق' : null,
      riwaya: values.status === 'approved' ? 'حفص عن عاصم' : null,
      tariq: values.status === 'approved' ? 'الشاطبية' : null,
      chain:
        values.status === 'approved'
          ? [['رسول الله ﷺ'], ['جبريل', 'ابن مسعود']].map((names, index) => ({
              position: index + 1,
              names,
            }))
          : [],
      reviewReason: null,
      reviewedAt: values.reviewedAt ?? null,
      reviewedByName: null,
    });
    return id;
  }

  approveTeacher(userId: string): void {
    this.#approvedTeachers.add(userId);
  }

  /** The teacher's application in `status`, no reviewer's note on it yet (T155). */
  applyingAs(userId: string, status: HeldApplication['status']): void {
    this.applications.set(userId, { status, note: null, decidedAt: null, decidedBy: null });
  }

  held(id: string): Held {
    const row = this.#held.get(id);
    if (row === undefined) throw new Error(`no credential ${id}`);
    return row;
  }

  #matching(filter: ReviewFilter): Held[] {
    const search = filter.search?.toLowerCase();
    const rows = [...this.#held.values()].filter(
      (row) =>
        row.status === filter.status &&
        (search === undefined || row.teacher.displayName.toLowerCase().includes(search)),
    );
    const decided = filter.status === 'approved' || filter.status === 'rejected';
    // ISO strings of one zone sort as their instants do.
    return rows.sort((a, b) =>
      decided
        ? (b.reviewedAt?.toISOString() ?? '').localeCompare(a.reviewedAt?.toISOString() ?? '')
        : a.createdAt.toISOString().localeCompare(b.createdAt.toISOString()),
    );
  }

  async page(
    _tx: Transaction,
    filter: ReviewFilter,
    skip: number,
    take: number,
  ): Promise<ReviewListRow[]> {
    return this.#matching(filter)
      .slice(skip, skip + take)
      .map(({ id, teacher, subject, submittedWithApplication, createdAt, status, reviewedAt }) => ({
        id,
        teacher,
        subject,
        submittedWithApplication,
        createdAt,
        status,
        reviewedAt,
      }));
  }

  async count(_tx: Transaction, filter: ReviewFilter): Promise<number> {
    return this.#matching(filter).length;
  }

  async read(_tx: Transaction, credentialId: string): Promise<ReviewRecord | null> {
    const row = this.#held.get(credentialId);
    return row === undefined ? null : structuredClone(row);
  }

  async hasApproved(_tx: Transaction, teacherUserId: string, subjectId: string): Promise<boolean> {
    return [...this.#held.values()].some(
      (row) =>
        row.teacher.userId === teacherUserId &&
        row.subject.id === subjectId &&
        row.status === 'approved',
    );
  }

  async approve(_tx: Transaction, approval: Approval): Promise<'approved' | 'moved' | 'taken'> {
    this.journal.push(`approve:${approval.credentialId}`);
    const row = this.#held.get(approval.credentialId);
    if (row?.status !== 'pending') return 'moved';
    if (await this.hasApproved(TX, row.teacher.userId, row.subject.id)) return 'taken';
    Object.assign(row, {
      status: 'approved',
      holderName: approval.holderName,
      riwaya: approval.riwaya,
      tariq: approval.tariq,
      chain: approval.chain.map((names, index) => ({ position: index + 1, names: [...names] })),
      reviewReason: null,
      reviewedAt: approval.at,
      reviewedByName: this.administrators.get(approval.adminId) ?? null,
    });
    return 'approved';
  }

  async lockAccount(_tx: Transaction, userId: string): Promise<void> {
    this.journal.push(`lock-account:${userId}`);
  }

  async lockApplication(_tx: Transaction, userId: string): Promise<void> {
    this.journal.push(`lock:${userId}`);
  }

  async decide(_tx: Transaction, decision: Decision): Promise<boolean> {
    this.journal.push(`decide:${decision.credentialId}`);
    const row = this.#held.get(decision.credentialId);
    if (row === undefined || !decision.from.includes(row.status)) return false;
    Object.assign(row, {
      status: decision.to,
      reviewReason: decision.reason,
      reviewedAt: decision.at,
      reviewedByName: this.administrators.get(decision.adminId) ?? null,
    });
    return true;
  }

  async correct(_tx: Transaction, correction: Correction): Promise<boolean> {
    const row = this.#held.get(correction.credentialId);
    if (row?.status !== 'approved') return false;
    Object.assign(row, {
      holderName: correction.holderName,
      riwaya: correction.riwaya,
      tariq: correction.tariq,
      ...(correction.chain === undefined
        ? {}
        : {
            chain: correction.chain.map((names, index) => ({
              position: index + 1,
              names: [...names],
            })),
          }),
    });
    return true;
  }

  async requestApplicationDocument(
    _tx: Transaction,
    userId: string,
    request: ApplicationDocumentRequest,
  ): Promise<boolean> {
    const application = this.applications.get(userId);
    if (application?.status !== 'in_review') return false;
    Object.assign(application, {
      status: 'needs_document',
      note: request.note,
      decidedAt: request.at,
      decidedBy: request.adminId,
    });
    return true;
  }

  async isApprovedTeacher(_tx: Transaction, userId: string): Promise<boolean> {
    this.journal.push(`approved-teacher:${userId}`);
    return this.#approvedTeachers.has(userId);
  }

  async grantSubjects(
    _tx: Transaction,
    teacherUserId: string,
    subjectIds: readonly string[],
  ): Promise<void> {
    this.granted.push({ teacherUserId, subjectIds: [...subjectIds] });
  }
}
