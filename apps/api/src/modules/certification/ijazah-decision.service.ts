// T007 of specs/005-certification: the administrators' review of an ijazah request (FR-604, FR-605,
// FR-610, FR-628; research R-402; ADR 0013, ADR 0019 D1; the note under T007, Q7 (a), Q10 (a),
// Q15 (a); the lane rules' «Issue (T007)» and «Locks»). The specs are
// ijazah-decision.service.spec.ts's and tests/db-integrity/ijazah-decisions.spec.ts's.
//
// Every call runs on the administrator kind's transaction (`adminProcedure`): the kind throttles
// before it, records the audit entry on it, and runs the request's after-commit list once it has
// committed (`publisherOn(tx)`, T063, T081's `afterCommitDo`).
//
// APPROVE (`ijazahRequests.approve`, keyed on the kind's transaction, `runOn`, scope
// `ijazahRequests.approve`):
//   1. a replay answers the first approval's ijazah and writes, publishes and enqueues nothing;
//   2. the kernel row's order (specs/004-sessions/contracts/kernel.md, the ijazah request's row), a
//      subset of it: the request read with no lock for its parties (they never change), then both
//      parties' `users` rows (the teacher and the student, one call, id order: the ijazah's insert
//      takes FOR KEY SHARE on the teacher's row, so the student alone deadlocks with a send, the
//      review's MAJOR of 2026-11-17), then the request; lock, then read (rule 1): the request, the
//      bar and the certificate name are read under the locks;
//   3. refused CONFLICT `not_pending` once the request is no longer pending (decided, closed, or
//      still waiting for the student's name), and `student_barred` while an `ijazah_bars` row of the
//      student has no `lifted_at` (FR-610, Q7 (a): the administrator rejects it with a reason);
//      each one info line of ids and its reason; an unknown request is NOT_FOUND;
//   4. the `ijazahs` row: its id drawn by the database; the number and the verification token from
//      `platform/guards/identifiers.ts` (R-DB-6), the token hashed at once and never stored, answered
//      or logged in clear (R-DB-7, Q15 (a): minted so v1.1's page can verify, never printed in
//      v1.0); `mode` `generated` (ADR 0013 D3), `paper_copy_intended` false (FR-IJAZAH-5 deferred,
//      ADR 0016); the frozen chain, the teacher's printed name and the printed riwaya and tariq
//      copied from the request (ADR 0019 D1, Q5 (c)); the student's printed name read now (FR-605);
//      the completion date always copied from the request (the render job cannot print an ijazah
//      without one, `UnprintableIjazah`); `granted_at` the database's now, the issue date; generation
//      0's key `certificates/<ijazahId>/0.pdf` reserved in `certificate_storage_key` (Q6 (a));
//   5. the request `approved`, decided by the administrator, now;
//   6. after the commit, never inside it (R-API-13): the live event `ijazahRequest` to both parties,
//      then `render-certificate` enqueued for generation 0; a failed enqueue is logged by ids and
//      leaves the ijazah unrendered and visible as such (T032's `ijazahs.rerender` is its fix).
//
// REJECT (`ijazahRequests.reject`, keyed `runOn`, scope `ijazahRequests.reject`): the request locked,
// then read; refused `not_pending` unless open (pending, or still waiting for the student's name);
// `rejected` with the reason, decided by the administrator, the copy's key cleared on the
// transaction; after the commit the live event to both parties and ⚠️ the copy's file removed once
// (final), a failed removal logged by ids and left to the orphan sweep (Q14 (a), T006's close).
//
// LIST and DETAIL read with no lock. The detail answers the teacher's standing status; its reason
// is the admin module's, read from the audit log (Q10 (a)).
//
// Every line names ids and a reason, never a name, the chain, a key or the token (R-SEC-2).
import type {
  AdminIjazahRequestsApproveInput,
  AdminIjazahRequestsApproveOutput,
  AdminIjazahRequestsGetInput,
  AdminIjazahRequestsGetOutput,
  AdminIjazahRequestsListInput,
  AdminIjazahRequestsListOutput,
  AdminIjazahRequestsRejectInput,
  IjazahDecisionRefusal,
  TeacherStandingStatus,
} from '@ijazah/contracts/admin';
import type { IdempotentProcedure, IjazahRequestStatus, LiveEvent } from '@ijazah/contracts';
import { calendarDateOf } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';

