// T006 of specs/005-certification: the teacher's ijazah request (FR-603, FR-608, FR-627, FR-628;
// research R-403, R-404; P4 (a), DEC-72; the note under T006, Q1 to Q4, Q14, Q-A1 to Q-A4). The
// specs are ijazah-request.service.spec.ts's and tests/db-integrity/ijazah-requests.spec.ts's.
//
// SEND (`teacher.ijazahRequests.send`, keyed `run`, scope `teacher.ijazahRequests.send`):
//   1. a replay answers its stored outcome first (`completed`) and copies nothing;
//   2. the request's id is drawn and the teacher's current signature copied under
//      `ijazah-requests/<id>/signature.<ext>` through `StoragePort.read` and `put`, outside any
//      transaction, so no lock waits on the storage port (T003's precedent);
//   3. in the keyed transaction, the kernel row's order (specs/004-sessions/contracts/kernel.md, the
//      ijazah request's row): the enrollment read with no lock for its parties (they never change),
//      then `users` (the teacher and the student, one call, id order), then the enrollment, then the
//      credential (catalog's locked read), then the request's insert; lock, then read (rule 1): the
//      standing, the status, the bar, the name and the open requests are read under the locks.
//      FR-603's refusals, each one info line of ids and its reason, CONFLICT with its code:
//      `not_active`, `not_ijazah_track`, `student_barred`, `no_credential`, `no_signature`,
//      `request_open`, `already_issued`; an enrollment not the teacher's, not there, or not confirmed
//      or completed answers NOT_FOUND; a completion date after the teacher's today in the teacher's
//      zone is VALIDATION_FAILED;
//   4. the freeze: the chain (generations origin first, the holder name appended, FR-ISNAD-7), the
//      holder name, the printed riwaya and tariq (Q5 (c)) and the copy's key; `awaiting_student_name`
//      while the student holds no certificate name, `pending` otherwise;
//   5. a refused transaction, its commit included, removes the copy; a concurrent duplicate that
//      committed first is answered from its row and this copy removed;
//   6. the live event `ijazahRequest` to both parties, after the commit (the request's list).
//
// PREVIEW and GET read with no lock. THE PORTS, each on the caller's transaction:
//   - `EnrollmentIjazahRequests.of` (booking's): every enrollment's latest request in one read;
//   - `AwaitingNameRelease.release` (identity's, the student's `users` row already locked): the
//     student's waiting requests locked, then moved to `pending`;
//   - `OpenRequestsRefreeze.refreeze` (catalog's, the credential's row held by the correction's
//     write): the credential's open requests locked, then re-frozen from it (P4 (a)); the ijazah side
//     is T032's;
//   - the deletion's consequence (identity's `AccountConsequences`, the student's row locked): the
//     student's open requests locked, closed and their copies' keys cleared on the transaction, each
//     file removed once after the commit, a failed removal logged by ids and left to the orphan sweep
//     (the follow-up under T003; Q14 (a)). ⚠️ Automatic and final.
// Every line names ids and a reason, never a name, the chain or a key (R-SEC-2).
import type {
  EnrollmentIjazahRequest,
  IdempotentProcedure,
  IjazahRequestsGetInput,
  IjazahRequestsGetOutput,
  IjazahRequestsPreviewInput,
  IjazahRequestsPreviewOutput,
  IjazahRequestsSendInput,
  IjazahRequestsSendOutput,
  IjazahRequestStatus,
} from '@ijazah/contracts';
import { localDateIn } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { type LivePublisher, publisherOn } from '../../platform/live/live-publisher.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { CredentialChain } from '../catalog/index.js';
import type { AccountConsequence } from '../identity/index.js';

export type { CredentialChain };

/** The enrollment as the request reads it (booking's entry). */
export interface IjazahEnrollment {
  readonly id: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly subjectId: string;
  readonly track: 'recitation' | 'ijazah_track';
  readonly status: string;
}

/** A person's standing as identity reads it (`readStanding`). */
export interface RequestStanding {
  readonly accountStatus: string;
  readonly teacher: { readonly verificationStatus: string } | null;
}

/** A request as it is written at send. */
export interface NewIjazahRequest {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly subjectId: string;
  readonly completionDate: string;
  readonly language: 'ar' | 'en';
  status: IjazahRequestStatus;
  chainSnapshot: readonly (readonly string[])[];
  teacherNamePrinted: string;
  riwayaPrinted: string;
  tariqPrinted: string | null;
  signatureStorageKey: string | null;
}

