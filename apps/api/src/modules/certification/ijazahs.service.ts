// T010 of specs/005-certification: an administrator's ijazahs, their revocation and the bar (FR-609,
// FR-610; research R-412; R-HONEST-6; the note under T010, Q12 (a); the lane rules' «Revoke and bar
// (T010)» and «Locks»). The specs are ijazahs.service.spec.ts's and
// tests/db-integrity/ijazahs.spec.ts's.
//
// Every call runs on the administrator kind's transaction (`adminProcedure`): the kind throttles
// before it, records the audit entry on it, and runs the request's after-commit list once it has
// committed (`publisherOn(tx)`).
//
// LIST and GET read with no lock. Every ijazah is answered, revoked included; a revoked one's status
// is `revoked` whatever else it holds, so it is never shown as valid (R-HONEST-6). `get` adds a
// signed link (`document_link_ttl_seconds`) to the current generation's PDF once `rendered_at` is
// set, revoked or not (R-412); none before, when the key names a file not yet written.
//
// REVOKE (`ijazahs.revoke`, keyed `runOn`, scope `ijazahs.revoke`): the ijazah locked, then read
// (rule 1; the kernel row's last lock, the only row written); refused `already_revoked` (⚠️ final in
// v1.0, Q12 (a): no un-revoke, T033 is v1.1; the restore path is a new request and a new ijazah,
// FR-IJAZAH-9) and NOT_FOUND; `revoked_at`, `revoked_reason`, `revoked_by_admin_id` written and the
// row never deleted (the init migration revokes DELETE; no `deleted_at`). After the commit the live
// event `ijazahRequest` to both parties (contracts/app-surface.md:25-26).
//
// BAR and LIFT (`ijazahs.bar`, `ijazahs.liftBar`, keyed `runOn`): the user's `users` row locked, then
// the account and the open bar read under it; `ijazah_bars` has no partial unique, so the lock is
// what holds one open bar per user: a second is refused `already_barred`, a lift with none
// `not_barred`; NOT_FOUND for an account that is not there. A lift keeps the row as history.
//
// Every line names ids and a reason, never a name, the chain, a key or the reason's text (R-SEC-2).
import type {
  AdminIjazahBarInput,
  AdminIjazahsGetInput,
  AdminIjazahsGetOutput,
  AdminIjazahsListInput,
  AdminIjazahsListItem,
  AdminIjazahsListOutput,
  AdminIjazahsRevokeInput,
  AdminIjazahStatus,
  IjazahsRefusal,
} from '@ijazah/contracts/admin';
import type { IdempotentProcedure, LiveEvent } from '@ijazah/contracts';
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
import type { DecisionParty, DecisionSubject } from './ijazah-decision.service.js';

/** An ijazah as the administrator reads it (ERD §8, `ijazahs`). */
export interface IjazahRecord {
  readonly id: string;
  readonly certificateNumber: string;
  readonly enrollmentId: string;
  readonly requestId: string | null;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly subjectId: string;
  readonly language: 'ar' | 'en';
  readonly chainSnapshot: unknown;
  readonly studentNamePrinted: string;
  readonly teacherNamePrinted: string;
  readonly riwayaPrinted: string;
  readonly tariqPrinted: string | null;
  /** The `date` column, midnight UTC. */
  readonly completionDate: Date | null;
  readonly grantedAt: Date;
  readonly renderGeneration: number;
  readonly renderedAt: Date | null;
  readonly certificateStorageKey: string;
  readonly signedOffAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
}

/** One page of the ijazahs, by status, after a cursor. */
export interface IjazahPageQuery {
  readonly status?: AdminIjazahStatus | undefined;
  readonly after?: string | undefined;
  readonly take: number;
}

/** A bar as it is written (ERD §8, `ijazah_bars`). */
export interface NewIjazahBar {
  readonly id: string;
  readonly userId: string;
  readonly reason: string;
  readonly barredByAdminId: string;
  readonly barredAt: Date;
}

