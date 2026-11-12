// T058 of specs/004-sessions (FR-481, FR-459, FR-451, FR-426; SRS FR-ADMIN-4; research R-301, R-318,
// R-203; contracts/admin-surface.md, "`users`"; the notes under T058, Q7, Q8 and Q9): the user
// directory, `users.list` and `users.get`, two reads on the administrator call's transaction. Nothing
// here writes or locks; the audit entries are the router's. Verification reads identity's entry and
// sessions' entry only (R-301, R-API-6).
//
// THE LIST. Every user, deleted ones included (identity's `userDirectoryPage`, through
// `includeDeleted`, outside the transaction, the owner's decision Q8), newest first by the
// time-ordered id, in pages of `admin_list_page_size`. A name is searched by its folded prefix
// through the kernel's `idsWithFoldedNamePrefix` (R-203), matched over each batch's own ids, the
// batches each twice the one before, from the page size and one more, until the page holds one more
// match than it shows or the users end, as T024's monitor reads (`sessions-monitor.service.ts`; Q9),
// so no short page is answered while a cursor exists. A deleted user has no name, so a name search
// never finds one (FR-426).
//
// THE RECORD. FR-ADMIN-4's fields exactly: identity's `userRecordOf` (the name, email, sign-up
// instant, gender, role, account status, a teacher's bio, qualification and verification status),
// the minor flag derived from the date of birth with `@ijazah/time`'s `isMinorOn` on the day of the
// database's clock (R-DB-4), FR-459's counts (T025's `cancellationRequestCountsOf`), and for a
// teacher the enrollments FR-451 marks (sessions' `markedEnrollmentsWithStudentsOf`, Q7), each
// student named as this phase names a party (FR-426: a deleted one unnamed).
//
// THE DATE OF BIRTH (the reviewer's requirement; PDPL, a minor's data is sensitive): read only to
// derive `isMinor`. It never leaves this file: not in the answer, a log line or an audit entry.
//
// THE LOG (the owner's rule). A user no read returns is refused NOT_FOUND through this file's one
// `refusal`, one info line of ids and a reason code; a read writes no line.
import type {
  MonitorParty,
  UsersGetInput,
  UsersGetOutput,
  UsersListInput,
  UsersListOutput,
  UserRepeatedAbsence,
} from '@ijazah/contracts/admin';
import { calendarDateOf, isMinorOn } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { DirectoryUser, UserRecordRow } from '../identity/index.js';
import type { CancellationRequestCountsReader, MarkedEnrollments } from '../sessions/index.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** What the directory reads through the owners' entries; faked in a spec. */
export interface UserDirectoryStore {
  /** Identity's: a page of every user, deleted ones included, newest first, after `after`. */
  usersPage(after: string | undefined, limit: number): Promise<readonly DirectoryUser[]>;
  /** Identity's: the user's record, deleted or not; null when no such user exists. */
  userRecord(userId: string): Promise<UserRecordRow | null>;
  /** The kernel's: of `candidateIds`, those whose name, folded, begins with `typed`, folded. */
  namePrefixMatches(
    tx: Transaction,
    candidateIds: readonly string[],
    typed: string,
  ): Promise<readonly string[]>;
  /** Identity's: display names by account, a deleted account absent. */
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface UserDirectory {
  /** `users.list` (this file's head). */
  list(tx: Transaction, adminId: string, input: UsersListInput): Promise<UsersListOutput>;
  /** `users.get` (this file's head). */
  get(tx: Transaction, adminId: string, input: UsersGetInput): Promise<UsersGetOutput>;
}

/** Why a directory read was refused, as its one log line names it. */
type RefusalReason = 'not_found';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line.
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: { readonly adminId: string; readonly userId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A user directory read was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

/** A party as this phase names one: a deleted account (no name answered) unnamed (FR-426). */
function partyOf(userId: string, names: ReadonlyMap<string, string>): MonitorParty {
  const displayName = names.get(userId);
  return displayName === undefined
    ? { userId, displayName: null, deleted: true }
    : { userId, displayName, deleted: false };
}

const itemOf = ({ id, displayName, deleted, role, accountStatus }: DirectoryUser) => ({
  userId: id,
  displayName,
  deleted,
  role,
  accountStatus,
});

export function createUserDirectoryService({
  store,
  settings,
  counts,
  marked,
  log,
  clock = clockTimestamp,
}: {
  readonly store: UserDirectoryStore;
  readonly settings: SettingsReader;
  readonly counts: CancellationRequestCountsReader;
  readonly marked: MarkedEnrollments;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
}): UserDirectory {
  /** Of a batch, the users whose name begins with `name`, folded, in the batch's order. */
  const matching = async (
    tx: Transaction,
    batch: readonly DirectoryUser[],
    name: string,
  ): Promise<DirectoryUser[]> => {
    const found = new Set(
      await store.namePrefixMatches(
        tx,
        batch.map(({ id }) => id),
        name,
      ),
    );
    return batch.filter(({ id }) => found.has(id));
  };

  const repeatedAbsencesOf = async (
    tx: Transaction,
    teacherUserId: string,
  ): Promise<UserRepeatedAbsence[]> => {
    const enrollments = await marked.markedEnrollmentsWithStudentsOf(tx, teacherUserId);
    const names = await store.namesOf(tx, [
      ...new Set(enrollments.map(({ studentUserId }) => studentUserId)),
    ]);
    return enrollments.map(({ enrollmentId, studentUserId, status, teacherNoShows }) => ({
      enrollmentId,
      student: partyOf(studentUserId, names),
      status,
      teacherNoShows,
    }));
  };

  return {
    list: async (tx, _adminId, { name, cursor }) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const wanted = pageSize + 1;
      const kept: DirectoryUser[] = [];
      let after = cursor;
      let window = wanted;
      for (;;) {
        const batch = await store.usersPage(after, window);
        kept.push(...(name === undefined ? batch : await matching(tx, batch, name)));
        const last = batch.at(-1);
        if (kept.length >= wanted || batch.length < window || last === undefined) break;
        after = last.id;
        window += window;
      }
      const shown = kept.slice(0, pageSize);
      const lastShown = shown.at(-1);
      const items = shown.map(itemOf);
      return kept.length > pageSize && lastShown !== undefined
        ? { items, nextCursor: lastShown.id }
        : { items };
    },

    get: async (tx, adminId, { targetUserId }) => {
      const record = await store.userRecord(targetUserId);
      if (record === null) {
        throw refusal(log, { adminId, userId: targetUserId }, 'NOT_FOUND', 'not_found');
      }
      const [now, cancellationRequests, repeatedAbsences] = await Promise.all([
        clock(tx),
        counts.cancellationRequestCountsOf(tx, targetUserId),
        record.role === 'teacher' ? repeatedAbsencesOf(tx, targetUserId) : undefined,
      ]);
      // A live person's date of birth is set (ERD §15 rule 32); a deleted one's may be erased.
      const isMinor =
        record.dateOfBirth !== null &&
        isMinorOn(calendarDateOf(record.dateOfBirth), calendarDateOf(now));
      const { teacherProfile } = record;
      return {
        userId: record.id,
        profile: {
          displayName: record.displayName,
          email: record.email,
          joinedAt: record.createdAt.toISOString(),
          deleted: record.deleted,
          ...(teacherProfile === null
            ? {}
            : {
                teacher: { bio: teacherProfile.bio, qualification: teacherProfile.qualification },
              }),
        },
        role: record.role,
        gender: record.gender,
        isMinor,
        verificationStatus: teacherProfile?.verificationStatus ?? null,
        accountStatus: record.accountStatus,
        cancellationRequests: {
          total: cancellationRequests.total,
          recent: cancellationRequests.recent,
        },
        ...(repeatedAbsences === undefined ? {} : { repeatedAbsences }),
      };
    },
  };
}
