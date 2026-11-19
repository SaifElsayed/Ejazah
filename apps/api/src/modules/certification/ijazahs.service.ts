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
// 005:T032 (FR-629; R-402; DEC-72; the note under T032, Q7 (a) with the review's amendment).
// SIGN-OFF (`ijazahs.signOff`, keyed `runOn`): the kernel row's order, the student's `users` row,
// then the ijazah, then the reads under them; refused `revoked`, `already_signed_off`,
// `not_rendered` and `student_barred` (an open `ijazah_bars` row of the student, read under the
// student's lock); `signed_off_at` and `signed_off_by_admin_id` written together (ERD §15 rule 55),
// the one write of them; ⚠️ final: after it nothing changes the certificate (SC-604); the live event
// `ijazahRequest` to both parties after the commit, so their screens read it again.
// RE-RENDER (`ijazahs.rerender`, a reason, keyed `runOn`): the ijazah locked, then read; refused
// `revoked` and `already_signed_off`; `render_generation` + 1 and `rendered_at` cleared, and only
// after the commit `render-certificate` enqueued for the new generation (job id
// `<ijazahId>-<generation>`, `main.ts`'s queue), whose older job then writes nothing (R-402); a lost
// enqueue is logged by ids and leaves the ijazah unrendered and visible as such, a second re-render
// its fix.
//
// 005:T022 (B49, Q-P2 (b)). BARRED (`ijazahs.barred`): the open bars, newest first, paged by
// `admin_list_page_size`; read with no lock; the administrators' names handed in by the admin module.
//
// Every line names ids and a reason, never a name, the chain, a key or the reason's text (R-SEC-2).
import type {
  AdminIjazahBarInput,
  AdminIjazahsBarredInput,
  AdminIjazahsBarredOutput,
  AdminIjazahsGetInput,
  AdminIjazahsGetOutput,
  AdminIjazahsListInput,
  AdminIjazahsListItem,
  AdminIjazahsListOutput,
  AdminIjazahsRerenderInput,
  AdminIjazahsRevokeInput,
  AdminIjazahsSignOffInput,
  AdminIjazahStatus,
  IjazahSignOffRefusal,
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
import type { DecisionParty, DecisionSubject, RenderQueue } from './ijazah-decision.service.js';

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

/** 005:T022: an open bar as the barred list reads it (ERD §8, `ijazah_bars`, `lifted_at` null). */
export interface OpenIjazahBar {
  readonly id: string;
  readonly userId: string;
  readonly reason: string;
  readonly barredByAdminId: string;
  readonly barredAt: Date;
}

/** 005:T022: one page of the open bars, newest first, before a cursor. */
export interface OpenBarPageQuery {
  readonly after?: string | undefined;
  readonly take: number;
}

/**
 * 005:T022 (Q-P2 (b)): the administrators' display names by id, the admin module's (`admin_users` is
 * its table, R-API-6), handed in by it as sessions' outage list takes them (`AdminNames`); an id it
 * does not answer is named by an empty string.
 */
export type IjazahsAdminNames = (
  tx: Transaction,
  adminIds: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

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
  // 005:T032: the sign-off and the re-render.
  hasOpenBar(tx: Transaction, userId: string): Promise<boolean>;
  markSignedOff(tx: Transaction, ijazahId: string, adminId: string, at: Date): Promise<boolean>;
  /** `render_generation` + 1 and `rendered_at` cleared on an unsigned, unrevoked ijazah. */
  markRerendered(tx: Transaction, ijazahId: string): Promise<boolean>;
  // 005:T022: the barred list.
  openBars(tx: Transaction, query: OpenBarPageQuery): Promise<readonly OpenIjazahBar[]>;
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
  /** 005:T032: `render-certificate`, enqueued after a re-render's commit (contracts/jobs.md). */
  readonly renders: RenderQueue;
  /** 005:T022: the barred list's administrators' names (Q-P2 (b)). */
  readonly adminNames: IjazahsAdminNames;
}

export const REVOKE_SCOPE: IdempotentProcedure = 'ijazahs.revoke';
export const BAR_SCOPE: IdempotentProcedure = 'ijazahs.bar';
export const LIFT_BAR_SCOPE: IdempotentProcedure = 'ijazahs.liftBar';
export const SIGN_OFF_SCOPE: IdempotentProcedure = 'ijazahs.signOff';
export const RERENDER_SCOPE: IdempotentProcedure = 'ijazahs.rerender';

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

  /**
   * 005:T022 `ijazahs.barred` (B49, Q-P2 (b)): the open bars, newest first, before a cursor; each
   * student's name null once the account is deleted; the barring administrator by the names the
   * admin module hands in. No lock: the read decides nothing.
   */
  async barred(
    tx: Transaction,
    _adminId: string,
    { cursor }: AdminIjazahsBarredInput,
  ): Promise<AdminIjazahsBarredOutput> {
    const { store, settings, adminNames } = this.#dependencies;
    const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const read = await store.openBars(tx, { after: cursor, take: pageSize + 1 });
    const page = read.slice(0, pageSize);
    const [parties, names] = await Promise.all([
      store.partiesOf(tx, [...new Set(page.map(({ userId }) => userId))]),
      adminNames(tx, [...new Set(page.map(({ barredByAdminId }) => barredByAdminId))]),
    ]);
    const last = page.at(-1);
    return {
      items: page.map((bar) => ({
        barId: bar.id,
        student: { userId: bar.userId, displayName: parties.get(bar.userId)?.displayName ?? null },
        reason: bar.reason,
        barredAt: bar.barredAt.toISOString(),
        barredBy: {
          adminId: bar.barredByAdminId,
          displayName: names.get(bar.barredByAdminId) ?? '',
        },
      })),
      ...(read.length > pageSize && last !== undefined ? { nextCursor: last.id } : {}),
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

  /** 005:T032 `ijazahs.signOff`: what shows the certificate to its parties (FR-629; this file's head). */
  async signOff(
    tx: Transaction,
    adminId: string,
    { ijazahId, idempotencyKey }: AdminIjazahsSignOffInput,
  ): Promise<{ readonly certificateNumber: string; readonly replayed: boolean }> {
    const live = this.#afterCommitList(tx, { adminId, ijazahId });
    const keyed = {
      scope: SIGN_OFF_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { ijazahId },
    };
    const { outcome, replayed } = await this.#dependencies.idempotency.runOn<{
      readonly certificateNumber: string;
    }>(tx, keyed, (on) => this.#signOffLocked(on, adminId, ijazahId, live));
    return { certificateNumber: outcome.certificateNumber, replayed };
  }

  /** 005:T032 `ijazahs.rerender`: a reason; a new generation rendered after the commit (R-402). */
  async rerender(
    tx: Transaction,
    adminId: string,
    { ijazahId, reason, idempotencyKey }: AdminIjazahsRerenderInput,
  ): Promise<{ readonly certificateNumber: string; readonly replayed: boolean }> {
    const live = this.#afterCommitList(tx, { adminId, ijazahId });
    const keyed = {
      scope: RERENDER_SCOPE,
      key: idempotencyKey,
      actorId: adminId,
      input: { ijazahId, reason },
    };
    const { outcome, replayed } = await this.#dependencies.idempotency.runOn<{
      readonly certificateNumber: string;
    }>(tx, keyed, (on) => this.#rerenderLocked(on, adminId, ijazahId, live));
    return { certificateNumber: outcome.certificateNumber, replayed };
  }

  async #signOffLocked(
    tx: Transaction,
    adminId: string,
    ijazahId: string,
    live: AfterCommitList,
  ): Promise<{ readonly certificateNumber: string }> {
    const { store, clock, log } = this.#dependencies;
    const ids = { adminId, ijazahId };
    const seen = await store.ijazahOf(tx, ijazahId);
    if (seen === null) throw this.#notFound(ids);
    // The kernel row's order: the student's `users` row (the bar is read under it, Q7 (a) with the
    // review's amendment), then the ijazah; the parties never change, so the unlocked read is enough
    // to name the student.
    await store.lockAccounts(tx, [seen.studentUserId]);
    await store.lockIjazahs(tx, [ijazahId]);
    const ijazah = await store.ijazahOf(tx, ijazahId);
    if (ijazah === null) throw this.#notFound(ids);
    if (ijazah.revokedAt !== null) throw this.#signOffRefused(ids, 'revoked');
    if (ijazah.signedOffAt !== null) throw this.#signOffRefused(ids, 'already_signed_off');
    if (ijazah.renderedAt === null) throw this.#signOffRefused(ids, 'not_rendered');
    if (await store.hasOpenBar(tx, ijazah.studentUserId)) {
      throw this.#signOffRefused(ids, 'student_barred');
    }
    if (!(await store.markSignedOff(tx, ijazahId, adminId, await clock(tx)))) {
      throw new Error('ijazah sign-off: a locked rendered ijazah was not signed off');
    }
    log.info({ ...ids, reason: 'signed_off' }, 'An ijazah was signed off');
    live.afterCommit([ijazah.teacherUserId, ijazah.studentUserId], {
      type: 'ijazahRequest',
      enrollmentId: ijazah.enrollmentId,
    });
    return { certificateNumber: ijazah.certificateNumber };
  }

  async #rerenderLocked(
    tx: Transaction,
    adminId: string,
    ijazahId: string,
    live: AfterCommitList,
  ): Promise<{ readonly certificateNumber: string }> {
    const { store, log } = this.#dependencies;
    const ids = { adminId, ijazahId };
    // The ijazah alone, the kernel row's last lock: a re-render writes no other row.
    await store.lockIjazahs(tx, [ijazahId]);
    const ijazah = await store.ijazahOf(tx, ijazahId);
    if (ijazah === null) throw this.#notFound(ids);
    if (ijazah.revokedAt !== null) throw this.#signOffRefused(ids, 'revoked');
    if (ijazah.signedOffAt !== null) throw this.#signOffRefused(ids, 'already_signed_off');
    // Read under the lock, so the write below raises exactly this generation by one.
    const generation = ijazah.renderGeneration + 1;
    if (!(await store.markRerendered(tx, ijazahId))) {
      throw new Error('ijazah re-render: a locked unsigned ijazah was not re-rendered');
    }
    log.info({ ...ids, generation, reason: 'rerendered' }, 'An ijazah is rendered again');
    live.afterCommitDo(() => {
      void this.#enqueueRender(ijazahId, generation);
    });
    return { certificateNumber: ijazah.certificateNumber };
  }

  async #enqueueRender(ijazahId: string, generation: number): Promise<void> {
    try {
      await this.#dependencies.renders.enqueue(ijazahId, generation);
    } catch {
      // A lost enqueue leaves the ijazah unrendered and visible as such; `ijazahs.rerender` is its fix.
      this.#dependencies.log.warn(
        { ijazahId, generation, reason: 'enqueue_failed' },
        "An ijazah's rendering could not be queued",
      );
    }
  }

  #signOffRefused(ids: Ids, reason: IjazahSignOffRefusal): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'An ijazah action was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'ijazahId', code: reason }] }),
    );
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