/** What a re-freeze writes on an open request. */
export type RequestRefreeze = Pick<
  NewIjazahRequest,
  'chainSnapshot' | 'teacherNamePrinted' | 'riwayaPrinted' | 'tariqPrinted'
>;

/** A request as a party reads it. */
export interface RequestRead {
  readonly id: string;
  readonly enrollmentId: string;
  readonly status: IjazahRequestStatus;
  readonly reason: string | null;
  readonly ijazahId: string | null;
}

/** An open request and its copy's key. */
export interface OpenRequest {
  readonly id: string;
  readonly status: IjazahRequestStatus;
  readonly signatureStorageKey: string | null;
}

/** What the request reads, locks and writes, each on the call's transaction. */
export interface IjazahRequestStore {
  enrollmentOf(tx: Transaction, enrollmentId: string): Promise<IjazahEnrollment | null>;
  standingOf(tx: Transaction, userId: string): Promise<RequestStanding | null>;
  timezoneOf(tx: Transaction, userId: string): Promise<string | null>;
  /** The approved credential of the teacher's subject, with no lock (the preview). */
  chainOf(
    tx: Transaction,
    teacherUserId: string,
    subjectId: string,
  ): Promise<CredentialChain | null>;
  /** The same, locked FOR UPDATE and read under the lock (the send). */
  lockedChainOf(
    tx: Transaction,
    teacherUserId: string,
    subjectId: string,
  ): Promise<CredentialChain | null>;
  chainById(tx: Transaction, credentialId: string): Promise<CredentialChain | null>;
  certificateNameOf(tx: Transaction, studentUserId: string): Promise<string | null>;
  signatureKeyOf(tx: Transaction, teacherUserId: string): Promise<string | null>;
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  lockRequests(tx: Transaction, ids: readonly string[]): Promise<void>;
  hasOpenBar(tx: Transaction, userId: string): Promise<boolean>;
  hasOpenRequest(tx: Transaction, enrollmentId: string): Promise<boolean>;
  hasUnrevokedIjazah(tx: Transaction, enrollmentId: string): Promise<boolean>;
  insert(tx: Transaction, row: NewIjazahRequest): Promise<void>;
  latestAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, RequestRead>>;
  openOfStudent(tx: Transaction, studentUserId: string): Promise<readonly OpenRequest[]>;
  openOfCredential(
    tx: Transaction,
    teacherUserId: string,
    subjectId: string,
  ): Promise<readonly string[]>;
  releaseAwaiting(tx: Transaction, ids: readonly string[]): Promise<void>;
  refreezeOpen(tx: Transaction, ids: readonly string[], refreeze: RequestRefreeze): Promise<void>;
  closeOpen(tx: Transaction, ids: readonly string[]): Promise<void>;
}

/** The lines the request writes: ids and a reason. */
export interface IjazahRequestLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface IjazahRequestDependencies {
  readonly transactions: Transactions;
  readonly store: IjazahRequestStore;
  readonly storage: Pick<StoragePort, 'read' | 'put' | 'remove'>;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'completed'>;
  /** A new row's id, drawn by the database before the copy is stored (`row-id.ts`). */
  readonly drawId: () => Promise<string>;
  /** The database's clock on the transaction: the teacher's today. */
  readonly clock: (tx: Transaction) => Promise<Date>;
  readonly log: IjazahRequestLog;
}

/** An after-commit list a deletion binds to its transaction (`publisherOn`). */
export type AfterCommitList = Pick<LivePublisher, 'afterCommitDo'>;

const SEND_SCOPE: IdempotentProcedure = 'teacher.ijazahRequests.send';

/** The two types a signature is, and the copy's extension (T003's kind). */
const EXTENSION_OF: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/** The enrollment states a request may be sent from (R-404). */
const REQUESTABLE: ReadonlySet<string> = new Set(['confirmed', 'completed']);

type Refusal =
  | 'not_active'
  | 'not_ijazah_track'
  | 'no_credential'
  | 'no_signature'
  | 'student_barred'
  | 'request_open'
  | 'already_issued';

/** The copy stored before the transaction. */
interface StoredCopy {
  readonly key: string;
}

export class IjazahRequestService {
  readonly #dependencies: IjazahRequestDependencies;

  constructor(dependencies: IjazahRequestDependencies) {
    this.#dependencies = dependencies;
  }

