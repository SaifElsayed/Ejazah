// T013 of specs/005-certification: gender flags and their queue (FR-613, FR-614, FR-615; SRS
// FR-GENDER-3, FR-GENDER-4; research R-409; R-GENDER-2; contracts/app-surface.md and
// admin-surface.md, `genderFlags.*`; the note under T013, Q-G1 (a)). The specs are
// gender-flag.service.spec.ts's and tests/db-integrity/gender-flags.spec.ts's.
//
// GENDERFLAGS.RAISE, THE USER'S (a signed-in user; keyed `genderFlags.raise` in its own transaction,
// `run`; its limit, `rate_limit_gender_flag`, the procedure's, applied by the kind before this).
// - Whom. A person the caller is paired with (`Pairings.paired`: an enrollment of any status joins
//   them, a soft-deleted one not counted) or can see: a student, a teacher identity's
//   `visibleTeachers` answers to the student's own gender (the note under T011, Q-R4 (a), whose
//   «a profile they can see» this reads the same way). Anyone else answers one NOT_FOUND, the shape a
//   person who does not exist answers (R-GENDER-2), a teacher caller's flag of a student they are not
//   paired with included. No gender is compared here: who may be flagged is who the caller is
//   paired with or shown (R-GENDER-4: the caller's gender is the session's).
// - `open_exists` (CONFLICT): one open flag per flagged person, the database's
//   `gender_flags_one_open_per_user_key` (rule 57). The refused insert aborts the transaction, which
//   is rolled back with the key's claim before the refusal is thrown.
// - The reason is stored (`gender_flags.reason`), never logged. The answer is `{ received: true }`.
//
// THE ADMINISTRATOR'S (on the administrator kind's transaction, which audits the call; the admin
// module's router serves them, Q-G1 (a)). `raiseByAdministrator` (keyed `genderFlags.raise`,
// `runOn`): a live person (identity's `readStanding`), else NOT_FOUND; with a report, an unknown
// report NOT_FOUND, and one about another person CONFLICT `report_target_mismatch` (the review's
// ruling of 2026-11-18: an administrator sees every report, so the screen says why); no raiser
// (`raised_by_user_id` NULL, FR-GENDER-3), the report's id stored; `open_exists` as the user's.
// `list`: the queue by status
// (the contract's default `open`) under `admin_list_page_size`, a flag id as the cursor. `detail`:
// one flag, its reason and its resolution; the preview of what a correction would end is composed
// by the admin module (R-409). `dismiss` (keyed `genderFlags.dismiss`, `runOn`): one conditional
// update `WHERE status = 'open'` writing `dismissed`, the reason, the database's instant and the
// administrator together, so a flag not open is refused `already_resolved`; NOT_FOUND for none.
//
// LOCKS (kernel.md, «a gender flag raised»). Whom the caller may flag is read first with no lock
// (an enrollment's parties never change; the visibility read is a read). Then the accounts the
// insert references, `FOR KEY SHARE`, in one call in id order (`keyShareRows`): the flagged person
// and, for a user's flag, the raiser; then the insert, whose foreign keys key-share them again and a
// report's row (its own, after every earlier lock). A correction or a fraud ban holds the flagged
// person `FOR UPDATE` first, so a flag raised meanwhile waits for it and then meets its closing.
// `dismiss` takes no lock before its conditional update; the correction and the fraud ban claim the
// flag the same way, so the two never both close it.
//
// THE LOG. Each refusal writes one info line of ids and its reason, marked «logged» so the handler's
// one-place refusal log writes no second line; a flag received one line of ids after its commit.
// Never the reason, a name or a gender (R-SEC-2).
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { keyShareRows } from '../../platform/db/row-lock.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { z } from 'zod';

import { readStanding, visibleTeachers } from '../identity/index.js';
import {
  type GenderFlagOutcome,
  type GenderFlagPageQuery,
  type GenderFlagResolution,
  type GenderFlagRow,
  type GenderFlagStatus,
  genderFlagOf,
  genderFlagsPage,
  insertGenderFlag,
  type NewGenderFlag,
  resolveGenderFlag,
} from './gender-flag.repository.js';
import type { Pairings } from './pairings.port.js';
import { userReportOf } from './user-report.repository.js';