/** The request as a decision reads it. */
export interface DecisionRequest {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly subjectId: string;
  readonly status: IjazahRequestStatus;
  /** The `date` column, midnight UTC. */
  readonly completionDate: Date;
  readonly language: 'ar' | 'en';
  /** As frozen at send (jsonb): generations, origin first, the teacher appended. */
  readonly chainSnapshot: unknown;
  readonly teacherNamePrinted: string;
  readonly riwayaPrinted: string;
  readonly tariqPrinted: string | null;
  readonly signatureStorageKey: string | null;
  readonly reason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

/** The ijazah approval writes (ERD §8, `ijazahs`). */
export interface NewIjazah {
  readonly id: string;
  readonly certificateNumber: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly mode: 'generated';
  readonly language: 'ar' | 'en';
  readonly chainSnapshot: unknown;
  readonly certificateStorageKey: string;
  readonly paperCopyIntended: false;
  readonly verificationTokenHash: string;
  readonly grantedAt: Date;
  readonly requestId: string;
  readonly issuedByAdminId: string;
  readonly studentNamePrinted: string;
  readonly teacherNamePrinted: string;
  readonly riwayaPrinted: string;
  readonly tariqPrinted: string | null;
  readonly completionDate: Date;
}

/** One page of the queue. */
export interface RequestPageQuery {
  readonly status?: IjazahRequestStatus | undefined;
  readonly after?: string | undefined;
  readonly take: number;
}

/** A party as identity reads it (`sessionPartiesOf`): absent once deleted. */
export interface DecisionParty {
  readonly displayName: string;
  readonly accountStatus: string;
  readonly teacherApproved: boolean;
}

/** A subject's names (catalog's `subjectSummariesOf`). */
export interface DecisionSubject {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

/** What the review reads, locks and writes, each on the call's transaction. */
export interface IjazahDecisionStore {
  requestOf(tx: Transaction, requestId: string): Promise<DecisionRequest | null>;
  page(tx: Transaction, query: RequestPageQuery): Promise<readonly DecisionRequest[]>;
  ijazahOf(tx: Transaction, requestId: string): Promise<string | null>;
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, DecisionParty>>;
  subjectsOf(
    tx: Transaction,
    subjectIds: readonly string[],
  ): Promise<ReadonlyMap<string, DecisionSubject>>;
  certificateNameOf(tx: Transaction, studentUserId: string): Promise<string | null>;
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockRequests(tx: Transaction, ids: readonly string[]): Promise<void>;
  hasOpenBar(tx: Transaction, userId: string): Promise<boolean>;
  insertIjazah(tx: Transaction, row: NewIjazah): Promise<void>;
  markApproved(tx: Transaction, requestId: string, adminId: string, at: Date): Promise<boolean>;
  markRejected(
    tx: Transaction,
    requestId: string,
    adminId: string,
    reason: string,
    at: Date,
  ): Promise<boolean>;
}

/** Where `render-certificate` is enqueued, bound by `main.ts` (contracts/jobs.md). */
export interface RenderQueue {
  enqueue(ijazahId: string, generation: number): Promise<void>;
}

/** The two public identifiers and the token's hash (`platform/guards/identifiers.ts`, R-DB-6, R-DB-7). */
export interface IjazahMint {
  certificateNumber(): string;
  verificationToken(): string;
  hashToken(token: string): string;
}

/** The lines the review writes: ids and a reason. */
export interface IjazahDecisionLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface IjazahDecisionDependencies {
  readonly store: IjazahDecisionStore;
  readonly storage: Pick<StoragePort, 'temporaryLink' | 'remove'>;
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly renders: RenderQueue;
  readonly mint: IjazahMint;
  /** A new row's id, drawn by the database on the transaction (`row-id.ts`). */
  readonly drawId: (tx: Transaction) => Promise<string>;
  /** The database's clock on the transaction. */
  readonly clock: (tx: Transaction) => Promise<Date>;
  readonly log: IjazahDecisionLog;
}

/** The request's detail, its teacher named for the admin module's standing reason (Q10 (a)). */
export type RequestDetail = AdminIjazahRequestsGetOutput & { readonly teacherUserId: string };

export const APPROVE_SCOPE: IdempotentProcedure = 'ijazahRequests.approve';
export const REJECT_SCOPE: IdempotentProcedure = 'ijazahRequests.reject';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** An open request: waiting for the student's name, or pending the administrators' decision. */
const OPEN: ReadonlySet<IjazahRequestStatus> = new Set(['awaiting_student_name', 'pending']);

/** Generation 0's key, reserved at approval; the job renders under it (Q6 (a)). */
function firstRenderKey(ijazahId: string): string {
  return `certificates/${ijazahId}/0.pdf`;
}

export class IjazahDecisionService {
  readonly #dependencies: IjazahDecisionDependencies;

