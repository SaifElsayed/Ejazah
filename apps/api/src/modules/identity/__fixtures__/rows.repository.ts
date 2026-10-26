// B9 (T042–T045): the rows the identity services' specs write as a precondition or read as a result,
// and nothing a request ever runs. Only an identity repository may reach the identity tables
// (R-API-6), so the specs reach them through this one, as the services reach them through theirs.
import type { Database } from '../../../platform/db/prisma.repository.js';

type Role = 'student' | 'teacher';
type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

export interface SpecAccount {
  readonly email: string;
  readonly role?: Role;
  readonly gender?: 'male' | 'female';
  readonly accountStatus?: AccountStatus;
  readonly passwordHash?: string | null;
  readonly provider?: { readonly provider: 'google' | 'apple'; readonly subject: string };
}

/** The columns of a teacher's profile a deletion erases or keeps (T080). */
export interface ErasedProfileColumns {
  readonly bio: string;
  readonly verificationStatus: string;
  readonly payoutAccountRefEncrypted: Uint8Array | null;
  readonly payoutAccountRefHash: string | null;
  readonly payoutConfiguredAt: Date | null;
  readonly payoutVerifiedAt: Date | null;
  readonly payoutRejectedReason: string | null;
}

/** The personal columns of a person's row, read past the soft-delete filter (T080). */
export interface ErasedUserColumns {
  readonly deletedAt: Date | null;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly passwordHash: string | null;
  readonly dateOfBirth: Date | null;
  readonly certificateName: string | null;
  readonly photoKey: string | null;
}