/** What the flags lock, read and write, each on the call's transaction; faked in a spec. */
export interface GenderFlagStore {
  /** Whether identity's visibility predicate answers the teacher to the requester (`discover`). */
  visibleTeacher(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
  ): Promise<boolean>;
  /** Whether the person is there and not deleted (identity's `readStanding`). */
  livePerson(tx: Transaction, userId: string): Promise<boolean>;
  /** A report's reported person, or null for none. */
  reportedUserOf(tx: Transaction, reportId: string): Promise<string | null>;
  /** The accounts, `FOR KEY SHARE`, id order, one call (kernel.md, `keyShareRows`). */
  keyShareAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  insert(tx: Transaction, row: NewGenderFlag): Promise<string | null>;
  flagOf(tx: Transaction, flagId: string): Promise<GenderFlagRow | null>;
  page(tx: Transaction, query: GenderFlagPageQuery): Promise<GenderFlagRow[]>;
  resolve(tx: Transaction, resolution: GenderFlagResolution): Promise<boolean>;
}

/** The store over this module's repositories, the kernel's key share and identity's entry. */
export const genderFlagStore: GenderFlagStore = {
  visibleTeacher: async (tx, requester, teacherUserId) =>
    (await visibleTeachers(tx, requester, { purpose: 'discover', teacherIds: [teacherUserId] }))
      .length === 1,
  livePerson: async (tx, userId) => (await readStanding(tx, userId)) !== null,
  reportedUserOf: async (tx, reportId) =>
    (await userReportOf(tx, reportId))?.reportedUserId ?? null,
  keyShareAccounts: (tx, userIds) => keyShareRows(tx, 'users', userIds),
  insert: insertGenderFlag,
  flagOf: genderFlagOf,
  page: genderFlagsPage,
  resolve: resolveGenderFlag,
};

/** Who flags: the session's account, role and gender, never the input's (R-GENDER-4). */
export interface FlagCaller {
  readonly userId: string;
  readonly role: 'student' | 'teacher';
  readonly gender: RequesterGender;
}

/** The user's `genderFlags.raise` input, as the contract parses it (app-surface.md). */
export interface FlagAsked {
  readonly flaggedUserId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/** The administrator's `genderFlags.raise` input (admin-surface.md). */
export interface AdministratorFlagAsked {
  readonly targetUserId: string;
  readonly reason: string;
  readonly reportId?: string | undefined;
  readonly idempotencyKey: string;
}

/** The lines the service writes: ids and a reason. */
export interface GenderFlagsLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
}

/** A flag as the queue lists it (`adminGenderFlagsListItem`). */
export interface GenderFlagItem {
  readonly flagId: string;
  readonly flaggedUserId: string;
  readonly raisedByUserId: string | null;
  readonly reportId: string | null;
  readonly status: GenderFlagStatus;
  readonly createdAt: string;
}

export interface GenderFlagsPage {
  readonly items: readonly GenderFlagItem[];
  readonly nextCursor?: string;
}

/** A flag as the administrator opens it, before the admin module adds the correction's preview. */
export interface GenderFlagDetail extends GenderFlagItem {
  readonly reason: string;
  readonly resolution: {
    readonly outcome: GenderFlagOutcome;
    readonly note: string | null;
    readonly resolvedAt: string;
    readonly resolvedByAdminId: string;
  } | null;
}