  constructor(dependencies: IjazahDecisionDependencies) {
    this.#dependencies = dependencies;
  }

  /** `ijazahRequests.list`: the queue in the order of sending, by status, after a cursor. */
  async list(
    tx: Transaction,
    _adminId: string,
    { status, cursor }: AdminIjazahRequestsListInput,
  ): Promise<AdminIjazahRequestsListOutput> {
    const { store, settings } = this.#dependencies;
    const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const read = await store.page(tx, { status, after: cursor, take: pageSize + 1 });
    const page = read.slice(0, pageSize);
    const [parties, subjects] = await Promise.all([
      store.partiesOf(tx, [
        ...new Set(
          page.flatMap(({ teacherUserId, studentUserId }) => [teacherUserId, studentUserId]),
        ),
      ]),
      store.subjectsOf(tx, [...new Set(page.map(({ subjectId }) => subjectId))]),
    ]);
    const last = page.at(-1);
    return {
      items: page.map((request) => rowOf(request, parties, subjects)),
      ...(read.length > pageSize && last !== undefined ? { nextCursor: last.id } : {}),
    };
  }

  /** `ijazahRequests.get`'s certification half: the request as frozen, the standing's status. */
  async detail(
    tx: Transaction,
    adminId: string,
    { requestId }: AdminIjazahRequestsGetInput,
  ): Promise<RequestDetail> {
    const { store, storage, settings } = this.#dependencies;
    const request = await store.requestOf(tx, requestId);
    if (request === null) throw this.#notFound({ adminId, requestId });
    const [parties, subjects, studentName, ijazahId] = await Promise.all([
      store.partiesOf(tx, [request.teacherUserId, request.studentUserId]),
      store.subjectsOf(tx, [request.subjectId]),
      store.certificateNameOf(tx, request.studentUserId),
      request.status === 'approved' ? store.ijazahOf(tx, requestId) : Promise.resolve(null),
    ]);
    const signatureLink =
      request.signatureStorageKey === null
        ? null
        : await storage.temporaryLink(
            request.signatureStorageKey,
            await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl),
          );
    return {
      ...rowOf(request, parties, subjects),
      teacherUserId: request.teacherUserId,
      completionDate: calendarDateOf(request.completionDate),
      language: request.language,
      chain: request.chainSnapshot as string[][],
      teacherNamePrinted: request.teacherNamePrinted,
      studentName,
      riwaya: request.riwayaPrinted,
      tariq: request.tariqPrinted,
      signatureLink,
      ...(request.reason === null ? {} : { reason: request.reason }),
      ...(request.decidedAt === null ? {} : { decidedAt: request.decidedAt.toISOString() }),
      ...(ijazahId === null ? {} : { ijazahId }),
    };
  }

  /** `ijazahRequests.approve`: one ijazah, issued from the frozen request (this file's head). */
  async approve(
    tx: Transaction,
    adminId: string,
    { requestId, idempotencyKey }: AdminIjazahRequestsApproveInput,
  ): Promise<{ readonly answer: AdminIjazahRequestsApproveOutput; readonly replayed: boolean }> {
    const list = this.#afterCommitList(tx, { adminId, requestId });
    const request = {
      scope: APPROVE_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { requestId },
    };
    const { outcome, replayed } =
      await this.#dependencies.idempotency.runOn<AdminIjazahRequestsApproveOutput>(
        tx,
        request,
        (keyed) => this.#approveLocked(keyed, adminId, requestId, list),
      );
    return { answer: outcome, replayed };
  }