export class SpecRows {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Writes an account straight to its tables, as `onboarding.complete` would have; its id. */
  async createAccount({
    email,
    role = 'student',
    gender = 'female',
    accountStatus = 'active',
    passwordHash = null,
    provider,
  }: SpecAccount): Promise<string> {
    const user = await this.#database.user.create({
      data: {
        email,
        passwordHash,
        gender,
        dateOfBirth: new Date('1990-04-12'),
        displayName: 'Spec Person',
        preferredLanguage: 'ar',
        timezone: 'Africa/Cairo',
        accountStatus,
      },
      select: { id: true },
    });
    await this.#database.userRole.create({ data: { userId: user.id, role, status: 'active' } });
    if (provider !== undefined) {
      await this.#database.authIdentity.create({
        data: { userId: user.id, provider: provider.provider, providerSubject: provider.subject },
      });
    }
    return user.id;
  }

  /** A teacher's profile at a given standing. */
  async createTeacherProfile(
    userId: string,
    standing: {
      readonly verificationStatus:
        'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
      readonly applicationStatus:
        'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';
      readonly payoutVerifiedAt?: Date | null;
      readonly payoutConfiguredAt?: Date | null;
      readonly payoutRejectedReason?: string | null;
    },
  ): Promise<void> {
    await this.#database.teacherProfile.create({
      data: {
        userId,
        bio: '',
        qualificationSummary: '',
        verificationStatus: standing.verificationStatus,
        applicationStatus: standing.applicationStatus,
        payoutVerifiedAt: standing.payoutVerifiedAt ?? null,
        payoutConfiguredAt: standing.payoutConfiguredAt ?? null,
        payoutRejectedReason: standing.payoutRejectedReason ?? null,
      },
    });
  }

  setPhotoKey(userId: string, photoKey: string) {
    return this.#database.user.update({ where: { id: userId }, data: { photoKey } });
  }

  setTimezone(userId: string, timezone: string, timezoneOverriddenAt: Date | null) {
    return this.#database.user.update({
      where: { id: userId },
      data: { timezone, timezoneOverriddenAt },
    });
  }

  setAccountStatus(userId: string, accountStatus: AccountStatus) {
    return this.#database.user.update({ where: { id: userId }, data: { accountStatus } });
  }

  softDelete(userId: string) {
    return this.#database.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
  }

  user(userId: string) {
    return this.#database.user.findUnique({ where: { id: userId } });
  }

  userByEmail(email: string) {
    return this.#database.user.findFirst({ where: { email } });
  }

  /** The person's sessions, oldest first. */
  sessions(userId: string) {
    return this.#database.userSession.findMany({
      where: { userId },
      orderBy: { issuedAt: 'asc' },
    });
  }

  sessionCount(userId: string) {
    return this.#database.userSession.count({ where: { userId } });
  }

  codes(destination: string) {
    return this.#database.otpCode.findMany({ where: { destination } });
  }

  identities(userId: string) {
    return this.#database.authIdentity.findMany({ where: { userId } });
  }

  roles(userId: string) {
    return this.#database.userRole.findMany({
      where: { userId },
      select: { role: true, status: true },
    });
  }

  terms(userId: string) {
    return this.#database.termsAcceptance.findMany({ where: { userId } });
  }

  /**
   * T080: the personal fields the deletion erases, set on a live account so a spec sees them go: a
   * phone number, a certificate name, a photo key.
   */
  setPersonalFields(
    userId: string,
    fields: {
      readonly phone?: string;
      readonly certificateName?: string;
      readonly photoKey?: string;
    },
  ) {
    return this.#database.user.update({ where: { id: userId }, data: fields });
  }

  /** A provider identity with Apple's grant already encrypted to `id`, as onboarding writes it. */
  createIdentity(identity: {
    readonly id: string;
    readonly userId: string;
    readonly provider: 'google' | 'apple';
    readonly subject: string;
    readonly grantEncrypted: Uint8Array | null;
  }) {
    return this.#database.authIdentity.create({
      data: {
        id: identity.id,
        userId: identity.userId,
        provider: identity.provider,
        providerSubject: identity.subject,
        providerRefreshTokenEncrypted:
          identity.grantEncrypted === null ? null : Uint8Array.from(identity.grantEncrypted),
      },
    });
  }

  /** A device push token of the person's (T080: the deletion removes them). */
  createPushToken(userId: string, tokenHash: string) {
    return this.#database.devicePushToken.create({
      data: {
        userId,
        tokenEncrypted: Uint8Array.from([1, 2, 3]),
        tokenHash,
        platform: 'android',
        lastSeenAt: new Date(),
      },
    });
  }

  pushTokens(userId: string) {
    return this.#database.devicePushToken.findMany({ where: { userId } });
  }

  /** A teacher's bio and payout columns, as a set-up teacher holds them (T080). */
  async setTeacherFields(
    userId: string,
    fields: {
      readonly bio: string;
      readonly payoutAccountRefEncrypted: Uint8Array;
      readonly payoutAccountRefHash: string;
      readonly payoutConfiguredAt: Date;
      readonly payoutVerifiedAt: Date;
    },
  ): Promise<void> {
    await this.#database.teacherProfile.update({
      where: { userId },
      data: {
        ...fields,
        payoutAccountRefEncrypted: Uint8Array.from(fields.payoutAccountRefEncrypted),
      },
      select: { id: true },
    });
  }

  /** The columns a deletion erases or keeps on a teacher's profile. */
  async teacherProfile(userId: string): Promise<ErasedProfileColumns | null> {
    return this.#database.teacherProfile.findUnique({
      where: { userId },
      select: {
        bio: true,
        verificationStatus: true,
        payoutAccountRefEncrypted: true,
        payoutAccountRefHash: true,
        payoutConfiguredAt: true,
        payoutVerifiedAt: true,
        payoutRejectedReason: true,
      },
    });
  }

  /** The row as it is after a deletion: the ordinary client hides it, so read it past the filter. */
  async deletedUser(userId: string): Promise<ErasedUserColumns | null> {
    return this.#database.includeDeleted.user.findUnique({
      where: { id: userId },
      select: {
        deletedAt: true,
        displayName: true,
        email: true,
        phone: true,
        passwordHash: true,
        dateOfBirth: true,
        certificateName: true,
        photoKey: true,
      },
    });
  }

  /** T097: the stored row under one keyed hash, or null; every column the table has. */
  bannedIdentifier(identifierHmac: string) {
    return this.#database.bannedIdentifier.findUnique({ where: { identifierHmac } });
  }

  /** The hashes a session's rotations retired, oldest first (T094). */
  retiredTokens(sessionId: string) {
    return this.#database.userSessionRetiredToken.findMany({
      where: { sessionId },
      orderBy: { retiredAt: 'asc' },
    });
  }
}