  /** `teacher.ijazahRequests.preview`: the certificate as it will be filled (FR-IJAZAH-15). */
  async preview(
    teacherUserId: string,
    input: IjazahRequestsPreviewInput,
  ): Promise<IjazahRequestsPreviewOutput> {
    const { transactions, store } = this.#dependencies;
    return transactions.run(async (tx) => {
      const enrollment = await this.#teachersEnrollment(tx, teacherUserId, input.enrollmentId);
      const ids = { teacherUserId, enrollmentId: enrollment.id };
      const issueDate = await this.#checkedDate(tx, teacherUserId, input.completionDate, ids);
      if (enrollment.track !== 'ijazah_track') throw this.#refused(ids, 'not_ijazah_track');
      const chain = await store.chainOf(tx, teacherUserId, enrollment.subjectId);
      if (chain === null) throw this.#refused(ids, 'no_credential');
      return {
        chain: frozenChainOf(chain).map((names) => [...names]),
        teacherName: chain.holderName,
        riwaya: chain.riwaya,
        tariq: chain.tariq,
        studentName: await store.certificateNameOf(tx, enrollment.studentUserId),
        dates: { completionDate: input.completionDate, issueDate },
      };
    });
  }

  /** `teacher.ijazahRequests.send`: the request, frozen (this file's head, SEND). */
  async send(
    teacherUserId: string,
    { idempotencyKey, ...input }: IjazahRequestsSendInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<IjazahRequestsSendOutput> {
    const { idempotency, drawId } = this.#dependencies;
    const request = { scope: SEND_SCOPE, key: idempotencyKey, actorId: teacherUserId, input };
    const replayed = await idempotency.completed<IjazahRequestsSendOutput>(request);
    if (replayed !== undefined) return replayed;
    const requestId = await drawId();
    const copy = await this.#copySignature(teacherUserId, requestId);
    let outcome: IjazahRequestsSendOutput;
    try {
      outcome = await idempotency.run(request, async (tx) => {
        const sent = await this.#sendLocked(tx, teacherUserId, input, requestId, copy);
        live.afterCommit([teacherUserId, sent.studentUserId], {
          type: 'ijazahRequest',
          enrollmentId: input.enrollmentId,
        });
        return { requestId, status: sent.status };
      });
    } catch (error: unknown) {
      await this.#removeCopy(copy, { teacherUserId, requestId });
      throw error;
    }
    // A concurrent duplicate committed first: its request is the answer, this copy is unused.
    if (outcome.requestId !== requestId) await this.#removeCopy(copy, { teacherUserId, requestId });
    return outcome;
  }

  /** `teacher.ijazahRequests.get`: the enrollment's latest request, or null. */
  async get(
    teacherUserId: string,
    { enrollmentId }: IjazahRequestsGetInput,
  ): Promise<IjazahRequestsGetOutput> {
    const { transactions, store } = this.#dependencies;
    return transactions.run(async (tx) => {
      const enrollment = await store.enrollmentOf(tx, enrollmentId);
      if (enrollment === null || enrollment.teacherUserId !== teacherUserId) {
        throw new DomainError('NOT_FOUND');
      }
      const latest = (await store.latestAmong(tx, [enrollmentId])).get(enrollmentId);
      return { request: latest === undefined ? null : { requestId: latest.id, ...readOf(latest) } };
    });
  }

  /** `EnrollmentIjazahRequests.of` (booking's port): each enrollment's latest request, one read. */
  async of(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, EnrollmentIjazahRequest>> {
    if (enrollmentIds.length === 0) return new Map();
    const latest = await this.#dependencies.store.latestAmong(tx, enrollmentIds);
    return new Map([...latest].map(([enrollmentId, read]) => [enrollmentId, readOf(read)]));
  }

  /** `AwaitingNameRelease.release` (identity's port): the student's account is already locked. */
  async release(tx: Transaction, studentUserId: string): Promise<void> {
    const { store } = this.#dependencies;
    const waiting = (await store.openOfStudent(tx, studentUserId))
      .filter(({ status }) => status === 'awaiting_student_name')
      .map(({ id }) => id);
    if (waiting.length === 0) return;
    await store.lockRequests(tx, waiting);
    await store.releaseAwaiting(tx, waiting);
  }

  /** `OpenRequestsRefreeze.refreeze` (catalog's port): the credential's row is already held. */
  async refreeze(tx: Transaction, credentialId: string): Promise<void> {
    const { store } = this.#dependencies;
    const chain = await store.chainById(tx, credentialId);
    if (chain === null) return;
    const open = await store.openOfCredential(tx, chain.teacherUserId, chain.subjectId);
    if (open.length === 0) return;
    await store.lockRequests(tx, open);
    await store.refreezeOpen(tx, open, frozenOf(chain));
  }

  /**
   * The deletion's consequence (identity's `AccountConsequences`): a deleted student's open
   * requests closed. ⚠️ Automatic and final (this file's head).
   */
  deletionConsequence(): AccountConsequence {
    return async (tx, userId, cause) => {
      if (cause !== 'account_deleted') return;
      await this.closeOfDeletedStudent(tx, userId, publisherOn(tx));
    };
  }

  /** Closes the student's open requests on `tx`; each copy removed once `list` runs its work. */
  async closeOfDeletedStudent(
    tx: Transaction,
    studentUserId: string,
    list: AfterCommitList | undefined,
  ): Promise<void> {
    const { store, log } = this.#dependencies;
    const open = await store.openOfStudent(tx, studentUserId);
    if (open.length === 0) return;
    if (list?.afterCommitDo === undefined) {
      log.info(
        { studentUserId, reason: 'no_after_commit_list' },
        'An ijazah request close was refused',
      );
      throw new Error(
        "A deleted student's ijazah requests close on a transaction its caller bound an after-commit list to (T006, Q14), so each copy is removed only once the closing has committed.",
      );
    }
    const ids = open.map(({ id }) => id);
    await store.lockRequests(tx, ids);
    // Read again under the locks: a request decided meanwhile keeps its copy and its state.
    const closing = (await store.openOfStudent(tx, studentUserId)).filter(({ id }) =>
      ids.includes(id),
    );
    await store.closeOpen(
      tx,
      closing.map(({ id }) => id),
    );
    for (const { id } of closing) {
      log.info(
        { requestId: id, studentUserId, reason: 'student_deleted' },
        'An ijazah request was closed',
      );
    }
    list.afterCommitDo(() => {
      void this.#removeClosedCopies(closing, studentUserId);
    });
  }

  async #removeClosedCopies(closed: readonly OpenRequest[], studentUserId: string): Promise<void> {
    const { storage, log } = this.#dependencies;
    await Promise.all(
      closed.map(async ({ id, signatureStorageKey }) => {
        if (signatureStorageKey === null) return;
        try {
          await storage.remove(signatureStorageKey);
        } catch {
          log.warn(
            { requestId: id, studentUserId },
            "A closed ijazah request's signature copy could not be removed",
          );
        }
      }),
    );
  }

  /** The locked part of a send (this file's head, SEND, step 3 and 4). */
  async #sendLocked(
    tx: Transaction,
    teacherUserId: string,
    input: IjazahRequestsPreviewInput,
    requestId: string,
    copy: StoredCopy | null,
  ): Promise<{
    readonly status: 'awaiting_student_name' | 'pending';
    readonly studentUserId: string;
  }> {
    const { store } = this.#dependencies;
    const seen = await this.#teachersEnrollment(tx, teacherUserId, input.enrollmentId);
    const ids = { teacherUserId, enrollmentId: seen.id };
    await this.#checkedDate(tx, teacherUserId, input.completionDate, ids);
    await store.lockAccounts(tx, [seen.teacherUserId, seen.studentUserId]);
    await store.lockEnrollment(tx, seen.id);
    const enrollment = await this.#teachersEnrollment(tx, teacherUserId, seen.id);
    if (!isActiveTeacher(await store.standingOf(tx, teacherUserId))) {
      throw this.#refused(ids, 'not_active');
    }
    if (enrollment.track !== 'ijazah_track') throw this.#refused(ids, 'not_ijazah_track');
    if (await store.hasOpenBar(tx, enrollment.studentUserId)) {
      throw this.#refused(ids, 'student_barred');
    }
    const chain = await store.lockedChainOf(tx, teacherUserId, enrollment.subjectId);
    if (chain === null) throw this.#refused(ids, 'no_credential');
    if (copy === null) throw this.#refused(ids, 'no_signature');
    if (await store.hasOpenRequest(tx, enrollment.id)) throw this.#refused(ids, 'request_open');
    if (await store.hasUnrevokedIjazah(tx, enrollment.id)) {
      throw this.#refused(ids, 'already_issued');
    }
    const named = (await store.certificateNameOf(tx, enrollment.studentUserId)) !== null;
    const status = named ? 'pending' : 'awaiting_student_name';
    await store.insert(tx, {
      id: requestId,
      enrollmentId: enrollment.id,
      teacherUserId,
      studentUserId: enrollment.studentUserId,
      subjectId: enrollment.subjectId,
      completionDate: input.completionDate,
      language: input.language,
      status,
      ...frozenOf(chain),
      signatureStorageKey: copy.key,
    });
    this.#dependencies.log.info({ ...ids, requestId, status }, 'An ijazah request was sent');
    return { status, studentUserId: enrollment.studentUserId };
  }