/** What the ijazahs' service reads, locks and writes, each on the call's transaction. */
export interface IjazahsStore {
  ijazahOf(tx: Transaction, ijazahId: string): Promise<IjazahRecord | null>;
  page(tx: Transaction, query: IjazahPageQuery): Promise<readonly IjazahRecord[]>;
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, DecisionParty>>;
  subjectsOf(
    tx: Transaction,
    subjectIds: readonly string[],
  ): Promise<ReadonlyMap<string, DecisionSubject>>;
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockIjazahs(tx: Transaction, ids: readonly string[]): Promise<void>;
  markRevoked(
    tx: Transaction,
    ijazahId: string,
    adminId: string,
    reason: string,
    at: Date,
  ): Promise<boolean>;
  openBarOf(tx: Transaction, userId: string): Promise<string | null>;
  insertBar(tx: Transaction, bar: NewIjazahBar): Promise<void>;
  liftBar(tx: Transaction, barId: string, adminId: string, at: Date): Promise<boolean>;
}

/** The lines the service writes: ids and a reason. */
export interface IjazahsLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface IjazahsDependencies {
  readonly store: IjazahsStore;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** A new row's id, drawn by the database on the transaction (`row-id.ts`). */
  readonly drawId: (tx: Transaction) => Promise<string>;
  /** The database's clock on the transaction. */
  readonly clock: (tx: Transaction) => Promise<Date>;
  readonly log: IjazahsLog;
}

export const REVOKE_SCOPE: IdempotentProcedure = 'ijazahs.revoke';
export const BAR_SCOPE: IdempotentProcedure = 'ijazahs.bar';
export const LIFT_BAR_SCOPE: IdempotentProcedure = 'ijazahs.liftBar';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

type Ids = Readonly<Record<string, string>>;

export class IjazahsService {
  readonly #dependencies: IjazahsDependencies;

  constructor(dependencies: IjazahsDependencies) {
    this.#dependencies = dependencies;
  }

