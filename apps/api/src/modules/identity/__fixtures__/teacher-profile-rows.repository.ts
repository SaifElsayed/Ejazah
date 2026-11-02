// T017: the profile columns the profile specs write before a call and read back after it, and
// nothing a request ever runs. Only an identity repository may reach the identity tables (R-API-6),
// so the specs reach them through this one, as `payout-rows.repository.ts` does for payout.
import type { Database } from '../../../platform/db/prisma.repository.js';

/** What a profile spec reads back: the account's columns and the profile's. */
export interface ProfileColumns {
  readonly displayName: string | null;
  readonly gender: 'male' | 'female';
  readonly photoKey: string | null;
  readonly bio: string;
  readonly qualificationSummary: string;
  readonly verificationStatus: string;
  readonly updatedAt: Date;
}

export class TeacherProfileRows {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async write(
    userId: string,
    columns: {
      readonly photoKey?: string;
      readonly bio?: string;
      readonly qualificationSummary?: string;
      readonly verificationStatus?: 'approved' | 'revoked';
    },
  ): Promise<void> {
    const { photoKey, ...profile } = columns;
    if (photoKey !== undefined) {
      await this.#database.user.update({ where: { id: userId }, data: { photoKey } });
    }
    await this.#database.teacherProfile.update({ where: { userId }, data: profile });
  }

  async read(userId: string): Promise<ProfileColumns> {
    const user = await this.#database.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        displayName: true,
        gender: true,
        photoKey: true,
        teacherProfile: {
          select: {
            bio: true,
            qualificationSummary: true,
            verificationStatus: true,
            updatedAt: true,
          },
        },
      },
    });
    const { teacherProfile: profile, ...account } = user;
    if (profile === null) throw new Error(`no teacher profile for ${userId}`);
    return { ...account, ...profile };
  }
}
