// T024: the identity module's `users` rows as the photo route writes them (R-API-6). Queries only.
//
// `replacePhotoKey` is a conditional write (PR #80 review, finding 4): the row is updated only
// where it still holds the key that was read, and read again when another upload got there first,
// so the key the caller is told it replaced is the one it did replace and no object is orphaned in
// storage. The database decides the race, not the order of two statements.
//
// T049 adds the account's own reads and writes (`account.*`): the row `me` answers, with the role,
// how the account signs in and a teacher's profile standing, and the four settings a person changes.
// The device's time zone is written only where `timezone_overridden_at` is null, in the same
// statement, so a zone chosen by hand at the same moment is never overwritten (FR-AUTH-10).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';

type Client = Pick<Database, 'user'>;

/** What `account.me` reads of the caller's own account. */
export interface OwnAccountRow {
  readonly id: string;
  readonly email: string | null;
  readonly passwordHash: string | null;
  readonly gender: 'male' | 'female';
  readonly dateOfBirth: Date | null;
  readonly displayName: string | null;
  readonly photoKey: string | null;
  readonly preferredLanguage: 'ar' | 'en';
  readonly timezone: string;
  readonly accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned';
  readonly createdAt: Date;
  readonly role: 'student' | 'teacher' | undefined;
  readonly providers: readonly ('google' | 'apple')[];
  /** The teacher's profile standing; null before the application exists. */
  readonly profile: {
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
    readonly applicationStatus:
      'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved' | null;
    readonly payoutConfiguredAt: Date | null;
    readonly payoutVerifiedAt: Date | null;
    readonly payoutRejectedReason: string | null;
  } | null;
}

export class UsersRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Sets `photo_key`; answers the key it replaced, or null when the person had no photo. */
  async replacePhotoKey(userId: string, key: string): Promise<string | null> {
    for (;;) {
      const before = await this.#database.user.findUnique({
        where: { id: userId },
        select: { photoKey: true },
      });
      if (before === null) throw new DomainError('NOT_FOUND');
      const { count } = await this.#database.user.updateMany({
        where: { id: userId, photoKey: before.photoKey },
        data: { photoKey: key },
      });
      if (count === 1) return before.photoKey;
    }
  }

  /** The caller's own account as `me` answers it, or null when it no longer exists. */
  async readOwn(userId: string): Promise<OwnAccountRow | null> {
    const user = await this.#database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        gender: true,
        dateOfBirth: true,
        displayName: true,
        photoKey: true,
        preferredLanguage: true,
        timezone: true,
        accountStatus: true,
        createdAt: true,
        roles: { select: { role: true } },
        authIdentities: { select: { provider: true } },
        teacherProfile: {
          select: {
            verificationStatus: true,
            applicationStatus: true,
            payoutConfiguredAt: true,
            payoutVerifiedAt: true,
            payoutRejectedReason: true,
          },
        },
      },
    });
    if (user === null) return null;
    const { roles, authIdentities, teacherProfile, ...account } = user;
    return {
      ...account,
      role: roles[0]?.role,
      providers: authIdentities.map(({ provider }) => provider),
      profile: teacherProfile,
    };
  }

  async setDisplayName(userId: string, displayName: string): Promise<void> {
    await this.#database.user.update({
      where: { id: userId },
      data: { displayName },
      select: { id: true },
    });
  }

  async setLanguage(userId: string, preferredLanguage: 'ar' | 'en'): Promise<void> {
    await this.#database.user.update({
      where: { id: userId },
      data: { preferredLanguage },
      select: { id: true },
    });
  }

  /** The zone chosen by hand, and when: the device's report leaves it from now on. */
  async overrideTimezone(userId: string, timezone: string, at: Date): Promise<void> {
    await this.#database.user.update({
      where: { id: userId },
      data: { timezone, timezoneOverriddenAt: at },
      select: { id: true },
    });
  }

  /** The device's zone, written only while no zone was chosen by hand. */
  async reportDeviceTimezone(userId: string, timezone: string): Promise<void> {
    await this.#database.user.updateMany({
      where: { id: userId, timezoneOverriddenAt: null },
      data: { timezone },
    });
  }
}

/**
 * The display names of `userIds`, in one statement on the caller's transaction (003:T049: the other
 * party of an enrollment on booking's lists, FR-390, FR-391). The name and nothing else (FR-395,
 * R-HONEST-4). A deleted account is left out by the client's extension, its name erased (FR-141),
 * so it is absent. Read-only, no lock.
 */
export async function displayNamesOf(
  tx: Pick<Transaction, 'user'>,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, displayName: true },
  });
  return new Map(
    rows.flatMap(({ id, displayName }) =>
      displayName === null ? [] : [[id, displayName] as const],
    ),
  );
}

/**
 * The live account's IANA zone, on the caller's transaction; null for a person not there or
 * deleted. The catalog module stores it on a teacher's new slot, read under the account's lock
 * (T019, FR-313: the teacher's zone at creation).
 */
export async function accountTimezone(
  tx: Pick<Transaction, 'user'>,
  userId: string,
): Promise<string | null> {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { timezone: true },
  });
  return user?.timezone ?? null;
}

/** What a session's party is, by identity's records (T011 of specs/004-sessions, FR-432). */
export interface SessionPartyRecord {
  readonly gender: 'male' | 'female';
  readonly accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned';
  /** Whether the account's teacher approval stands: its profile's `verification_status` is `approved`. */
  readonly teacherApproved: boolean;
  readonly displayName: string;
}

/**
 * The live accounts of `userIds` as the sessions module's read and join decide on them (T011 of
 * specs/004-sessions; FR-432, R-GENDER-7, R-SESS-5), in one statement on the caller's transaction:
 * the gender, the standing, whether a teacher approval stands, and the display name, nothing else
 * (R-HONEST-4). A deleted account is left out by the client's extension (FR-141), so it is absent.
 * Takes no lock: the join locks both accounts first and reads them here under the locks.
 */
export async function sessionPartiesOf(
  tx: Pick<Transaction, 'user'>,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, SessionPartyRecord>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.user.findMany({
    where: { id: { in: [...userIds] } },
    select: {
      id: true,
      gender: true,
      accountStatus: true,
      displayName: true,
      teacherProfile: { select: { verificationStatus: true } },
    },
  });
  return new Map(
    rows.flatMap(({ id, gender, accountStatus, displayName, teacherProfile }) =>
      displayName === null
        ? []
        : [
            [
              id,
              {
                gender,
                accountStatus,
                teacherApproved: teacherProfile?.verificationStatus === 'approved',
                displayName,
              },
            ] as const,
          ],
    ),
  );
}