  /** `ijazahs.list`: every ijazah, revoked included, by status, after a cursor. */
  async list(
    tx: Transaction,
    _adminId: string,
    { status, cursor }: AdminIjazahsListInput,
  ): Promise<AdminIjazahsListOutput> {
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
      items: page.map((ijazah) => rowOf(ijazah, parties, subjects)),
      ...(read.length > pageSize && last !== undefined ? { nextCursor: last.id } : {}),
    };
  }

  /** `ijazahs.get`: the record and a signed link to its rendered PDF, revoked or not (R-412). */
  async get(
    tx: Transaction,
    adminId: string,
    { ijazahId }: AdminIjazahsGetInput,
  ): Promise<AdminIjazahsGetOutput> {
    const { store, storage, settings } = this.#dependencies;
    const ijazah = await store.ijazahOf(tx, ijazahId);
    if (ijazah === null) throw this.#notFound({ adminId, ijazahId });
    const [parties, subjects] = await Promise.all([
      store.partiesOf(tx, [ijazah.teacherUserId, ijazah.studentUserId]),
      store.subjectsOf(tx, [ijazah.subjectId]),
    ]);
    // Before its rendering the key names generation 0's reserved file or an older generation's.
    const pdfLink =
      ijazah.renderedAt === null
        ? null
        : await storage.temporaryLink(
            ijazah.certificateStorageKey,
            await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl),
          );
    return {
      ...rowOf(ijazah, parties, subjects),
      completionDate: ijazah.completionDate === null ? null : calendarDateOf(ijazah.completionDate),
      chain: ijazah.chainSnapshot as string[][],
      studentNamePrinted: ijazah.studentNamePrinted,
      teacherNamePrinted: ijazah.teacherNamePrinted,
      riwaya: ijazah.riwayaPrinted,
      tariq: ijazah.tariqPrinted,
      revokedReason: ijazah.revokedReason,
      pdfLink,
    };
  }

  /** `ijazahs.revoke`: a reason; ⚠️ final in v1.0, the row kept (FR-609, Q12 (a)). */
  async revoke(
    tx: Transaction,
    adminId: string,
    { ijazahId, reason, idempotencyKey }: AdminIjazahsRevokeInput,
  ): Promise<{ readonly certificateNumber: string; readonly replayed: boolean }> {
    const live = this.#afterCommitList(tx, { adminId, ijazahId });
    const keyed = {
      scope: REVOKE_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { ijazahId, reason },
    };
    const { outcome, replayed } = await this.#dependencies.idempotency.runOn<{
      readonly certificateNumber: string;
    }>(tx, keyed, (on) => this.#revokeLocked(on, adminId, ijazahId, reason, live));
    return { certificateNumber: outcome.certificateNumber, replayed };
  }

  /** `ijazahs.bar`: one open bar per user, under the user's `users` lock (FR-610). */
  async bar(
    tx: Transaction,
    adminId: string,
    { targetUserId: userId, reason, idempotencyKey }: AdminIjazahBarInput,
  ): Promise<{ readonly replayed: boolean }> {
    const keyed = {
      scope: BAR_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { userId, reason },
    };
    const { replayed } = await this.#dependencies.idempotency.runOn<null>(tx, keyed, async (on) => {
      await this.#barLocked(on, adminId, userId, reason);
      return null;
    });
    return { replayed };
  }

  /** `ijazahs.liftBar`: the open bar lifted, kept as history (FR-610). */
  async liftBar(
    tx: Transaction,
    adminId: string,
    { targetUserId: userId, reason, idempotencyKey }: AdminIjazahBarInput,
  ): Promise<{ readonly replayed: boolean }> {
    const keyed = {
      scope: LIFT_BAR_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { userId, reason },
    };
    const { replayed } = await this.#dependencies.idempotency.runOn<null>(tx, keyed, async (on) => {
      await this.#liftLocked(on, adminId, userId);
      return null;
    });
    return { replayed };
  }

  async #revokeLocked(
    tx: Transaction,
    adminId: string,
    ijazahId: string,
    reason: string,
    live: AfterCommitList,
  ): Promise<{ readonly certificateNumber: string }> {
    const { store, clock, log } = this.#dependencies;
    const ids = { adminId, ijazahId };
    // The ijazah alone, the kernel row's last lock: a revocation writes no other row.
    await store.lockIjazahs(tx, [ijazahId]);
    const ijazah = await store.ijazahOf(tx, ijazahId);
    if (ijazah === null) throw this.#notFound(ids);
    if (ijazah.revokedAt !== null) throw this.#refused(ids, 'ijazahId', 'already_revoked');
    if (!(await store.markRevoked(tx, ijazahId, adminId, reason, await clock(tx)))) {
      throw new Error('ijazah revocation: a locked unrevoked ijazah was not revoked');
    }
    log.info({ ...ids, reason: 'revoked' }, 'An ijazah was revoked');
    live.afterCommit([ijazah.teacherUserId, ijazah.studentUserId], {
      type: 'ijazahRequest',
      enrollmentId: ijazah.enrollmentId,
    });
    return { certificateNumber: ijazah.certificateNumber };
  }

  async #barLocked(tx: Transaction, adminId: string, userId: string, reason: string) {
    const { store, drawId, clock, log } = this.#dependencies;
    const ids = { adminId, userId };
    await this.#lockedAccount(tx, ids);
    if ((await store.openBarOf(tx, userId)) !== null) {
      throw this.#refused(ids, 'userId', 'already_barred');
    }
    const barId = await drawId(tx);
    await store.insertBar(tx, {
      id: barId,
      userId,
      reason,
      barredByAdminId: adminId,
      barredAt: await clock(tx),
    });
    log.info({ ...ids, barId, reason: 'barred' }, 'A user was barred from ijazahs');
  }

  async #liftLocked(tx: Transaction, adminId: string, userId: string) {
    const { store, clock, log } = this.#dependencies;
    const ids = { adminId, userId };
    await this.#lockedAccount(tx, ids);
    const barId = await store.openBarOf(tx, userId);
    if (barId === null) throw this.#refused(ids, 'userId', 'not_barred');
    // Under the user's lock the bar was read open, so this write cannot miss.
    if (!(await store.liftBar(tx, barId, adminId, await clock(tx)))) {
      throw new Error('ijazah bar: a locked open bar was not lifted');
    }
    log.info({ ...ids, barId, reason: 'bar_lifted' }, "A user's ijazah bar was lifted");
  }

  /** The user's `users` row locked, then the account read under it; NOT_FOUND when gone. */
  async #lockedAccount(tx: Transaction, ids: { adminId: string; userId: string }): Promise<void> {
    const { store } = this.#dependencies;
    await store.lockAccounts(tx, [ids.userId]);
    if (!(await store.partiesOf(tx, [ids.userId])).has(ids.userId)) throw this.#notFound(ids);
  }

  /** The kind's after-commit list, through the transaction, or a refusal. */
  #afterCommitList(tx: Transaction, ids: Ids): AfterCommitList {
    const list = publisherOn(tx);
    if (list?.afterCommitDo === undefined) {
      this.#dependencies.log.info(
        { ...ids, reason: 'no_after_commit_list' },
        'An ijazah action was refused',
      );
      throw new Error(
        'An ijazah action runs on a transaction its caller bound an after-commit list to (R-API-13), so its live event and its job go out only once it has committed.',
      );
    }
    return {
      afterCommit: list.afterCommit.bind(list),
      afterCommitDo: list.afterCommitDo.bind(list),
    };
  }

  #refused(ids: Ids, path: 'ijazahId' | 'userId', reason: IjazahsRefusal): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'An ijazah action was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path, code: reason }] }),
    );
  }

  #notFound(ids: Ids): DomainError {
    this.#dependencies.log.info({ ...ids, reason: 'not_found' }, 'An ijazah action was refused');
    return markRefusalLogged(new DomainError('NOT_FOUND'));
  }
}