export interface GenderFlagsDependencies {
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'runOn'>;
  /** Sessions' and booking's parties, bound by `main.ts` (R-408). */
  readonly pairings: Pick<Pairings, 'paired'>;
  readonly settings: SettingsReader;
  /** The database's clock on the transaction; `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: GenderFlagStore;
}

export interface GenderFlags {
  /** The user's `genderFlags.raise` (this file's head). */
  raise(caller: FlagCaller, asked: FlagAsked, log: GenderFlagsLog): Promise<{ received: true }>;
  /** The administrator's `genderFlags.raise`, keyed on the kind's transaction. */
  raiseByAdministrator(
    tx: Transaction,
    adminId: string,
    asked: AdministratorFlagAsked,
    log: GenderFlagsLog,
  ): Promise<{ readonly flagId: string; readonly replayed: boolean }>;
  /** `genderFlags.list`, on the administrator kind's transaction. */
  list(
    tx: Transaction,
    adminId: string,
    query: { readonly status: GenderFlagStatus; readonly cursor?: string | undefined },
    log: GenderFlagsLog,
  ): Promise<GenderFlagsPage>;
  /** `genderFlags.get`'s flag, on the administrator kind's transaction. */
  detail(
    tx: Transaction,
    adminId: string,
    query: { readonly flagId: string },
    log: GenderFlagsLog,
  ): Promise<GenderFlagDetail>;
  /** `genderFlags.dismiss`, keyed on the administrator kind's transaction. */
  dismiss(
    tx: Transaction,
    adminId: string,
    input: { readonly flagId: string; readonly reason: string; readonly idempotencyKey: string },
    log: GenderFlagsLog,
  ): Promise<{ readonly flaggedUserId: string; readonly replayed: boolean }>;
}

const RAISE_SCOPE = 'genderFlags.raise';
const DISMISS_SCOPE = 'genderFlags.dismiss';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** Why a call was refused, as its one line names it. */
type RefusalReason =
  | 'not_paired_or_visible'
  | 'no_person'
  | 'no_report'
  | 'report_target_mismatch'
  | 'open_exists'
  | 'no_flag'
  | 'already_resolved';

/** Logs the refusal with ids and its reason only, and answers the error to throw, marked logged. */
export function genderFlagRefusal(
  log: GenderFlagsLog,
  ids: Readonly<Record<string, string | undefined>>,
  errorCode: ErrorCode,
  reason: RefusalReason,
  details?: readonly FieldIssue[],
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A gender flag call was refused');
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details === undefined ? undefined : { details }),
  );
}

/** The one-open rule refused the insert; its transaction is rolled back before the refusal. */
class FlagAlreadyOpen extends Error {}

const OPEN_EXISTS: readonly FieldIssue[] = [{ path: 'flaggedUserId', code: 'open_exists' }];