  /** `ijazahRequests.reject`: a reason, the request `rejected`, its copy erased (this file's head). */
  async reject(
    tx: Transaction,
    adminId: string,
    { requestId, reason, idempotencyKey }: AdminIjazahRequestsRejectInput,
  ): Promise<{ readonly replayed: boolean }> {
    const list = this.#afterCommitList(tx, { adminId, requestId });
    const keyed = {
      scope: REJECT_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { requestId, reason },
    };
    const { replayed } = await this.#dependencies.idempotency.runOn<null>(tx, keyed, async (on) => {
      await this.#rejectLocked(on, adminId, requestId, reason, list);
      return null;
    });
    return { replayed };
  }

  async #approveLocked(
    tx: Transaction,
    adminId: string,
    requestId: string,
    list: AfterCommitList,
  ): Promise<AdminIjazahRequestsApproveOutput> {
    const { store, mint, drawId, clock, log } = this.#dependencies;
    const ids = { adminId, requestId };
    const seen = await store.requestOf(tx, requestId);
    if (seen === null) throw this.#notFound(ids);
    // Both parties, one call, id order: the insert below takes FOR KEY SHARE on the teacher's row
    // (its FK), and a send holds the teacher FOR UPDATE while it waits for the student (the review's
    // MAJOR, 2026-11-17: the student alone deadlocked with a send of another enrollment).
    await store.lockAccounts(tx, [seen.teacherUserId, seen.studentUserId]);
    await store.lockRequests(tx, [requestId]);
    const request = await store.requestOf(tx, requestId);
    if (request?.status !== 'pending') throw this.#refused(ids, 'not_pending');
    if (await store.hasOpenBar(tx, request.studentUserId)) {
      throw this.#refused(ids, 'student_barred');
    }
    const studentName = await store.certificateNameOf(tx, request.studentUserId);
    // A pending request's student holds a name: it moves to `pending` only once one is set (FR-602),
    // and a deletion closes it.
    if (studentName === null) {
      throw new Error('ijazah approval: a pending request whose student holds no certificate name');
    }
    const ijazahId = await drawId(tx);
    const certificateNumber = mint.certificateNumber();
    const at = await clock(tx);
    await store.insertIjazah(tx, {
      id: ijazahId,
      certificateNumber,
      enrollmentId: request.enrollmentId,
      studentUserId: request.studentUserId,
      teacherUserId: request.teacherUserId,
      subjectId: request.subjectId,
      mode: 'generated',
      language: request.language,
      chainSnapshot: request.chainSnapshot,
      certificateStorageKey: firstRenderKey(ijazahId),
      paperCopyIntended: false,
      // Q15 (a): the token is hashed where it is minted and goes nowhere else.
      verificationTokenHash: mint.hashToken(mint.verificationToken()),
      grantedAt: at,
      requestId,
      issuedByAdminId: adminId,
      studentNamePrinted: studentName,
      teacherNamePrinted: request.teacherNamePrinted,
      riwayaPrinted: request.riwayaPrinted,
      tariqPrinted: request.tariqPrinted,
      completionDate: request.completionDate,
    });
    // Under the request's lock its status was read `pending`, so this write cannot miss.
    if (!(await store.markApproved(tx, requestId, adminId, at))) {
      throw new Error('ijazah approval: a locked pending request was not moved to approved');
    }
    log.info({ ...ids, ijazahId, reason: 'approved' }, 'An ijazah was issued');
    list.afterCommit([request.teacherUserId, request.studentUserId], {
      type: 'ijazahRequest',
      enrollmentId: request.enrollmentId,
    });
    list.afterCommitDo(() => {
      void this.#enqueueRender(ijazahId, requestId);
    });
    return { ijazahId, certificateNumber };
  }

  async #rejectLocked(
    tx: Transaction,
    adminId: string,
    requestId: string,
    reason: string,
    list: AfterCommitList,
  ): Promise<void> {
    const { store, clock, log } = this.#dependencies;
    const ids = { adminId, requestId };
    const seen = await store.requestOf(tx, requestId);
    if (seen === null) throw this.#notFound(ids);
    await store.lockRequests(tx, [requestId]);
    const request = await store.requestOf(tx, requestId);
    if (request === null || !OPEN.has(request.status)) throw this.#refused(ids, 'not_pending');
    const { teacherUserId, studentUserId, enrollmentId, signatureStorageKey: copy } = request;
    if (!(await store.markRejected(tx, requestId, adminId, reason, await clock(tx)))) {
      throw new Error('ijazah rejection: a locked open request was not moved to rejected');
    }
    log.info({ ...ids, reason: 'rejected' }, 'An ijazah request was rejected');
    list.afterCommit([teacherUserId, studentUserId], { type: 'ijazahRequest', enrollmentId });
    if (copy !== null) {
      list.afterCommitDo(() => {
        void this.#removeCopy(copy, requestId);
      });
    }
  }

  /** The request's after-commit list (the kind's, through the transaction), or a refusal. */
  #afterCommitList(tx: Transaction, ids: Readonly<Record<string, string>>): AfterCommitList {
    const list = publisherOn(tx);
    if (list?.afterCommitDo === undefined) {
      this.#dependencies.log.info(
        { ...ids, reason: 'no_after_commit_list' },
        'An ijazah decision was refused',
      );
      throw new Error(
        'An ijazah decision runs on a transaction its caller bound an after-commit list to (T007, R-API-13), so the render is enqueued and the copy removed only once the decision has committed.',
      );
    }
    return {
      afterCommit: list.afterCommit.bind(list),
      afterCommitDo: list.afterCommitDo.bind(list),
    };
  }

  async #enqueueRender(ijazahId: string, requestId: string): Promise<void> {
    try {
      await this.#dependencies.renders.enqueue(ijazahId, 0);
    } catch {
      this.#dependencies.log.warn(
        { ijazahId, requestId, reason: 'enqueue_failed' },
        "An issued ijazah's rendering could not be queued",
      );
    }
  }

  async #removeCopy(key: string, requestId: string): Promise<void> {
    try {
      await this.#dependencies.storage.remove(key);
    } catch {
      this.#dependencies.log.warn(
        { requestId, reason: 'copy_not_removed' },
        "A rejected ijazah request's signature copy could not be removed",
      );
    }
  }

  #refused(ids: Readonly<Record<string, string>>, reason: IjazahDecisionRefusal): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'An ijazah decision was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'requestId', code: reason }] }),
    );
  }

  #notFound(ids: Readonly<Record<string, string>>): DomainError {
    this.#dependencies.log.info({ ...ids, reason: 'not_found' }, 'An ijazah decision was refused');
    return markRefusalLogged(new DomainError('NOT_FOUND'));
  }
}

