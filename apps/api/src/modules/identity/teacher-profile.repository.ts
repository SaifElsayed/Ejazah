// T017: the public profile's columns, `users.display_name`, `users.gender`, `users.photo_key` and
// `teacher_profiles.bio` and `qualification_summary` (FR-310, R-218). Queries only; the service
// decides what is answered. The write is one conditional `updateMany` on the caller's approved
// profile: Postgres evaluates its condition on the row it locks, so no read decides it (T005's
// rule 1) and a profile whose approval ended is told so by a false, nothing written.
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'user' | 'teacherProfile'>;

/** What `teacher.profile.get` reads of a teacher's account and profile. */
export interface OwnProfileRow {
  readonly displayName: string;
  readonly gender: 'male' | 'female';
  readonly photoKey: string | null;
  readonly bio: string;
  readonly qualificationSummary: string;
}

/** The two texts the teacher edits. */
export interface ProfileTexts {
  readonly bio: string;
  readonly qualificationSummary: string;
}

export class TeacherProfileRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** The teacher's own profile; null when the account or its profile is gone. */
  async readOwn(teacherUserId: string): Promise<OwnProfileRow | null> {
    const row = await this.#database.user.findUnique({
      where: { id: teacherUserId },
      select: {
        displayName: true,
        gender: true,
        photoKey: true,
        teacherProfile: { select: { bio: true, qualificationSummary: true } },
      },
    });
    if (row?.teacherProfile == null) return null;
    return {
      // A live account keeps its name (ERD §15 rule 32).
      displayName: row.displayName ?? '',
      gender: row.gender,
      photoKey: row.photoKey,
      bio: row.teacherProfile.bio,
      qualificationSummary: row.teacherProfile.qualificationSummary,
    };
  }

  /** Writes the two texts on the teacher's approved profile; false when there is none. */
  async writeTexts(teacherUserId: string, texts: ProfileTexts): Promise<boolean> {
    const { count } = await this.#database.teacherProfile.updateMany({
      where: { userId: teacherUserId, verificationStatus: 'approved' },
      data: { bio: texts.bio, qualificationSummary: texts.qualificationSummary },
    });
    return count === 1;
  }
}