  /** The teacher's own enrollment, confirmed or completed; NOT_FOUND otherwise, logged. */
  async #teachersEnrollment(
    tx: Transaction,
    teacherUserId: string,
    enrollmentId: string,
  ): Promise<IjazahEnrollment> {
    const enrollment = await this.#dependencies.store.enrollmentOf(tx, enrollmentId);
    if (enrollment === null || enrollment.teacherUserId !== teacherUserId) {
      throw this.#notFound({ teacherUserId, enrollmentId }, 'not_found');
    }
    if (!REQUESTABLE.has(enrollment.status)) {
      throw this.#notFound({ teacherUserId, enrollmentId }, 'enrollment_not_requestable');
    }
    return enrollment;
  }

  /** The teacher's today in the teacher's zone, refusing a completion date after it. */
  async #checkedDate(
    tx: Transaction,
    teacherUserId: string,
    completionDate: string,
    ids: Readonly<Record<string, string>>,
  ): Promise<string> {
    const { store, clock, log } = this.#dependencies;
    const timezone = await store.timezoneOf(tx, teacherUserId);
    // A signed-in teacher's account is live (the caller kind read it on this request).
    if (timezone === null)
      throw new Error('ijazah request: a signed-in teacher without an account');
    const today = localDateIn(await clock(tx), timezone);
    if (completionDate > today) {
      log.info({ ...ids, reason: 'completion_in_future' }, 'An ijazah request was refused');
      throw markRefusalLogged(
        new DomainError('VALIDATION_FAILED', undefined, {
          details: [{ path: 'completionDate', code: 'in_future' }],
        }),
      );
    }
    return today;
  }

  /** The signature's copy, stored outside any transaction; null without a signature. */
  async #copySignature(teacherUserId: string, requestId: string): Promise<StoredCopy | null> {
    const { transactions, store, storage } = this.#dependencies;
    const current = await transactions.run((tx) => store.signatureKeyOf(tx, teacherUserId));
    if (current === null) return null;
    const { body, contentType } = await storage.read(current);
    const extension = EXTENSION_OF[contentType];
    if (extension === undefined) {
      throw new Error('ijazah request: a stored signature that is neither a PNG nor a JPEG');
    }
    const key = `ijazah-requests/${requestId}/signature.${extension}`;
    await storage.put(key, body, contentType);
    return { key };
  }

  async #removeCopy(
    copy: StoredCopy | null,
    ids: { readonly teacherUserId: string; readonly requestId: string },
  ): Promise<void> {
    if (copy === null) return;
    try {
      await this.#dependencies.storage.remove(copy.key);
    } catch {
      this.#dependencies.log.warn(
        ids,
        "A refused ijazah request's signature copy could not be removed",
      );
    }
  }

  #refused(ids: Readonly<Record<string, string>>, reason: Refusal): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'An ijazah request was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'enrollmentId', code: reason }] }),
    );
  }

  #notFound(ids: Readonly<Record<string, string>>, reason: string): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'An ijazah request was refused');
    return markRefusalLogged(new DomainError('NOT_FOUND'));
  }
}

/** An approved teacher whose account is active (R-404; FR-627: «only by a teacher who is active»). */
function isActiveTeacher(standing: RequestStanding | null): boolean {
  return (
    standing?.accountStatus === 'active' && standing.teacher?.verificationStatus === 'approved'
  );
}

/** The chain as printed: the credential's generations, origin first, the holder appended. */
function frozenChainOf(chain: CredentialChain): readonly (readonly string[])[] {
  return [...chain.generations, [chain.holderName]];
}

function frozenOf(chain: CredentialChain): RequestRefreeze {
  return {
    chainSnapshot: frozenChainOf(chain),
    teacherNamePrinted: chain.holderName,
    riwayaPrinted: chain.riwaya,
    tariqPrinted: chain.tariq,
  };
}

/** A request as a party reads it: the reason once rejected, the ijazah once approved. */
function readOf(read: RequestRead): EnrollmentIjazahRequest {
  return {
    status: read.status,
    ...(read.reason === null ? {} : { reason: read.reason }),
    ...(read.ijazahId === null ? {} : { ijazahId: read.ijazahId }),
  };
}
