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
      },
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
}
