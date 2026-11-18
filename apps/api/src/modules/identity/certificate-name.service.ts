// T004 of specs/005-certification (FR-602; ADR 0019 D1; research R-411; the note under T004, Q4 (a)):
// the student's certificate name, `users.certificate_name`, as the certificate prints it. The specs
// are certificate-name.service.spec.ts's and, for an issued certificate, those of
// tests/db-integrity/certificate-name.spec.ts.
//
// - `setOwn` is `account.certificateName.set`: the student, once. Keyed in its own transaction
//   (`run`, scope `account.certificateName.set`, the student the actor); a name already held is
//   refused `CONFLICT` `already_set` (FR-602: «entered once; afterwards only an administrator»).
// - `setByAdministrator` is `users.setCertificateName`: an administrator sets or changes it at the
//   student's request, keyed on the administrator kind's transaction (`runOn`, scope
//   `users.setCertificateName`); the router audits it with the reason and no name. The key's stored
//   outcome is null, so the name lives in no other table.
// - Both: the account's lock first (`lockAccount`, the account's place in the one order of
//   `specs/004-sessions/contracts/kernel.md`), then the account read under it (a live student's, else
//   `NOT_FOUND`), the write, then the student's requests waiting for the name handed to the port
//   `AwaitingNameRelease` on the same transaction: the user first, then the requests, which T006
//   binds. Identity imports no module (`docs/ARCHITECTURE.md:183`) and certification imports
//   identity, so `main.ts` hands the port in, bound to certification's entry from T006 and to a no-op
//   until then (`docs/ARCHITECTURE.md:197`, the dependencies against the arrows).
// - The account's name only: an issued certificate prints its own snapshot
//   (`ijazahs.student_name_printed`), which nothing here reads or writes (ADR 0019 D1).
// - Every refusal logs the ids and its reason only, never the name.
import type { CertificateNameSetInput, CertificateNameSetOutput } from '@ijazah/contracts';
import type { UsersSetCertificateNameInput } from '@ijazah/contracts/admin';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { bindToTransaction, type LivePublisher } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import { certificateNameHolderOf, writeCertificateName } from './certificate-name.repository.js';
import { lockAccount } from './standing.repository.js';

/**
 * The student's ijazah requests waiting for the name (`awaiting_student_name`) moved to `pending`,
 * on the setter's transaction, after the account's lock (T004; certification's, from T006).
 */
export interface AwaitingNameRelease {
  release(tx: Transaction, studentUserId: string): Promise<void>;
}

/** A live account's certificate name, and whether the account is a student's. */
export interface CertificateNameHolder {
  readonly student: boolean;
  readonly certificateName: string | null;
}

/** Where the name is kept: this module's `users` row, over its repository. */
export interface CertificateNameStore {
  /** The account's `users` row locked until the transaction ends. */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** The live account's holder; null for no account or a deleted one. */
  read(tx: Transaction, userId: string): Promise<CertificateNameHolder | null>;
  write(tx: Transaction, userId: string, name: string): Promise<void>;
}

export interface CertificateNameDependencies {
  readonly store: CertificateNameStore;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'runOn'>;
  readonly awaitingNameRelease: AwaitingNameRelease;
  readonly log: Pick<Logger, 'info'>;
}

export class CertificateNameService {
  readonly #dependencies: CertificateNameDependencies;

  constructor(dependencies: CertificateNameDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * `account.certificateName.set`: the student's own name, once. 005:T019 (Q-T1 (a)): the request's
   * list `live` is bound to the keyed transaction while its work runs, so the port publishes the
   * released requests' events on it (sent once the procedure resolves, after the commit), and is
   * unbound when the work ends, refused or not (sessions/cancellation.service.ts' `bound`). A
   * replay runs no work, so it publishes nothing.
   */
  async setOwn(
    studentUserId: string,
    { name, idempotencyKey }: CertificateNameSetInput,
    live: LivePublisher,
  ): Promise<CertificateNameSetOutput> {
    return this.#dependencies.idempotency.run(
      {
        scope: 'account.certificateName.set',
        key: idempotencyKey,
        actorId: studentUserId,
        input: { name },
      },
      async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          const holder = await this.#lockedStudent(tx, studentUserId, { userId: studentUserId });
          if (holder.certificateName !== null) {
            this.#refusal({ userId: studentUserId }, 'already_set');
            throw markRefusalLogged(
              new DomainError('CONFLICT', undefined, {
                details: [{ path: 'certificateName', code: 'already_set' }],
              }),
            );
          }
          await this.#setLocked(tx, studentUserId, name);
          return { name };
        } finally {
          unbind();
        }
      },
    );
  }

  /** `users.setCertificateName`: an administrator sets or changes it, on the kind's transaction. */
  async setByAdministrator(
    tx: Transaction,
    adminId: string,
    { targetUserId, name, reason, idempotencyKey }: UsersSetCertificateNameInput,
  ): Promise<{ readonly replayed: boolean }> {
    const { replayed } = await this.#dependencies.idempotency.runOn(
      tx,
      {
        scope: 'users.setCertificateName',
        key: idempotencyKey,
        actorId: adminId,
        input: { targetUserId, name, reason },
      },
      async (keyed) => {
        await this.#lockedStudent(keyed, targetUserId, { adminId, userId: targetUserId });
        await this.#setLocked(keyed, targetUserId, name);
        this.#dependencies.log.info(
          { adminId, userId: targetUserId },
          'An administrator set a certificate name',
        );
        return null;
      },
    );
    return { replayed };
  }

  /** The account locked, then read under the lock: a live student's, else `NOT_FOUND`. */
  async #lockedStudent(
    tx: Transaction,
    userId: string,
    ids: Readonly<Record<string, string>>,
  ): Promise<CertificateNameHolder> {
    const { store } = this.#dependencies;
    await store.lockAccount(tx, userId);
    const holder = await store.read(tx, userId);
    if (holder === null || !holder.student) {
      this.#refusal(ids, 'not_student');
      throw markRefusalLogged(new DomainError('NOT_FOUND'));
    }
    return holder;
  }

  /** The name written, then the student's waiting requests released, on the same transaction. */
  async #setLocked(tx: Transaction, studentUserId: string, name: string): Promise<void> {
    await this.#dependencies.store.write(tx, studentUserId, name);
    await this.#dependencies.awaitingNameRelease.release(tx, studentUserId);
  }

  /** A refusal's one info line: the ids and its reason, never the name. */
  #refusal(ids: Readonly<Record<string, string>>, reason: 'already_set' | 'not_student'): void {
    this.#dependencies.log.info({ ...ids, reason }, 'A certificate name was refused');
  }
}

/** The store over this module's repository: the account's lock, the holder's read, the write. */
export function certificateNameStoreOver(): CertificateNameStore {
  return {
    lockAccount,
    read: certificateNameHolderOf,
    write: writeCertificateName,
  };
}