function itemOf(row: GenderFlagRow): GenderFlagItem {
  return {
    flagId: row.id,
    flaggedUserId: row.flaggedUserId,
    raisedByUserId: row.raisedByUserId,
    reportId: row.reportId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function resolutionOf(row: GenderFlagRow): GenderFlagDetail['resolution'] {
  if (row.status === 'open' || row.resolvedAt === null || row.resolvedByAdminId === null) {
    return null;
  }
  return {
    outcome: row.status,
    note: row.resolutionNotes,
    resolvedAt: row.resolvedAt.toISOString(),
    resolvedByAdminId: row.resolvedByAdminId,
  };
}

export function createGenderFlags({
  idempotency,
  pairings,
  settings,
  clock = clockTimestamp,
  store = genderFlagStore,
}: GenderFlagsDependencies): GenderFlags {
  /** Whether the caller is paired with the person, or (a student) is shown them (this file's head). */
  async function mayFlag(tx: Transaction, caller: FlagCaller, flaggedUserId: string) {
    if (await pairings.paired(tx, caller.userId, flaggedUserId)) return true;
    return caller.role === 'student' && store.visibleTeacher(tx, caller.gender, flaggedUserId);
  }

  return {
    raise: async (caller, { flaggedUserId, reason, idempotencyKey }, log) => {
      const ids = { userId: caller.userId, flaggedUserId };
      let flagId: string | undefined;
      try {
        await idempotency.run(
          {
            scope: RAISE_SCOPE,
            key: idempotencyKey,
            actorId: caller.userId,
            input: { flaggedUserId, reason },
          },
          async (tx) => {
            if (!(await mayFlag(tx, caller, flaggedUserId))) {
              throw genderFlagRefusal(log, ids, 'NOT_FOUND', 'not_paired_or_visible');
            }
            await store.keyShareAccounts(tx, [caller.userId, flaggedUserId]);
            const inserted = await store.insert(tx, {
              flaggedUserId,
              raisedByUserId: caller.userId,
              reportId: null,
              reason,
            });
            if (inserted === null) throw new FlagAlreadyOpen();
            flagId = inserted;
            return { received: true };
          },
        );
      } catch (error: unknown) {
        if (!(error instanceof FlagAlreadyOpen)) throw error;
        throw genderFlagRefusal(log, ids, 'CONFLICT', 'open_exists', OPEN_EXISTS);
      }
      if (flagId !== undefined) log.info({ flagId, ...ids }, 'A gender flag was received');
      return { received: true };
    },

    raiseByAdministrator: async (
      tx,
      adminId,
      { targetUserId, reason, reportId, idempotencyKey },
      log,
    ) => {
      const ids = { adminId, flaggedUserId: targetUserId, reportId };
      const { outcome, replayed } = await idempotency.runOn<{ readonly flagId: string }>(
        tx,
        {
          scope: RAISE_SCOPE,
          key: idempotencyKey,
          actorId: adminId,
          input: { targetUserId, reason, ...(reportId === undefined ? {} : { reportId }) },
        },
        async (on) => {
          if (!(await store.livePerson(on, targetUserId))) {
            throw genderFlagRefusal(log, ids, 'NOT_FOUND', 'no_person');
          }
          if (reportId !== undefined) {
            const reported = await store.reportedUserOf(on, reportId);
            if (reported === null) throw genderFlagRefusal(log, ids, 'NOT_FOUND', 'no_report');
            if (reported !== targetUserId) {
              throw genderFlagRefusal(log, ids, 'CONFLICT', 'report_target_mismatch', [
                { path: 'reportId', code: 'report_target_mismatch' },
              ]);
            }
          }
          await store.keyShareAccounts(on, [targetUserId]);
          const flagId = await store.insert(on, {
            flaggedUserId: targetUserId,
            raisedByUserId: null,
            reportId: reportId ?? null,
            reason,
          });
          if (flagId === null) {
            throw genderFlagRefusal(log, ids, 'CONFLICT', 'open_exists', [
              { path: 'targetUserId', code: 'open_exists' },
            ]);
          }
          log.info({ flagId, ...ids }, 'A gender flag was raised by an administrator');
          return { flagId };
        },
      );
      return { flagId: outcome.flagId, replayed };
    },

    list: async (tx, _adminId, { status, cursor }) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const read = await store.page(tx, { status, after: cursor, take: pageSize + 1 });
      const page = read.slice(0, pageSize);
      const last = page.at(-1);
      return {
        items: page.map(itemOf),
        ...(read.length > pageSize && last !== undefined ? { nextCursor: last.id } : {}),
      };
    },

    detail: async (tx, adminId, { flagId }, log) => {
      const row = await store.flagOf(tx, flagId);
      if (row === null) throw genderFlagRefusal(log, { adminId, flagId }, 'NOT_FOUND', 'no_flag');
      return { ...itemOf(row), reason: row.reason, resolution: resolutionOf(row) };
    },

    dismiss: async (tx, adminId, { flagId, reason, idempotencyKey }, log) => {
      const { outcome, replayed } = await idempotency.runOn<{ readonly flaggedUserId: string }>(
        tx,
        { scope: DISMISS_SCOPE, key: idempotencyKey, actorId: adminId, input: { flagId, reason } },
        async (on) => {
          const at = await clock(on);
          const resolved = await store.resolve(on, {
            flagId,
            outcome: 'dismissed',
            note: reason,
            adminId,
            at,
          });
          // Read after the conditional update, under the row lock it took (or for the refusal).
          const row = await store.flagOf(on, flagId);
          const ids = { adminId, flagId };
          if (row === null) throw genderFlagRefusal(log, ids, 'NOT_FOUND', 'no_flag');
          if (!resolved) {
            throw genderFlagRefusal(log, ids, 'CONFLICT', 'already_resolved', [
              { path: 'flagId', code: 'already_resolved' },
            ]);
          }
          log.info({ adminId, flagId, outcome: 'dismissed' }, 'A gender flag was resolved');
          return { flaggedUserId: row.flaggedUserId };
        },
      );
      return { flaggedUserId: outcome.flaggedUserId, replayed };
    },
  };
}