/** The kind's list, both halves required. */
interface AfterCommitList {
  afterCommit(to: readonly string[], event: LiveEvent): void;
  afterCommitDo(action: () => void): void;
}

/** A request as a list row reads it. */
function rowOf(
  request: DecisionRequest,
  parties: ReadonlyMap<string, DecisionParty>,
  subjects: ReadonlyMap<string, DecisionSubject>,
): AdminIjazahRequestsListOutput['items'][number] {
  const subject = subjects.get(request.subjectId);
  // The FK holds the subject; a missing one is a broken read, never a row to hide.
  if (subject === undefined)
    throw new Error('ijazah request: a subject the catalog does not answer');
  const teacher = parties.get(request.teacherUserId);
  return {
    requestId: request.id,
    enrollmentId: request.enrollmentId,
    teacher: { userId: request.teacherUserId, displayName: teacher?.displayName ?? null },
    student: {
      userId: request.studentUserId,
      displayName: parties.get(request.studentUserId)?.displayName ?? null,
    },
    subject,
    status: request.status,
    sentAt: request.createdAt.toISOString(),
    teacherStanding: { status: standingStatusOf(teacher) },
  };
}

/** The teacher's standing now (FR-628): the account first, then the approval, or gone. */
function standingStatusOf(party: DecisionParty | undefined): TeacherStandingStatus {
  if (party === undefined) return 'deleted';
  switch (party.accountStatus) {
    case 'banned':
      return 'banned';
    case 'suspended':
      return 'suspended';
    case 'verification_required':
      return 'verification_required';
    default:
      return party.teacherApproved ? 'active' : 'revoked';
  }
}

export type { IjazahDecisionRefusal, TeacherStandingStatus };