/** The kind's list, both halves required. */
interface AfterCommitList {
  afterCommit(to: readonly string[], event: LiveEvent): void;
  afterCommitDo(action: () => void): void;
}

/**
 * An ijazah's status for the administrator: revoked first, whatever else it holds, so a revoked one
 * is never shown as valid (R-HONEST-6); then signed off, rendered, or still being prepared.
 */
export function ijazahStatusOf(
  ijazah: Pick<IjazahRecord, 'revokedAt' | 'signedOffAt' | 'renderedAt'>,
): AdminIjazahStatus {
  if (ijazah.revokedAt !== null) return 'revoked';
  if (ijazah.signedOffAt !== null) return 'signed_off';
  if (ijazah.renderedAt !== null) return 'rendered';
  return 'preparing';
}

/** An ijazah as a list row reads it. */
function rowOf(
  ijazah: IjazahRecord,
  parties: ReadonlyMap<string, DecisionParty>,
  subjects: ReadonlyMap<string, DecisionSubject>,
): AdminIjazahsListItem {
  const subject = subjects.get(ijazah.subjectId);
  // The FK holds the subject; a missing one is a broken read, never a row to hide.
  if (subject === undefined) throw new Error('ijazah: a subject the catalog does not answer');
  return {
    ijazahId: ijazah.id,
    certificateNumber: ijazah.certificateNumber,
    enrollmentId: ijazah.enrollmentId,
    requestId: ijazah.requestId,
    teacher: {
      userId: ijazah.teacherUserId,
      displayName: parties.get(ijazah.teacherUserId)?.displayName ?? null,
    },
    student: {
      userId: ijazah.studentUserId,
      displayName: parties.get(ijazah.studentUserId)?.displayName ?? null,
    },
    subject,
    language: ijazah.language,
    grantedAt: ijazah.grantedAt.toISOString(),
    status: ijazahStatusOf(ijazah),
    rendered: ijazah.renderedAt !== null,
    revoked: ijazah.revokedAt !== null,
    renderGeneration: ijazah.renderGeneration,
    signedOffAt: ijazah.signedOffAt?.toISOString() ?? null,
    revokedAt: ijazah.revokedAt?.toISOString() ?? null,
  };
}
